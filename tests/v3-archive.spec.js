import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures/coverage.js";
import { plateForFrame, yearPositions } from "../src/v3/core/archive.js";
import { cardRectFor } from "../src/js/services/archiveModel.js";
// The house's own contrast maths, so the archive is judged by the same
// arithmetic the scrim solves with rather than by a second opinion.
import { contrastRatio } from "../src/v3/core/scrim.js";

/* THE AMBIENT ARCHIVE ON V3 — depth 0's other face, behind `v3Archive`.

   Three halves. The pure half pins the decisions that are arithmetic and
   language (where a year sits on the axis, what the plate is allowed to say,
   the card's rectangle) with no DOM and no network. The surface half pins the
   things that are only true on a page — that the flag-off build is a genuine
   no-op, that the layer is visible at depth 0 and nowhere else, that nothing
   grows across exchanges, and that ground.js's own soak metric is untouched.
   The CSS half is the guardrail: it reads the stylesheet as text and refuses a
   loop that is not bound to the cause that ends.

   ⚠ THE STRIP IS THE THIRD YEAR RAIL BUILT FOR THIS SURFACE. The first two were
   rejected on the panel. This one is here on the owner's instruction and the
   spec pins what makes it different: it draws the years the DATE reaches, and
   it lives above the card so the card keeps its full box. A future session
   reading only AMBIENT-ARCHIVE.md's "do not build a third" should read this
   file too. */

// ── The axis ────────────────────────────────────────────────────────────────

test("years are placed by VALUE, so a gap in the library shows as a gap", () => {
  const marks = yearPositions(["2011", "2012", "2023"], "2012");
  expect(marks.map((m) => m.year)).toEqual(["2011", "2012", "2023"]);

  // 2012 is one twelfth of the way from 2011 to 2023, and it must land there —
  // evenly spaced by index it would sit at the halfway point, which would be
  // the axis quietly claiming a year for every slot it draws.
  const [a, b, c] = marks.map((m) => m.x);
  expect((b - a) / (c - a)).toBeCloseTo(1 / 12, 5);
});

test("the axis spans the frame's safe margins, like every other V3 surface", () => {
  const marks = yearPositions(["2010", "2020"], "2020");
  // Canvas space: the strip bleeds 120px past the left edge, so frame x 108
  // is canvas x 228 and frame x 1812 is canvas x 1932.
  expect(marks[0].x).toBe(228);
  expect(marks[1].x).toBe(1932);
});

test("one year alone is centred, not pinned to the left margin", () => {
  const marks = yearPositions(["2019"], "2019");
  expect(marks).toHaveLength(1);
  // A single mark hard left reads as the start of a scale that has no end.
  expect(marks[0].x).toBe(228 + (1932 - 228) / 2 + 0);
  expect(marks[0].lit).toBe(true);
});

test("years are de-duplicated and sorted, and only the card's year is lit", () => {
  const marks = yearPositions(["2019", "2011", "2019", "2015"], "2015");
  expect(marks.map((m) => m.year)).toEqual(["2011", "2015", "2019"]);
  expect(marks.filter((m) => m.lit).map((m) => m.year)).toEqual(["2015"]);
});

test("an empty or unparseable pool draws no axis at all", () => {
  // A date with no memories has no year axis, and saying nothing is better than
  // inventing one.
  expect(yearPositions([], "2019")).toEqual([]);
  expect(yearPositions(null, null)).toEqual([]);
  expect(yearPositions(["", "not-a-year"], "")).toEqual([]);
});

// ── The plate ───────────────────────────────────────────────────────────────

const asset = (extra = {}) => ({
  id: "a",
  localDateTime: "2019-08-18T09:14:00Z",
  city: "Nudgee",
  country: "Australia",
  people: [],
  ...extra
});

test("the plate names the place, the year and who was there", () => {
  const plate = plateForFrame([asset({ people: ["Melanie"] })], new Date("2026-08-18"));
  expect(plate).toEqual({ year: "2019", title: "Nudgee", who: "Melanie" });
});

