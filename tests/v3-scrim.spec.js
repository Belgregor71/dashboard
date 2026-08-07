import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import {
  relLuminance,
  contrastRatio,
  compositeOver,
  gradientCoverage,
  coverRect,
  requiredAlpha,
  chooseAlpha,
  worstRatio,
  inkCeiling,
  SCRIM_STOPS,
  SCRIM_MIN,
  SCRIM_MAX,
  CONTRAST_TARGET,
  BAND_MIN_COVERAGE
} from "../src/v3/core/scrim.js";

/* The scrim is the only thing standing between text and a photograph, and its
   opacity used to be a hardcoded guess. These tests are in two halves that do
   not mix: the maths is pure and runs in plain node, and only the last block
   needs a browser — which is the same split the fast lane uses, and for the
   same reason. If the maths ever needs a page, it has stopped being maths. */

const WHITE = [1, 1, 1];
const BLACK = [0, 0, 0];
const SCRIM = [0.02, 0.019, 0.017];   // ~oklch(0.08 0.01 65), the scrim base

// ── The maths ───────────────────────────────────────────────────────────────

test("luminance and contrast agree with WCAG at the extremes", () => {
  expect(relLuminance(WHITE)).toBeCloseTo(1, 6);
  expect(relLuminance(BLACK)).toBeCloseTo(0, 6);
  expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 3);
  // Order-independent — the ratio is a property of the pair, not of which one
  // you happened to pass first.
  expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 3);
});

test("compositing happens in gamma space, the way the browser does it", () => {
  // Half-opacity black over white is 0.5 ENCODED, which is ~0.214 in linear
  // light. Mixing in linear light instead would give 0.5 luminance — more than
  // twice as bright — and every opacity this module chooses would be wrong.
  const mid = compositeOver(BLACK, WHITE, 0.5);
  expect(mid[0]).toBeCloseTo(0.5, 6);
  expect(relLuminance(mid)).toBeCloseTo(0.2140, 3);
});

test("coverage follows the gradient's own stops, and dies above the last one", () => {
  expect(gradientCoverage(0)).toBeCloseTo(1, 6);
  expect(gradientCoverage(0.38)).toBeCloseTo(0.72, 6);
  expect(gradientCoverage(0.88)).toBeCloseTo(0, 6);
  // Above the final stop there is no scrim at all, so no opacity can help text
  // that sits there — the text-shadow is what carries it.
  expect(gradientCoverage(0.95)).toBe(0);
  // Monotonically decreasing upward, with no step anywhere.
  for (let y = 0; y < 1; y += 0.05) {
    expect(gradientCoverage(y + 0.05)).toBeLessThanOrEqual(gradientCoverage(y) + 1e-9);
  }
});

test("the coverage model has not drifted from the gradient in tokens.css", () => {
  // ⚠ This is the guard that matters most in the file. A gradient edited in the
  // stylesheet without editing SCRIM_STOPS would leave the sampler weighting
  // cells against a shape that no longer exists — producing a confident,
  // precise, wrong opacity with nothing visibly broken to point at it.
  const css = readFileSync(
    fileURLToPath(new URL("../src/v3/css/tokens.css", import.meta.url)),
    "utf8"
  );
  const scrimBlock = css.slice(css.indexOf("--scrim:"), css.indexOf("--ink-shadow"));

  // Positional stops only: a percentage that follows a completed colour value,
  // never the one inside calc(var(--scrim-opacity) * 72%).
  const percents = [...scrimBlock.matchAll(/(?:\)|transparent)\s+(\d+)%/g)].map((m) => Number(m[1]) / 100);
  expect(percents).toEqual(SCRIM_STOPS.map((s) => s.y));

  // And each stop's multiplier of --scrim-opacity, written in the CSS as a
  // calc() on the token. The final stop is bare `transparent`, so it carries no
  // calc and is checked as the implicit zero.
  const mults = [...scrimBlock.matchAll(/--scrim-opacity\)\s*\*\s*(\d+)%/g)].map((m) => Number(m[1]) / 100);
  expect(mults).toEqual(SCRIM_STOPS.filter((s) => s.k > 0).map((s) => s.k));
  expect(SCRIM_STOPS[SCRIM_STOPS.length - 1].k).toBe(0);
  expect(scrimBlock).toContain("transparent 88%");
});

