import { test, expect } from "@playwright/test";
import { escapeHtml } from "../src/js/core/escapeHtml.js";

// Audit 2026-07-26 S6/H6. The report framed this as "47 innerHTML assignments,
// replace with textContent, mechanical, ~40 sites". Classifying all 51 sites
// found that most are innerHTML="" clears, static shells, or numeric/date-only
// interpolations, and that four files already escaped (recipePanel, cameraTiles,
// static/memories, static/recipes). Five sites genuinely interpolated
// upstream-controlled strings into markup, and textContent is the wrong fix for
// them — they build real markup. Escaping is.
//
// Part 1 pins the helper. Part 2 pins the call sites against the payloads that
// actually reach them, so a future edit that drops an escapeHtml() fails here.

const XSS = `<img src=x onerror="alert(1)">`;

test("escapeHtml neutralises the element-body breakout", () => {
  expect(escapeHtml(XSS)).toBe(
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
  );
});

test("escapeHtml neutralises the quoted-attribute breakout", () => {
  // Must escape the quote, or a value landing in title="..." can add handlers.
  expect(escapeHtml(`" onmouseover="alert(1)`)).toBe(
    "&quot; onmouseover=&quot;alert(1)"
  );
});

test("escapeHtml escapes & first so existing entities are not double-decoded", () => {
  expect(escapeHtml("Fish & Chips <b>")).toBe("Fish &amp; Chips &lt;b&gt;");
});

test("escapeHtml coerces null/undefined to empty, not the string 'null'", () => {
  expect(escapeHtml(null)).toBe("");
  expect(escapeHtml(undefined)).toBe("");
  expect(escapeHtml(0)).toBe("0");
});

// A hostile string that survives escaping must produce NO element when parsed —
// this is the property the call sites depend on, checked in a real parser
// rather than by eyeballing the entity table.
test("an escaped payload parses to text, not to an element", async ({ page }) => {
  const injectedTags = await page.evaluate((payload) => {
    const esc = (v) => String(v ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const host = document.createElement("div");
    host.innerHTML = `<div class="line">${esc(payload)}</div>`;
    return host.querySelectorAll("img, script").length;
  }, XSS);

  expect(injectedTags).toBe(0);
});

// Guard the five fixed sites by source inspection. A regex over the source is
// crude, but it is the only thing that fails when someone re-adds a raw
// interpolation of one of these specific upstream values.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("the upstream-sourced innerHTML sites still escape", () => {
  // Sonarr/Radarr queue titles
  expect(read("src/js/modules/arrActivity.js"))
    .toContain("${escapeHtml(item?.title");
  // fuel API station names
  expect(read("src/js/modules/fuelPrices.js"))
    .toContain("${escapeHtml(label)}");
  // meal names off the ICS calendar
  expect(read("src/js/modules/tonightsMenu.js"))
    .toContain("${escapeHtml(m.name)}");
  // lines laundered back out of other panels' textContent
  expect(read("src/js/modules/screensaver.js"))
    .toContain("${escapeHtml(line)}");
  // ICS event titles on the arrival card
  expect(read("src/js/modules/arrivalGreeting.js"))
    .toContain("${escapeHtml(e.title)}");
});

/* The three the note above waved through as "already escaped" — and then did
   not pin. They carry upstream text exactly like the five that ARE pinned
   (HA camera summaries, Mealie recipe bodies), each through a LOCAL escaper
   rather than the shared helper, so `import { escapeHtml }` does not appear in
   them and nothing above notices if the escaping goes.

   Re-swept 2026-08-14: every interpolation of upstream text in src/ is still
   escaped, so H6 is closed, not outstanding. These assertions are what keeps
   that true — a local helper is easier to drop in a refactor than an imported
   one, because deleting it breaks no import. */
test("…and so do the three that use a LOCAL escaper", () => {
  // HA camera summary fields — title/status/body, via escHtml() at :22
  const cameraTiles = read("src/js/modules/cameraTiles.js");
  expect(cameraTiles).toContain("function escHtml(");
  expect(cameraTiles).toContain("${escHtml(summary.title)}");
  expect(cameraTiles).toContain("${escHtml(summary.status)}");
  expect(cameraTiles).toContain("${escHtml(summary.body)}");

  // Mealie recipe title, ingredients and steps, via escapeHtml() at :19
  const recipePanel = read("src/js/modules/recipePanel.js");
  expect(recipePanel).toContain("function escapeHtml(");
  expect(recipePanel).toContain("${escapeHtml(recipe.title)}");
  expect(recipePanel).toContain("<li>${escapeHtml(i)}</li>");
  expect(recipePanel).toContain("<li>${escapeHtml(s)}</li>");
});

/* mediaPanels.js is the one innerHTML site that takes upstream text RAW, and it
   is correct: `decodeHtmlEntities` exists to turn `X-Men &#39;97` back into
   `X-Men '97` (699d1d8), which means escaping it would defeat the whole point.

   It is safe for a reason worth stating, because the reason is the only thing
   keeping it safe: the textarea is DETACHED and its content is RCDATA, so the
   parser produces text and never an element. Attach it to the document, or
   swap it for a div, and this becomes the one genuine injection in the tree. */
test("the entity decoder stays detached, and stays a textarea", () => {
  const src = read("src/js/modules/mediaPanels.js");
  const fn = src.slice(src.indexOf("function decodeHtmlEntities"));
  const body = fn.slice(0, fn.indexOf("\n}"));

  expect(body, "the decoder must build a textarea — RCDATA is what makes it safe")
    .toContain('createElement("textarea")');
  expect(body, "read .value, never .innerHTML back out").toContain(".value");
  expect(body, "a decoder that touches the document is no longer a decoder")
    .not.toMatch(/appendChild|append\(|document\.body/);
});

// The property the test above is really asserting, in a real parser: the same
// hostile payload is inert through the textarea and live through a div.
test("the textarea idiom yields text where a div would yield an element", async ({ page }) => {
  const counts = await page.evaluate((payload) => {
    const viaTextarea = document.createElement("textarea");
    viaTextarea.innerHTML = payload;
    const probe = document.createElement("div");
    probe.textContent = viaTextarea.value;

    const viaDiv = document.createElement("div");
    viaDiv.innerHTML = payload;

    return {
      textarea: probe.querySelectorAll("img, script").length,
      div: viaDiv.querySelectorAll("img, script").length
    };
  }, XSS);

  expect(counts.textarea, "the shipped idiom must produce no element").toBe(0);
  expect(counts.div, "…and the control must, or this proves nothing").toBe(1);
});