test("with no place the plate STILL SPEAKS — it says the year in words", () => {
  /* ⚠ The 2026-08-02 finding, re-learned here rather than re-derived: most of
     this library has no GPS and nobody named, so a place-only title left the
     plate absent on most days. A whole day's set captioned as bare years is not
     an edge case, it was 100% of the surface. */
  const plate = plateForFrame([asset({ city: null, country: null })], new Date("2026-08-18"));
  expect(plate).toEqual({ year: "2019", title: "Seven years ago today", who: null });
});

test("no year at all means no plate: silence is the default", () => {
  expect(plateForFrame([asset({ localDateTime: null })])).toBeNull();
  expect(plateForFrame([])).toBeNull();
  expect(plateForFrame(null)).toBeNull();
});

test("a diptych gets ONE plate, and its year is the earlier half", () => {
  const plate = plateForFrame(
    [asset({ localDateTime: "2019-08-18T09:00:00Z" }), asset({ id: "b", localDateTime: "2016-08-18T09:00:00Z" })],
    new Date("2026-08-18")
  );
  // The pair is one moment on the wall; two eyebrows would be the feature
  // announcing itself.
  expect(plate.year).toBe("2016");
});

test("a trip never reaches the engraved year — 'Mexico 2017' is a line, not a numeral", () => {
  const plate = plateForFrame([asset({ trip: "Mexico 2017", city: null, country: null })]);
  expect(plate.year).toBe("2019");
});

// ── The card's rectangle ────────────────────────────────────────────────────

test("a 16:9 memory lands on the shipped rectangle, to the pixel", () => {
  /* The hinge that makes this a PORT rather than a redesign of the geometry:
     the common landscape memory must sit exactly where the incumbent put it, so
     the two surfaces can be compared frame to frame. */
  expect(cardRectFor(16 / 9)).toMatchObject({ w: 1040, h: 585, left: 130, top: 212 });
});

test("a portrait gets a portrait card and nothing is cut", () => {
  expect(cardRectFor(3 / 4)).toMatchObject({ w: 457, h: 609, left: 130, top: 200 });
});

test("a diptych of two portraits fits as one wide card", () => {
  // Two 3:4 halves side by side = a combined aspect of 1.5, which is
  // height-bound: 609 tall, 913 wide, still inside the box.
  const rect = cardRectFor(0.75 + 0.75);
  expect(rect.h).toBe(609);
  expect(rect.w).toBe(914);
  expect(rect.left).toBe(130);
});

// ── On the page ─────────────────────────────────────────────────────────────

/* A 1x1 PNG: `load` must fire and naturalWidth must be non-zero so the card can
   measure a real aspect. Nothing here asserts what the picture looks like. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const POOL = [
  { id: "a", aspect: 1.78, localDateTime: "2011-08-18T09:00:00Z", city: "Nudgee", people: [] },
  { id: "b", aspect: 1.78, localDateTime: "2015-08-18T09:00:00Z", city: "Nudgee", people: [] },
  { id: "c", aspect: 1.78, localDateTime: "2019-08-18T09:00:00Z", city: "Nudgee", people: [] },
  { id: "d", aspect: 1.78, localDateTime: "2023-08-18T09:00:00Z", city: "Nudgee", people: [] }
];

/**
 * Boot V3 with the archive's flag PINNED, never inherited.
 *
 * Pinned because flipping it back is the rollback path, and the off state has
 * to keep being tested after the default moves — the ambientSubstrate lesson,
 * where a flip broke specs that had assumed the old default.
 */
/* ⚠ PIN THE CLOCK. `:root[data-night="1"]` hides #ground-caption outright, and
   V3 decides night off the sun's altitude — so on a machine running this after
   sunset the caption is invisible for a reason that has nothing to do with the
   archive, and the law-3 assertion below passes or fails by time of day. */
const MIDDAY = new Date("2026-07-06T12:00:00");

async function bootArchive(page, { v3Archive = true, groundMemories = true, pool = POOL } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.clock.setFixedTime(MIDDAY);

  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body:
        (await res.text()) +
        `\nwindow.CONFIG.features.v3Archive = ${v3Archive};` +
        `\nwindow.CONFIG.features.groundMemories = ${groundMemories};` +
        `\nwindow.CONFIG.features.groundDiptych = false;\n`
    });
  });

  await page.route("**/api/immich/on-this-day", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: pool }) })
  );
  await page.route("**/api/immich/asset/*/thumb", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG })
  );

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__ground === "function");
  return pageErrors;
}