test("the sample rectangle is the crop the wall actually shows", () => {
  // A 3:2 photograph on a 16:9 wall: cover fills the width and crops top and
  // bottom, so the source's own bottom band is never on the screen. Sampling
  // the whole source would weight exactly the pixels nobody sees.
  const { sx, sy, sw, sh } = coverRect(3000, 2000, 1920, 1080);
  expect(sx).toBeCloseTo(0, 6);
  expect(sw).toBeCloseTo(3000, 6);
  expect(sh).toBeCloseTo(1687.5, 3);
  expect(sy).toBeCloseTo((2000 - 1687.5) / 2, 3);   // centred, per object-position 50%

  // And the other way: a portrait crops the sides instead.
  const tall = coverRect(1000, 2000, 1920, 1080);
  expect(tall.sw).toBeCloseTo(1000, 6);
  expect(tall.sh).toBeCloseTo(562.5, 3);
});

test("a bright photograph needs more scrim than a dark one", () => {
  const bright = requiredAlpha(WHITE, SCRIM, WHITE, { coverage: 1 });
  const dim = requiredAlpha([0.4, 0.4, 0.4], SCRIM, WHITE, { coverage: 1 });
  expect(bright).toBeGreaterThan(dim);
  expect(bright).toBeLessThanOrEqual(SCRIM_MAX);

  // Already dark enough on its own: white ink on a near-black photo clears 7:1
  // with no scrim at all, and darkening it would cost the photograph for
  // nothing.
  expect(requiredAlpha([0.05, 0.05, 0.05], SCRIM, WHITE, { coverage: 1 })).toBe(0);
});

test("less coverage means more opacity is needed, and eventually none is enough", () => {
  const full = requiredAlpha(WHITE, SCRIM, WHITE, { coverage: 1 });
  const half = requiredAlpha(WHITE, SCRIM, WHITE, { coverage: 0.5 });
  expect(half).toBeGreaterThan(full);
  // Where the gradient has run out, the answer is honestly "unreachable"
  // rather than a large number that looks like an answer.
  expect(requiredAlpha(WHITE, SCRIM, WHITE, { coverage: 0 })).toBe(Infinity);
});

test("the chosen opacity actually delivers the target it was solved for", () => {
  // The whole point: not "it looks about right", but "at this opacity the ink
  // measures at or above 7:1 against this photograph".
  const alpha = requiredAlpha([0.62, 0.6, 0.55], SCRIM, WHITE, { coverage: 0.8 });
  const bg = compositeOver(SCRIM, [0.62, 0.6, 0.55], 0.8 * alpha);
  expect(contrastRatio(WHITE, bg)).toBeGreaterThanOrEqual(CONTRAST_TARGET - 0.01);
});

test("an ink that cannot reach the target at any opacity is reported, not chased", () => {
  // The ceiling is the contrast against a fully opaque scrim. An ink below it
  // is a TOKEN defect: no photograph and no opacity can rescue it, and driving
  // the opacity to the ceiling trying would black out the ground on every
  // photograph forever and still fall short.
  const faint = [0.52, 0.51, 0.48];
  expect(inkCeiling(faint, SCRIM)).toBeLessThan(CONTRAST_TARGET);
  expect(requiredAlpha(faint, SCRIM, faint, { coverage: 1 })).toBe(Infinity);
  expect(inkCeiling(WHITE, SCRIM)).toBeGreaterThan(CONTRAST_TARGET);
});

// ── Choosing from a whole photograph ────────────────────────────────────────

const cellsAt = (rgb, coverage = 1, n = 100) => Array.from({ length: n }, () => ({ rgb, coverage }));

