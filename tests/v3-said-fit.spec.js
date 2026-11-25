import { test, expect } from "./fixtures/coverage.js";

/* features.v3SaidFit — "never a third line", by measurement (core/spread.js fitSaid).

   The defect, as the wall showed it on 2026-11-25: "Rain in about 75 min — 83%
   chance." is 34 characters, under the 40-character count, so it stayed at
   132px and took THREE lines in the dominant cell. Stepped down to 96px it fits
   two, but broke "Rain in about 75" / "min — 83% chance." until numbers were
   glued to their units. Every test below asserts the text first, so a
   fixture the attention engine quietly replaced cannot pass (CLAUDE.md: a scored
   lane can replace a spec's own fixture). */

const RAIN = "Rain in about 75 min — 83% chance.";
const DOOR = "Someone is at the front door · a parcel was left on the step by the side gate";

async function boot(page, on) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({ response: res, body: `${await res.text()}\nwindow.CONFIG.features.v3SaidFit = ${on};\n` });
  });
  await page.clock.setFixedTime(new Date("2026-06-16T12:00:00+10:00"));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  await page.evaluate(() => document.fonts.ready);
  return pageErrors;
}

const ORDINARY = { id: "spec:menu", source: "menu", text: "Chicken fajitas", score: 40, cooldownMs: 0 };

/** Depth 2 with `text` as the dominant said line. */
function dwell(page, text) {
  return page.evaluate((cands) => {
    window.__forceCandidate(cands);
    window.__v3Presence("dwell");
    return window.__v3Tick();
  }, [{ id: "spec:fit", source: "weather", score: 42, cooldownMs: 0, text }, ORDINARY]);
}

/** Visible line boxes of the said node (a broken dot's phantom box excluded). */
const read = (page, selector) => page.evaluate(async (sel) => {
  /* Read the wall as it SETTLES, not as it was written: a glyph from a font
     subset not loaded yet (the dash) reflows the line a frame after the fit.
     Reading early is how the re-fit in markWrapped() went untested. */
  await document.fonts.ready;
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  const said = document.querySelector(sel);
  if (!said) return null;
  /* Rows, not rounded tops: the cell enters on a transform, so two rects on ONE
     line can read 575.49 and 575.51 and round apart. A new row starts only when
     the top moves by more than half a rect's height. */
  const tops = (nodes) => {
    const rects = [];
    for (const n of nodes) {
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width && r.height) rects.push(r);
      range.detach();
    }
    rects.sort((a, b) => a.top - b.top);
    let rows = 0;
    let last = -Infinity;
    for (const r of rects) if (r.top - last > r.height / 2) { rows++; last = r.top; }
    return rows;
  };
  const glue = said.querySelector(".said__glue");
  return {
    text: said.textContent,
    lines: tops([...said.childNodes].filter((n) => !n.classList?.contains("said__sep"))),
    len: said.dataset.len ?? null,
    overfit: said.dataset.overfit ?? null,
    wrapped: said.dataset.wrapped ?? null,
    fontSize: getComputedStyle(said).fontSize,
    glue: glue?.textContent ?? null,
    glueLines: glue ? tops([glue]) : null
  };
}, selector);

test("OFF: the 34-character rain line takes three lines at 132px — the defect this flag exists for", async ({ page }) => {
  const errors = await boot(page, false);
  await dwell(page, RAIN);
  const got = await read(page, "#spread-lattice .said");
  expect(got.text).toBe(RAIN);
  // If this ever reads 2, the fixture no longer produces the defect and the ON
  // test below proves nothing.
  expect(got.lines, "the fixture no longer reproduces the three-line defect").toBe(3);
  expect(got.len).toBeNull();
  expect(got.glueLines, "flag-off DOM must carry no glue span").toBeNull();
  expect(errors).toEqual([]);
});

test("ON: the rain line fits in two lines, and '75 min' is never split", async ({ page }) => {
  const errors = await boot(page, true);
  await dwell(page, RAIN);
  const got = await read(page, "#spread-lattice .said");
  expect(got.text, "voice.js compares this node's text — the words must not change").toBe(RAIN);
  expect(got.lines).toBeLessThanOrEqual(2);
  expect(got.wrapped, "a two-line line must still raise the veil").toBe(got.lines > 1 ? "1" : null);
  expect(got.overfit).toBeNull();
  expect(got.glue, "the number is not glued to its unit").toBe("75 min");
  // The stills showed exactly this split at 96px before the glue existed.
  expect(got.glueLines, "the number and its unit were split across lines").toBe(1);
  expect(errors).toEqual([]);
});

/* Why dashes are NOT glued (owner's call on the stills, 2026-11-25): gluing
   "— recycling" made this line need three lines at 132px and step down to 96px,
   all to avoid a dash at a line end, which is a conventional break. */
const DASH_LINE = "Bins tonight — recycling week.";

test("ON: a line that holds two lines at 132px keeps 132px, dash and all", async ({ page }) => {
  const errors = await boot(page, true);
  await dwell(page, DASH_LINE);
  const got = await read(page, "#spread-lattice .said");
  expect(got.text).toBe(DASH_LINE);
  expect(got.lines).toBe(2);
  expect(got.fontSize, "the fit stepped down a line that fitted").toBe("132px");
  expect(got.len).toBeNull();
  expect(errors).toEqual([]);
});

