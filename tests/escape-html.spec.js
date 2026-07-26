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