const groundShown = (page) =>
  expect.poll(() => page.evaluate(() => window.__ground().shown), { timeout: 10_000 }).toBe(true);

test("flag OFF is a genuine no-op — no nodes, no marker, no hook", async ({ page }) => {
  const pageErrors = await bootArchive(page, { v3Archive: false });
  await groundShown(page);

  const probe = await page.evaluate(() => ({
    children: document.getElementById("archive").children.length,
    marker: document.documentElement.dataset.archive ?? null,
    hook: typeof window.__archive,
    // The host is in index.html either way; it must paint NOTHING, not even the
    // opaque background it carries when the flag is on.
    visible: document.getElementById("archive").checkVisibility({ opacityProperty: true }),
    captionVisible: document
      .getElementById("ground-caption")
      .checkVisibility({ opacityProperty: true }),
    layers: window.__ground().layers
  }));

  expect(probe.children).toBe(0);
  expect(probe.marker).toBeNull();
  expect(probe.hook).toBe("undefined");
  expect(probe.visible).toBe(false);
  // Depth 0 is exactly the surface that shipped: full-bleed photograph, scrim,
  // and the caption doing the talking.
  expect(probe.captionVisible).toBe(true);
  expect(probe.layers).toBe(1);

  expect(pageErrors).toEqual([]);
});

test("flag on: the composition is up at depth 0 and the caption stands down", async ({ page }) => {
  const pageErrors = await bootArchive(page);
  await groundShown(page);
  await expect.poll(() => page.evaluate(() => window.__archive().lit)).toBeTruthy();

  const probe = await page.evaluate(() => ({
    ...window.__archive(),
    visible: document.getElementById("archive").checkVisibility({ opacityProperty: true }),
    captionVisible: document
      .getElementById("ground-caption")
      .checkVisibility({ opacityProperty: true }),
    layers: window.__ground().layers,
    imgs: window.__ground().imgs
  }));

  expect(probe.visible).toBe(true);
  expect(probe.ghosts).toBe(2);
  // Two slots x two halves, allocated once and never grown.
  expect(probe.slots).toBe(4);
  expect(probe.years).toEqual(["2011", "2015", "2019", "2023"]);
  expect(probe.years).toContain(probe.lit);
  expect(probe.plate).not.toBeNull();
  expect(probe.plate.title).toBe("Nudgee");

  // The plate says who/where/when now, so the caption would be the same fact
  // told twice.
  expect(probe.captionVisible).toBe(false);

  /* ⚠ ground.js's own metric MUST BE UNTOUCHED. `layers` is what the soak reads
     to decide the ground is leaking; the archive's four <img>s live in its own
     host precisely so this stays 1. */
  expect(probe.layers).toBe(1);
  expect(probe.imgs).toBe(1);

  expect(pageErrors).toEqual([]);
});

test("TWO ghosts, not thirty — and the strip is not one of them", async ({ page }) => {
  await bootArchive(page);
  await groundShown(page);

  const probe = await page.evaluate(() => ({
    /* offsetWidth, NOT getBoundingClientRect: the ghosts sit on a rotated plane
       under a 1400px perspective, so the client rect is the PROJECTION and a
       1060px ghost measures 630. The number that says "this is one big
       enlargement, not a 620px tile" is the layout width. */
    ghosts: [...document.querySelectorAll(".archive__ghost")].map((el) => ({
      w: el.offsetWidth,
      h: el.offsetHeight
    })),
    // A repeating background is exactly what "too many tiles" meant. Each ghost
    // is one photograph, covered — never tiled.
    repeats: [...document.querySelectorAll(".archive__ghost-skin")].map(
      (el) => getComputedStyle(el).backgroundRepeat
    )
  }));

  expect(probe.ghosts).toHaveLength(2);
  expect(probe.repeats.every((r) => r === "no-repeat")).toBe(true);
  // Big: each is a large fraction of a 1920-wide frame, not a 620px tile.
  for (const g of probe.ghosts) expect(g.w).toBeGreaterThan(700);
});