/* The face arrives AFTER the fit, which is what the wall does the first time a
   line needs a font subset nobody has used yet (the em dash was the measured
   case). The font files are held back here so the first fit is forced to run on
   the fallback face; only the re-fit in markWrapped() can put the line back
   where Figtree wants it. */
/* Measured 2026-11-25 (Windows, Chromium): the fallback face holds this line in
   two lines at 132px; Figtree needs 96px. So a fit that ran only on the
   fallback leaves it at 132px, three lines, once Figtree lands. */
const FACE_SENSITIVE = "Hot one tomorrow — 37 degrees.";

async function bootFonts(page, fonts) {
  if (fonts === "blocked") await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  if (fonts === "late") {
    await page.route("https://fonts.gstatic.com/**", async (route) => {
      await new Promise((ok) => setTimeout(ok, 2500));
      await route.continue();
    });
  }
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({ response: res, body: `${await res.text()}\nwindow.CONFIG.features.v3SaidFit = true;\n` });
  });
  await page.clock.setFixedTime(new Date("2026-06-16T12:00:00+10:00"));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
}

test("ON: a face that lands after the fit gets the line fitted again in the real face", async ({ page, context }) => {
  // The precondition, proven here rather than assumed: on the fallback face this
  // line fits at 132px. On a machine whose fallback agrees with Figtree the test
  // would be vacuous, so it says so instead of passing.
  const fallback = await context.newPage();
  await bootFonts(fallback, "blocked");
  await dwell(fallback, FACE_SENSITIVE);
  const onFallback = await read(fallback, "#spread-lattice .said");
  await fallback.close();
  expect(onFallback.text).toBe(FACE_SENSITIVE);
  expect(onFallback.fontSize, "the fallback face no longer disagrees with Figtree — pick another fixture").toBe("132px");

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await bootFonts(page, "late");
  // check() answers without starting a load: false means the fit below runs on
  // the fallback face. (fonts.status reads "loaded" until something asks.)
  const faceReady = await page.evaluate(() => document.fonts.check('300 132px "Figtree"', "Hot one"));
  await dwell(page, FACE_SENSITIVE);
  expect(faceReady, "Figtree was already loaded — the fit did not run on the fallback").toBe(false);
  const got = await read(page, "#spread-lattice .said");
  expect(got.text).toBe(FACE_SENSITIVE);
  expect(got.lines, "the line was fitted on the fallback and never again").toBeLessThanOrEqual(2);
  expect(got.fontSize).toBe("96px");
  expect(pageErrors).toEqual([]);
});

test("ON: a short line keeps 132px — the measurement only steps down when it must", async ({ page }) => {
  const errors = await boot(page, true);
  await dwell(page, "Bins tonight");
  const got = await read(page, "#spread-lattice .said");
  expect(got.text).toBe("Bins tonight");
  expect(got.lines).toBe(1);
  expect(got.len).toBeNull();
  expect(got.fontSize).toBe("132px");
  expect(got.wrapped).toBeNull();
  expect(errors).toEqual([]);
});

test("ON: a line no rung can fit is marked overfit at 96px, words untouched", async ({ page }) => {
  const errors = await boot(page, true);
  await dwell(page, DOOR);
  const got = await read(page, "#spread-lattice .said");
  expect(got.text).toBe(DOOR);
  expect(got.overfit, "the door line fitted — this no longer tests the last rung").toBe("1");
  expect(got.len).toBe("long");
  expect(got.fontSize).toBe("96px");
  expect(got.wrapped).toBe("1");
  expect(errors).toEqual([]);
});

test("ON: a wrapped line still breaks AT its dot, and the hidden dot is not counted as a line", async ({ page }) => {
  const errors = await boot(page, true);
  const LINE = "Shower or two · 6–15 mm today";
  await dwell(page, LINE);
  const got = await page.evaluate(() => {
    const said = document.querySelector("#spread-lattice .said");
    const sep = said.querySelector(".said__sep--first");
    return { text: said.textContent, sepBreak: said.dataset.sepBreak ?? null, sepHeight: sep?.getBoundingClientRect().height ?? null, overfit: said.dataset.overfit ?? null };
  });
  expect(got.text).toBe(LINE);
  expect(got.sepBreak).toBe("1");
  expect(got.sepHeight, "the first dot is still drawn — the --first rule did not apply").toBe(0);
  expect(got.overfit).toBeNull();
  expect(errors).toEqual([]);
});

test("ON: the glance obeys the same rule as the spread", async ({ page }) => {
  const errors = await boot(page, true);
  await page.evaluate((text) => {
    window.__forceCandidate([{ id: "spec:glance", source: "weather", score: 80, cooldownMs: 0, text }]);
    window.__v3Presence(true);
    return window.__v3Tick();
  }, RAIN);
  const got = await read(page, "#glance-said");
  expect(got.text).toBe(RAIN);
  expect(got.lines).toBeLessThanOrEqual(2);
  expect(got.glueLines).toBe(1);
  expect(errors).toEqual([]);
});