test("one bright cell does not black out the whole photograph", () => {
  // 99 dark cells and one specular highlight. The mean would hide the highlight
  // entirely; the maximum would surrender the photograph to it. p90 keeps the
  // ground, and the wide text-shadow is the second mechanism that covers the
  // one cell this deliberately does not.
  const cells = [...cellsAt([0.08, 0.08, 0.08], 1, 99), { rgb: WHITE, coverage: 1 }];
  const { alpha } = chooseAlpha(cells, { scrim: SCRIM, ink: WHITE });
  expect(alpha).toBe(SCRIM_MIN);

  // But a photograph that is bright ACROSS the band is not a highlight, and
  // gets the opacity it needs.
  const blown = chooseAlpha(cellsAt(WHITE, 1), { scrim: SCRIM, ink: WHITE });
  expect(blown.alpha).toBeGreaterThan(SCRIM_MIN);
});

test("the opacity tracks how bright the photograph is", () => {
  // The whole point of measuring: three photographs, three answers, in order.
  // A single hardcoded value cannot be right for more than one of them.
  // Values chosen above the floor on purpose: pure white ink clears 7:1 on
  // anything below ~0.45 encoded with no scrim at all, so a darker trio would
  // all clamp to SCRIM_MIN and the test would compare three identical numbers
  // and pass for the wrong reason.
  const at = (v) => chooseAlpha(cellsAt([v, v, v], 0.8), { scrim: SCRIM, ink: WHITE }).alpha;
  expect(at(0.5)).toBeLessThan(at(0.7));
  expect(at(0.7)).toBeLessThan(at(0.95));
  expect(at(0.5)).toBeGreaterThan(SCRIM_MIN);
});

test("cells the scrim does not reach are excluded rather than solved for", () => {
  // A blazing sky at the top of the frame sits above the gradient's last stop.
  // Including it would peg the opacity at maximum to protect text that is not
  // there and could not be protected if it were.
  const above = cellsAt(WHITE, BAND_MIN_COVERAGE / 2);
  const { alpha, sampled } = chooseAlpha(above, { scrim: SCRIM, ink: WHITE });
  expect(sampled).toBe(0);
  expect(alpha).toBe(SCRIM_MIN);
});

test("the opacity is clamped at both ends, and says when the target was missed", () => {
  const dark = chooseAlpha(cellsAt(BLACK, 1), { scrim: SCRIM, ink: WHITE });
  expect(dark.alpha).toBe(SCRIM_MIN);
  expect(dark.reached).toBe(true);

  // Full coverage, white photo, and an ink that can never reach the target:
  // clamped to the ceiling AND flagged, so a sweep can see the shortfall rather
  // than reading a plausible number and believing it.
  const impossible = chooseAlpha(cellsAt(WHITE, 1), { scrim: SCRIM, ink: [0.52, 0.51, 0.48] });
  expect(impossible.alpha).toBe(SCRIM_MAX);
  expect(impossible.reached).toBe(false);
  expect(impossible.shortfallCells).toBeGreaterThan(0);
});

test("the opacity is solved at the hardest point of the band, not an average of it", () => {
  // ⚠ THE REGRESSION THIS EXISTS FOR. Ranking cells by required opacity ranks
  // them mostly by HEIGHT, because required opacity is monotone in coverage —
  // so a percentile over that quietly selected the thinnest-covered row and the
  // brightness robustness it was meant to buy was never bought. A flat test
  // image cannot catch it: every cell in a row is identical, so the two
  // statistics coincide and the wrong code passes.
  const photo = [0.55, 0.54, 0.5];
  const cells = [...cellsAt(photo, 0.70, 30), ...cellsAt(photo, 0.95, 70)];
  const { alpha, reached } = chooseAlpha(cells, { scrim: SCRIM, ink: WHITE });
  expect(reached).toBe(true);

  // The thin end of the band is the one that decides. If it clears the target,
  // the thick end certainly does.
  const thin = compositeOver(SCRIM, photo, 0.70 * alpha);
  expect(contrastRatio(WHITE, thin)).toBeGreaterThanOrEqual(CONTRAST_TARGET - 0.05);
});