test("the strip takes the empty top band and never reaches the card or the hour", async ({ page }) => {
  await bootArchive(page);
  await groundShown(page);

  const probe = await page.evaluate(() => {
    const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
    return {
      strip: rect(".archive__strip"),
      card: rect(".archive__card-plane"),
      hour: document.getElementById("hour").getBoundingClientRect()
    };
  });

  /* THE WHOLE REASON THE STRIP TOOK THE HIGH SLOT. Build 1's year axis was
     rejected partly for shrinking the card to 53% of its area to make room;
     this one costs the photograph nothing because at depth 0 the top band holds
     nothing at all. Measured as PAINTED boxes, not as stylesheet numbers — both
     planes are rotated and the projection is what a person sees. */
  expect(probe.strip.bottom).toBeLessThanOrEqual(probe.card.top);
  expect(probe.strip.top).toBeGreaterThan(0);
  // The hour keeps its 168px bottom-left corner, untouched by any of this.
  expect(probe.strip.bottom).toBeLessThan(probe.hour.top);
  // And the card is still the hero: the shipped 1040-wide box, or taller-and-
  // narrower for a portrait, never a strip of one.
  expect(probe.card.height).toBeGreaterThan(400);
});

test("the layer is depth 0's, and recedes to the full-bleed photograph above it", async ({ page }) => {
  const pageErrors = await bootArchive(page);
  await groundShown(page);

  const at = async (depth) => {
    await page.evaluate((d) => window.__setDepth(d, "spec"), depth);
    await page.waitForTimeout(500);   // > --m-calm (350ms)
    return page.evaluate(() =>
      document.getElementById("archive").checkVisibility({ opacityProperty: true })
    );
  };

  expect(await at(0)).toBe(true);
  /* Depth 1+ is BYTE-IDENTICAL to today's backdrop — the full-bleed photograph
     and the solved scrim — which is also the flag-off state. That is why the
     rollback is exercised in production on every doorbell rather than only at
     revert time. */
  expect(await at(1)).toBe(false);
  expect(await at(3)).toBe(false);
  // And it comes back, because recession is always automatic and always
  // downhill: nothing can get stuck deep.
  expect(await at(0)).toBe(true);

  expect(pageErrors).toEqual([]);
});

test("nothing grows across exchanges, and one timer never becomes many", async ({ page }) => {
  const pageErrors = await bootArchive(page);
  await groundShown(page);

  const count = () => page.evaluate(() => window.__archive().nodes);
  const before = await count();

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__groundDissolve(20, 200));
    await expect.poll(() => page.evaluate(() => window.__ground().inFlight)).toBe(false);
  }
  await page.waitForTimeout(2200);   // past the exchange cleanup

  /* A page that runs for weeks may not grow. Every node the archive will ever
     have is built once; an exchange swaps `src` and two class names. */
  expect(await count()).toBe(before);

  const probe = await page.evaluate(() => ({
    ...window.__archive(),
    layers: window.__ground().layers,
    /* Exactly one PAINTING slot once the settle is over. Both would mean the
       outgoing layer is compositing for nobody, forever.
       ⚠ `:not([data-blank="1"])` matters: the unused half of a single-photograph
       frame keeps its classes and is display:none, so a bare class count says
       two and means one. */
    top: document.querySelectorAll('.archive__img.is-top:not([data-blank="1"])').length,
    shown: document.querySelectorAll('.archive__img.is-shown:not([data-blank="1"])').length
  }));

  expect(probe.slots).toBe(4);
  expect(probe.ghosts).toBe(2);
  expect(probe.layers).toBe(1);
  /* The soak's own number, pinned so a later change cannot move it silently:
     five loops at depth 0 in daylight, four after dark (the engraved year is
     hidden then and must not animate for nobody). */
  expect(probe.anims).toBe(5);
  expect(probe.top).toBe(1);
  expect(probe.shown).toBe(1);

  expect(pageErrors).toEqual([]);
});