test("a reported shortfall and a reported ratio cannot disagree", () => {
  // The two numbers on the report are derived separately and are read by
  // different things — the sweep reads `worst`, a human reads `shortfallCells`.
  // If they can contradict each other, one of them is lying.
  const mixed = [...cellsAt([0.92, 0.92, 0.9], 0.7, 20), ...cellsAt([0.2, 0.2, 0.22], 0.95, 80)];
  for (const cells of [mixed, cellsAt(BLACK, 1), cellsAt(WHITE, 1)]) {
    const r = chooseAlpha(cells, { scrim: SCRIM, ink: WHITE });
    if (r.worst < CONTRAST_TARGET) expect(r.shortfallCells).toBeGreaterThan(0);
    else expect(r.shortfallCells).toBe(0);
  }
});

test("the chosen opacity is checkable after the fact, at both ends of the band", () => {
  // worstRatio is what a contrast sweep reads. It must agree with the solve:
  // where the target was reached, the worst cell in the band actually measures
  // at or above it.
  const cells = [...cellsAt([0.45, 0.44, 0.42], 0.75, 50), ...cellsAt([0.45, 0.44, 0.42], 0.96, 50)];
  const { alpha, reached } = chooseAlpha(cells, { scrim: SCRIM, ink: WHITE });
  expect(reached).toBe(true);
  expect(worstRatio(cells, SCRIM, WHITE, alpha)).toBeGreaterThanOrEqual(CONTRAST_TARGET - 0.05);

  // And the bottom of the band always does better than the top, because the
  // gradient thins as it rises. Quoting one number for "the contrast" without
  // saying which end it came from misreads the surface.
  expect(worstRatio(cells, SCRIM, WHITE, alpha, 0.9))
    .toBeGreaterThan(worstRatio(cells, SCRIM, WHITE, alpha));
});

// ── On the page ─────────────────────────────────────────────────────────────

async function boot(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__applyScrim === "function", null, { timeout: 10_000 });
  return pageErrors;
}

/**
 * Put a photograph of a known, flat luminance on the glass and measure it.
 *
 * The image is painted in the page rather than pasted in as a base64 literal:
 * a hand-written PNG that fails to decode does not fail loudly here — the
 * sampler correctly refuses to measure a zero-pixel image, `applyScrim` keeps
 * the opacity it already had, and the test then reads a stale number that looks
 * entirely plausible. Asserting `reason` below is the second guard against
 * exactly that.
 */
async function measure(page, level, opts = {}, topLevel = null) {
  return page.evaluate(async ({ level, opts, topLevel }) => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 36;
    const ctx = c.getContext("2d");
    if (topLevel === null) {
      ctx.fillStyle = `rgb(${level}, ${level}, ${level})`;
    } else {
      // A photograph, roughly: bright at the top, darker toward the foreground.
      // Flat fills are right for testing the clamps and wrong for testing the
      // statistics, because they make every percentile agree with every other.
      const g = ctx.createLinearGradient(0, 0, 0, c.height);
      g.addColorStop(0, `rgb(${topLevel}, ${topLevel}, ${topLevel})`);
      g.addColorStop(1, `rgb(${level}, ${level}, ${level})`);
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, c.width, c.height);

    const img = document.getElementById("ground");
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = c.toDataURL("image/png");
    });
    return window.__applyScrim(opts);
  }, { level, opts, topLevel });
}

const WHITE_PHOTO = 255;
const BLACK_PHOTO = 0;

test("the scrim gradient parses on this browser", async ({ page }) => {
  await boot(page);
  // color-mix() and oklch() landed in the same Chrome release, and this whole
  // token file is oklch — but an unsupported --scrim would compute to nothing
  // and the scrim would silently not exist, which looks like "the photo is a
  // bit bright" rather than like a broken build.
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById("scrim")).backgroundImage);
  expect(bg).toContain("gradient");
  expect(bg).not.toBe("none");
});