test("a late hand-off from a superseded exchange never puts an old photo back up", async ({ page }) => {
  /* ⚠ A REAL DEFECT, found by driving this rather than by reading it. ground.js
     fires its second onPhoto from a timer armed a whole settle earlier, so two
     exchanges inside one settle+buffer window — a veto answered by another
     veto — deliver the OLD frame's hand-off after the new one's. Both
     subscribers acted on it: the scrim re-solved for a photograph that had
     gone, and the archive put it back on top of the card. On the wall that is
     the picture the room just rejected reappearing a few seconds later.

     Pinned here because this is where it was visible: the card's top slot must
     always name whatever ground.js currently has up. */
  const pageErrors = await bootArchive(page);
  await groundShown(page);

  /* ⚠ THE SETTLES MUST DIFFER, and evenly-spaced exchanges do NOT reproduce
     this — the stale hand-offs then arrive in the same order they were armed
     and the end state comes out right anyway. Proven by injecting the defect
     and watching a three-exchange version stay green.

     This is the shape that bites, and it is the real one: a SLOW ambient
     dissolve (60s on the wall) interrupted by a BRISK veto (1.2s), because
     someone said "not this one" while the wall was mid-drift. The veto's
     hand-off lands first and the ambient one lands after it, naming a
     photograph that is two frames stale.

     ⚠ THE GAP BETWEEN THE TWO SETTLES HAS TO SWAMP THE POLL. Each hand-off is
     armed settleMs + 2s after its OWN settle, so with the two settles close
     together the firing order depends on how long the poll between them took —
     and the first version of this test passed and failed on the same build for
     exactly that reason. 3000 against 20 puts the slow hand-off 5s out and the
     brisk one ~2s out whatever the poll does. */
  await page.evaluate(() => window.__groundDissolve(3000, 8000));
  await expect.poll(() => page.evaluate(() => window.__ground().inFlight)).toBe(false);
  await page.evaluate(() => window.__groundDissolve(20, 200));
  await expect.poll(() => page.evaluate(() => window.__ground().inFlight)).toBe(false);
  await page.waitForTimeout(6000);   // past BOTH armed hand-offs, in either order

  const probe = await page.evaluate(() => {
    const top = document.querySelector('.archive__img.is-top:not([data-blank="1"])');
    /* ⚠ THE ID IS PULLED OUT AS A PATH SEGMENT, never matched as a substring.
       `expect(path).toContain(id)` looked right and was worthless: the fixture
       ids are single letters and "/api/immich/asset/b/thumb" contains "a", "c"
       and "d" as well. It reported green against a build with the defect
       deliberately injected, twice. */
    const seg = top ? /\/asset\/([^/]+)\//.exec(new URL(top.src).pathname)?.[1] : null;
    return {
      groundAsset: window.__ground().assetId,
      topAsset: seg ?? null,
      lit: window.__archive().lit
    };
  });

  expect(probe.topAsset).toBe(probe.groundAsset);
  expect(probe.lit).toBeTruthy();
  expect(pageErrors).toEqual([]);
});

test("the card takes the print's own shape from the DECODED rendition", async ({ page }) => {
  await bootArchive(page);
  await groundShown(page);
  await expect.poll(() => page.evaluate(() => window.__archive().card?.w)).toBeGreaterThan(0);

  const card = await page.evaluate(() => window.__archive().card);
  // The fixture PNG is 1x1, i.e. square, and a square is height-bound: 609 tall.
  expect(card.h).toBe(609);
  expect(card.w).toBe(609);
  expect(card.left).toBe(130);
  // Vertical centre held at 504.5, so the card grows about where it has always
  // sat rather than dropping toward the bottom of the frame.
  expect(card.top + card.h / 2).toBeCloseTo(504.5, 1);
});