test("the opacity is measured from the photograph, not guessed", async ({ page }) => {
  const pageErrors = await boot(page);

  const bright = await measure(page, WHITE_PHOTO);
  expect(bright.reason).toBe("measured");
  expect(bright.sampled).toBeGreaterThan(0);
  expect(bright.alpha).toBeGreaterThan(SCRIM_MIN);

  const dark = await measure(page, BLACK_PHOTO);
  expect(dark.reason).toBe("measured");
  expect(dark.alpha).toBe(SCRIM_MIN);
  expect(dark.meanLuminance).toBeLessThan(bright.meanLuminance);

  // And the number reached the stylesheet, rather than only the debug hook.
  const applied = await page.evaluate(() =>
    Number(getComputedStyle(document.documentElement).getPropertyValue("--scrim-opacity"))
  );
  expect(applied).toBeCloseTo(dark.alpha, 3);

  expect(pageErrors).toEqual([]);
});

test("every ink's real ratio is published, and exactly one is guaranteed", async ({ page }) => {
  await boot(page);
  // A varied photograph on purpose: a flat one makes every percentile agree, so
  // the report can be internally consistent for reasons that will not hold on
  // the wall. This is the shape that caught the percentile bug live.
  const report = await measure(page, 90, {}, 190);

  // Exactly one ink carries the guarantee, and it is the primary one. The rest
  // are measured and reported so a shortfall is a number somebody can act on
  // rather than an absence.
  expect(report.inks.filter((i) => i.guaranteed)).toHaveLength(1);
  expect(report.inks[0].guaranteed).toBe(true);

  // ⚠ NOT `worst >= target`. The solve protects the 90th percentile of
  // brightness, so the top decile may legitimately fall short — what must hold
  // is that the report SAYS SO. A green `reached` beside a failing `worst` was
  // the overclaim that shipped in 2b06815.
  if (report.inks[0].worst < report.target) {
    expect(report.shortfallCells).toBeGreaterThan(0);
  } else {
    expect(report.shortfallCells).toBe(0);
  }

  for (const ink of report.inks) {
    // Every ink reports both ends of the band, and neither can exceed the
    // ceiling — that is what makes the ceiling meaningful as a token verdict.
    expect(ink.worst).toBeLessThanOrEqual(ink.ceiling + 0.01);
    expect(ink.atFloor).toBeGreaterThanOrEqual(ink.worst - 0.01);
    expect(ink.atFloor).toBeLessThanOrEqual(ink.ceiling + 0.01);
  }
});

test("the opacity only rises while two photographs are on the glass", async ({ page }) => {
  await boot(page);
  const bright = await measure(page, WHITE_PHOTO);
  const during = await measure(page, BLACK_PHOTO, { transitioning: true });
  expect(during.reason).toBe("measured");

  // A day-boundary cross-fade runs for a minute with both photographs visible.
  // Dropping to the incoming photo's own opacity immediately would un-protect
  // the outgoing one for that whole minute — once a day, in daylight.
  expect(during.alpha).toBe(bright.alpha);
  expect(during.measured).toBeLessThan(during.alpha);

  // Once the old photograph is gone the incoming one's own value applies.
  const settled = await page.evaluate(() => window.__resampleScrim());
  expect(settled.alpha).toBe(SCRIM_MIN);
});

test("the ground survives an upstream that never answers", async ({ page }) => {
  const pageErrors = await boot(page);
  // Immich is unconfigured in this harness, so /api/immich/random returns an
  // empty set: no photograph, no latch left holding, and the substrate carries
  // depth 0 by itself. The failure that matters is a stuck `inFlight`, because
  // it is permanent on a page that runs for weeks.
  const ground = await page.evaluate(() => window.__ground());
  expect(ground.inFlight).toBe(false);
  expect(ground.assetId).toBeNull();
  expect(ground.layers).toBe(1);
  expect(pageErrors).toEqual([]);
});