test("every word on the plate clears WCAG AA over its own backdrop", async ({ page }) => {
  /* ⚠ WHY THIS LIVES HERE AND NOT IN tests/verify/v3-contrast.spec.js. That
     sweep boots ONE page per (ground, phase) and drives every surface across
     it, so a pinned `v3Archive` would apply to all of them — and at depth 0 the
     archive hides #ground-caption, which would silently retire the measurement
     of the caption's own hard-won 5.29:1. Pinning the flag there buys the plate
     and loses the caption. Measured here instead, against the real painted
     stack, and the sweep is left exactly as it is.

     ⚠ AND A GAP WORTH NAMING RATHER THAN LEAVING IMPLICIT: the strip's year
     labels are drawn into a CANVAS, so no DOM text sweep can ever see them.
     They are the one piece of archive text no automated gate covers — the
     32px/48px sizes and the ink alphas in core/archive.js are the whole
     defence, and the panel is the only real check. */
  await bootArchive(page);
  await groundShown(page);
  await expect.poll(() => page.evaluate(() => window.__archive().plate)).not.toBeNull();

  const rows = await page.evaluate(() => {
    /* ⚠ oklch() DOES NOT RESOLVE THROUGH `ctx.fillStyle` ALONE. Assigning an
       oklch() string and reading the property straight back returns the SAME
       oklch() string in this Chromium, so a probe built that way parses nothing
       and reports null — which is how this test failed first time round. The
       colour has to be PAINTED and the pixel read back:

         fillStyle = css; fillRect(...); getImageData(...)

       Painting the layers in order also does the alpha compositing for free, so
       the numbers below are the real stack — archive ground, then the plate's
       0.72 backdrop, then the ink — rather than ink over an assumed black. */
    const px = (...layers) => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      for (const css of layers) {
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
      }
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] / 255, d[1] / 255, d[2] / 255];
    };

    const ground = getComputedStyle(document.getElementById("archive")).backgroundColor;
    return [...document.querySelectorAll(".archive__plate > p")]
      .filter((el) => el.textContent.trim() && el.dataset.blank !== "1")
      .map((el) => {
        const cs = getComputedStyle(el);
        return {
          cls: el.className.split(" ")[0],
          fontSize: parseFloat(cs.fontSize),
          backdrop: px(ground, cs.backgroundColor),
          ink: px(ground, cs.backgroundColor, cs.color)
        };
      });
  });

  // eyebrow + title, and `who` too when the frame names anybody.
  expect(rows.length).toBeGreaterThanOrEqual(2);

  for (const row of rows) {
    const ratio = contrastRatio(row.ink, row.backdrop);
    expect(ratio, `${row.cls} at ${row.fontSize}px reads ${ratio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(4.5);
    // The legibility FLOOR, which is a separate law from contrast: below
    // --t-rail the text is not received at 3-4m however well it contrasts.
    expect(row.fontSize, `${row.cls} is under the 32px floor`).toBeGreaterThanOrEqual(32);
  }
});

// ── The CSS guardrail ───────────────────────────────────────────────────────

/* Comments stripped first: every rule below is DESCRIBED in a comment right
   next to it, and a guardrail that reads its own documentation as code passes
   for the wrong reason. */
const cssPath = fileURLToPath(new URL("../src/v3/css/archive.css", import.meta.url));
const css = () => readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = () => css().match(/[^{}@]+\{[^}]*\}/g) || [];

test("every looping animation hangs off the cause that ends", () => {
  const looping = rules().filter((r) => /animation[^;]*\binfinite\b/.test(r));
  // If this ever reads zero the assertion has stopped testing anything.
  expect(looping.length).toBeGreaterThan(0);

  for (const rule of looping) {
    const selector = rule.slice(0, rule.indexOf("{"));
    /* Depth 0 IS the cause. Something arriving switches the motion off rather
       than hiding it, which is the difference between a surface that stops and
       a surface that is merely invisible while it burns a core. */
    expect(selector, `not bound to depth 0: ${selector.trim()}`).toContain('[data-depth="0"]');
    expect(selector, `not bound to the flag: ${selector.trim()}`).toContain("[data-archive=");
    /* DPMS fires no visibilitychange, so without this the loops run all night
       to a dark panel. The incumbent archive never had it. */
    expect(selector, `not gated on the panel: ${selector.trim()}`)
      .toContain(':not([data-panel-dark="1"])');
  }

  // An iteration count is a loop wearing a different name.
  expect(css()).not.toMatch(/animation-iteration-count/);
});

test("nothing animates an element the night rule has already hidden", () => {
  /* ⚠ FOUND ON THE REAL WALL AFTER DARK, not by a spec: five loops were running
     and only four had anything on the glass. `:root[data-night="1"]` takes the
     engraved year to opacity 0, and a hidden element on a drift loop composites
     every frame for nobody — the same waste the Ken Burns rule avoids by keying
     on `is-top` rather than on every opaque slot.

     Generalised rather than hard-coded to the year: anything the night rule
     hides outright must not carry a loop that night leaves running. */
  const text = css();
  const hidden = [...text.matchAll(/:root\[data-night="1"\]([^{]*)\{[^}]*opacity:\s*0[^}]*\}/g)]
    .flatMap((m) => (m[0].slice(0, m[0].indexOf("{")).match(/\.archive__[\w-]+/g) || []));
  expect(hidden.length, "the night rule hid nothing — has it moved?").toBeGreaterThan(0);

  for (const rule of rules()) {
    const selector = rule.slice(0, rule.indexOf("{"));
    if (!/\binfinite\b/.test(rule)) continue;
    for (const cls of hidden) {
      if (!selector.includes(cls)) continue;
      expect(selector, `${cls} loops through the night it is hidden in`)
        .toContain(':not([data-night="1"])');
    }
  }
});

test("the year strip NEVER moves", () => {
  /* Once the plane means "which years this date reaches", sliding it is a lie
     about what it measures. The reference drifts its strips +-80px, which was
     fine when they were texture and is not fine now. */
  for (const rule of rules()) {
    const selector = rule.slice(0, rule.indexOf("{"));
    if (!/\.archive__strip\b/.test(selector)) continue;
    expect(rule, `the strip must not animate: ${selector.trim()}`).not.toMatch(/animation\s*:/);
  }
});

test("the five periods are pinned, and night scales displacement not duration", () => {
  /* ⚠ FIVE, not four. The incumbent ran four because its background was ONE
     tiled echo; this one has two ghosts. Counted off the real wall
     (`document.getAnimations()` at depth 0) rather than off the stylesheet,
     because "how many should be running" is the soak's own question and an
     expected count that is quietly wrong makes every future reading wrong. */
  const text = css();
  expect(text).toMatch(/animation:\s*arch-ghost-a 130s/);
  expect(text).toMatch(/animation:\s*arch-ghost-b 104s/);
  expect(text).toMatch(/animation:\s*arch-year 92s/);
  expect(text).toMatch(/animation:\s*arch-pivot 84s/);
  expect(text).toMatch(/animation:\s*arch-kenburns 96s/);

  /* §5.2: at 2am the wall drifts less FAR, never less often. --arch-day is the
     only thing night touches, and it appears nowhere near a duration. */
  expect(text).toMatch(/--arch-amp:\s*calc\(var\(--arch-gain\)/);
  expect(text).toMatch(/\[data-night="1"\]\s*\{\s*--arch-day:/);
  for (const m of text.match(/animation:[^;]+;/g) || []) {
    expect(m, `a period must not vary: ${m}`).not.toMatch(/var\(--arch-(amp|gain|day)\)/);
  }
});

test("no layout-triggering property is transitioned", () => {
  /* §5.5. The card's width/height/top DO change — they are written instantly by
     applyRect, riding the exchange that is already happening. Transitioning
     them would put layout on the compositor's critical path sixty times a
     second for a minute. */
  for (const t of css().match(/transition\s*:[^;]+;/g) || []) {
    expect(t, `compositor properties only: ${t}`)
      .not.toMatch(/\b(width|height|top|left|margin|padding)\b/);
  }
});

test("reduced motion takes the layer OFF the glass, not merely to zero opacity", () => {
  /* At opacity 0 the layer is still composited and every loop still runs. The
     incumbent's guardrail asserts the same distinction, and it is the reason
     that one is worded this way. */
  const reduced = css().slice(css().indexOf("prefers-reduced-motion"));
  expect(reduced).toMatch(/\.archive\s*\{\s*display:\s*none/);
});

test("the archive's loops live in their own stylesheet", () => {
  /* Not tidiness. tests/insights.spec.js forbids an unbound `infinite` in the
     incumbent's shared sheets for the same reason: a stylesheet everything
     loads is where a continuous loop gets added without anyone noticing. */
  const compose = readFileSync(
    fileURLToPath(new URL("../src/v3/css/compose.css", import.meta.url)),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  expect(compose).not.toMatch(/\binfinite\b/);
  expect(compose).not.toMatch(/\.archive__/);
});
