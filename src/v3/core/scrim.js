/* ═══════════════════════════════════════════════════════════════════════════
   SCRIM — the measured half of legibility over photography.

   Blur is not a material in V3. `backdrop-filter` re-reads the layer beneath it
   every frame and its cost scales with radius x area; a shaped gradient scrim is
   one composite with no readback, and it is more legible. What it is not, on its
   own, is CORRECT: a fixed opacity is a guess that is too heavy on a dark photo
   (the photograph disappears for nothing) and too light on a bright one (the
   text goes). --scrim-opacity was that guess, hardcoded at 0.55, for every
   photograph the house owns.

   This module measures instead. Once per photo:

     1. Sample the photo as the WALL ACTUALLY SHOWS IT — object-fit: cover crops
        it, so the source's bottom band is not the screen's bottom band.
     2. Weight each sample by how much scrim actually covers it. The gradient is
        shaped; a cell above the 88% stop gets no protection at any opacity, and
        pretending otherwise would drive the opacity up to fix text that the
        scrim was never under.
     3. Solve for the smallest opacity that puts the PRIMARY ink over the
        contrast target, and take the 90th-percentile cell rather than the mean.

   What it guarantees, precisely: --ink meets the target across the text band,
   or the report says it did not. Every other ink's real ratio is measured and
   published rather than solved for — see `chooseAlpha` for why solving for the
   dim inks costs the photograph and buys the text nothing.

   ⚠ ON THE PERCENTILE. The plan says "mean luminance". The mean is the wrong
   statistic and it is worth being explicit about why: contrast is a worst-case
   property, and a mean over the band is precisely what hides the bright patch
   that is the only part which actually fails. p90 protects nearly all of the
   band while refusing to black out an entire photograph for one specular
   highlight in 1/144th of it — and the wide text-shadow is the second,
   independent mechanism that carries that last case. Redundancy is why distance
   signage works.

   The maths below is pure — no DOM, no IO — so it unit-tests in plain node,
   the same as attentionRank.js and localIntents.js. Everything above the second
   banner is pure; only the block beneath it touches the document.
   ═══════════════════════════════════════════════════════════════════════════ */

/* WCAG 2.x asks 4.5:1 for body text. That ratio was derived for near reading;
   this is a 32" panel at 3-4 m, where distance eats contrast, so V3 targets 7:1.
   See docs/design/ and the V3 plan §6. */
export const CONTRAST_TARGET = 7;

/* The opacity is clamped rather than free. Below the floor the scrim stops
   being a shape at all and the composition loses its base; above the ceiling
   the photograph is gone from the bottom of the wall, and a ground you cannot
   see is not a ground. When the target cannot be met inside these bounds we
   clamp AND SAY SO — see `reached` on the report — rather than quietly
   surrendering the photo or quietly surrendering the text. */
export const SCRIM_MIN = 0.30;
export const SCRIM_MAX = 0.85;

/* The sample grid, per the plan. 144 cells is enough that a window or a sky is
   its own cell rather than being averaged into the wall beside it, and small
   enough that the whole measurement is one drawImage and one getImageData. */
export const GRID_W = 16;
export const GRID_H = 9;

/* Which cells count as "the region under the text".

   ⚠ MEASURED, NOT CHOSEN. At 0.25 this took in cells up around y=0.72, where
   the gradient has already thinned to ~0.39 — and those cells then dominated
   the percentile, because a cell the scrim barely covers always needs more
   opacity than a bright cell it covers fully. The result was an opacity pinned
   at the ceiling for every photograph from a dark one upward: a measurement
   that had stopped measuring the photograph and started measuring the geometry.

   0.6 is the height at which the scrim is actually doing its work (y <= ~0.46),
   and that is not a coincidence — the gradient's shape IS the design's
   statement about where text lives. The hour and the rail sit near y=0.1, and
   the dominant cell's text, which bottom-aligns in lattice row 5 of 7, lands
   near y=0.32. All of them are inside it. Above it the second mechanism, the
   wide text-shadow, is what carries the text, because no opacity can. */
export const BAND_MIN_COVERAGE = 0.6;

/* ── The gradient's own shape ───────────────────────────────────────────────
   ⚠ COUPLED TO --scrim IN tokens.css. These are the stops of that gradient,
   as fractions of the viewport height measured FROM THE BOTTOM (the gradient
   is `to top`), paired with the multiplier they apply to --scrim-opacity.
   If the gradient there changes, change these — tests/v3-scrim.spec.js reads
   tokens.css and fails if the two drift apart, because a coverage model that
   silently disagrees with the gradient would produce a confidently wrong
   opacity and nothing would look broken.
─────────────────────────────────────────────────────────────────────────── */
export const SCRIM_STOPS = [
  { y: 0.00, k: 1.00 },
  { y: 0.38, k: 0.72 },
  { y: 0.88, k: 0.00 }
];

/**
 * How much of --scrim-opacity actually lands at height `y` above the bottom.
 * Linear between stops, which is what a CSS gradient does between two stops of
 * the same colour differing only in alpha.
 */
export function gradientCoverage(y) {
  if (y <= SCRIM_STOPS[0].y) return SCRIM_STOPS[0].k;
  for (let i = 1; i < SCRIM_STOPS.length; i++) {
    const a = SCRIM_STOPS[i - 1];
    const b = SCRIM_STOPS[i];
    if (y <= b.y) return a.k + ((b.k - a.k) * (y - a.y)) / (b.y - a.y);
  }
  return 0;
}

/* ── Colour ─────────────────────────────────────────────────────────────────
   All channel values below are sRGB in 0..1, GAMMA-ENCODED. That is not a
   detail: CSS composites alpha in the device colour space, not in linear light,
   so the mix must happen on the encoded values and only the RESULT is
   linearised for luminance. Mixing in linear light here would produce a
   noticeably different — and wrong — answer on mid-tones.
─────────────────────────────────────────────────────────────────────────── */
const linearise = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance of a gamma-encoded sRGB triple. */
export function relLuminance([r, g, b]) {
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** WCAG contrast ratio. Order-independent. */
export function contrastRatio(a, b) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `over` composited onto opaque `under` at `alpha`, the way the browser does it. */
export function compositeOver(over, under, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  return [0, 1, 2].map((i) => over[i] * a + under[i] * (1 - a));
}

/**
 * The best contrast this ink could ever have against this scrim — the value at
 * full opacity and full coverage. An ink whose ceiling is below the target
 * cannot be rescued by ANY scrim, and the honest response to that is to report
 * it as a token defect rather than to drive the opacity to the ceiling trying.
 */
export function inkCeiling(ink, scrim) {
  return contrastRatio(ink, scrim);
}

/**
 * The smallest --scrim-opacity that puts `ink` over `target` against this photo
 * sample, given how much scrim covers it.
 *
 * Returns 0 when the photo is already dark enough on its own, and Infinity when
 * the target is unreachable at this coverage — the caller decides what to do
 * about that, because "clamp silently" and "report a shortfall" are different
 * behaviours and only one of them is honest.
 */
export function requiredAlpha(photo, scrim, ink, opts = {}) {
  const { target = CONTRAST_TARGET, coverage = 1, maxAlpha = SCRIM_MAX } = opts;
  const ratioAt = (a) => contrastRatio(ink, compositeOver(scrim, photo, Math.min(1, coverage * a)));

  if (ratioAt(0) >= target) return 0;
  if (coverage <= 0 || ratioAt(maxAlpha) < target) return Infinity;

  // Monotone in alpha once we know both ends, so bisection is exact to ~4e-6
  // in 18 steps. Closed form is possible but the piecewise gamma transfer makes
  // it long and easy to get subtly wrong; this is provably right and runs once
  // per photograph.
  let lo = 0;
  let hi = maxAlpha;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (ratioAt(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

function percentileIndexOf(length, p) {
  return Math.min(length - 1, Math.max(0, Math.ceil(p * length) - 1));
}

function percentileOf(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[percentileIndexOf(sorted.length, p)];
}

/** The cells the scrim is actually working on: the region under the text. */
export function textBand(cells) {
  return cells.filter((c) => c.coverage >= BAND_MIN_COVERAGE);
}

/**
 * Choose the opacity for one photograph, for ONE ink.
 *
 * ⚠ ONE ink, and specifically the primary one — this was measured the hard way.
 * Solving for the dimmest ink as well sounds strictly safer and is not: 7:1
 * against --ink-dim needs the composited background down at Y <= 0.015, which
 * over a photograph means obliterating it. Solving for it pinned the opacity at
 * the ceiling on every daytime photograph from a dark one upward, blacking out
 * the bottom of the ground on every ordinary day WITHOUT EVER REACHING THE
 * TARGET — the photograph paid in full and the text got nothing.
 *
 * So the contract is: the scrim GUARANTEES the target for the primary ink, and
 * every other ink's real ratio is measured and published (see `worstRatio`)
 * rather than chased. A secondary ink that falls short is a token to lift, not
 * a photograph to destroy — which is the same conclusion the incumbent surface
 * reached about --ink-faint on the wall.
 *
 * @param {Array<{rgb:number[], coverage:number}>} cells  the sampled grid
 * @param {object} opts  { scrim, ink, target, percentile, min, max }
 */
export function chooseAlpha(cells, opts) {
  const {
    scrim,
    ink,
    target = CONTRAST_TARGET,
    percentile = 0.9,
    min = SCRIM_MIN,
    max = SCRIM_MAX
  } = opts;

  const band = textBand(cells);
  const lums = band.map((c) => relLuminance(c.rgb)).sort((a, b) => a - b);
  const report = {
    sampled: band.length,
    meanLuminance: band.length ? lums.reduce((s, v) => s + v, 0) / lums.length : 0,
    p90Luminance: percentileOf(lums, percentile)
  };

  // No band means no text region under the scrim — nothing to protect, so rest
  // at the floor rather than inventing a reason to darken the photograph.
  if (!band.length || !ink) {
    return { alpha: min, reached: true, shortfallCells: 0, worst: Infinity, ...report };
  }

  /* ⚠ THE PERCENTILE IS OVER BRIGHTNESS, AND THE COVERAGE IS THE WORST ONE.
     Not a percentile over required-opacity, which is what this did first and
     which was wrong in a way that only a real photograph exposed.

     Required opacity is monotone in coverage, so ranking cells by it ranks them
     mostly by HEIGHT: the lowest-covered row of the band is a quarter of it, and
     the 90th percentile lands inside that row every time. The percentile was
     therefore selecting for geometry again — the same confound that BAND_MIN_
     COVERAGE was raised to fix, arriving by a second road — and the brightness
     robustness it was supposed to buy was mostly not being bought at all.

     Separating them is the fix: the percentile does the one job it is good at
     (ignore the specular highlight, take the photograph's real brightness), and
     the geometry is handled exactly, at the hardest point that still counts. */
  const byLuminance = [...band].sort((a, b) => relLuminance(a.rgb) - relLuminance(b.rgb));
  const representative = byLuminance[percentileIndexOf(byLuminance.length, percentile)];
  const hardestCoverage = band.reduce((m, c) => Math.min(m, c.coverage), Infinity);

  const need = requiredAlpha(representative.rgb, scrim, ink, {
    target,
    coverage: hardestCoverage,
    maxAlpha: max
  });
  const alpha = Math.min(max, Math.max(min, Number.isFinite(need) ? need : max));

  // Measured after the fact rather than inferred: how much of the band actually
  // sits below the target at the opacity we chose, and how bad the worst of it
  // is. `reached` is about the representative cell — by construction the top
  // decile of brightness may still fall short, and saying otherwise is the
  // overclaim this replaces.
  const shortfallCells = band.filter(
    (c) => contrastRatio(ink, compositeOver(scrim, c.rgb, Math.min(1, c.coverage * alpha))) < target
  ).length;

  return {
    alpha,
    reached: Number.isFinite(need),
    shortfallCells,
    worst: worstRatio(cells, scrim, ink, alpha),
    ...report
  };
}

/**
 * What an ink ACTUALLY measures at, once the opacity is chosen: the worst
 * contrast anywhere in the text band. This is the number a contrast sweep
 * should read — the ceiling says what an ink could ever manage, this says what
 * it manages today, over this photograph, at this opacity.
 */
export function worstRatio(cells, scrim, ink, alpha, minCoverage = BAND_MIN_COVERAGE) {
  const band = cells.filter((c) => c.coverage >= minCoverage);
  if (!band.length) return Infinity;
  return band.reduce((worst, c) => {
    const bg = compositeOver(scrim, c.rgb, Math.min(1, c.coverage * alpha));
    return Math.min(worst, contrastRatio(ink, bg));
  }, Infinity);
}

/**
 * The source rectangle `object-fit: cover` actually shows, at the default
 * `object-position: 50% 50%`.
 *
 * ⚠ Sampling the whole source instead of this rectangle is the quiet bug in
 * this module's shape: a 3:2 photograph on a 16:9 wall has its top and bottom
 * cropped away, so the source's bottom band — the part a naive sample would
 * weight most heavily — is never on the screen at all.
 */
export function coverRect(natW, natH, boxW, boxH) {
  const scale = Math.max(boxW / natW, boxH / natH);
  const sw = boxW / scale;
  const sh = boxH / scale;
  return { sx: (natW - sw) / 2, sy: (natH - sh) / 2, sw, sh };
}

/* ═══════════════════════════════════════════════════════════════════════════
   The DOM half. Everything above is pure; everything below reads the document.
   ═══════════════════════════════════════════════════════════════════════════ */

/* The ink tokens that are actually painted over the photograph, brightest
   first. The order matters: index 0 is the fallback when nothing else can
   reach the target. */
const INK_TOKENS = ["--ink", "--ink-dim", "--ink-faint"];

let sampleCanvas = null;
let probeCanvas = null;
let currentImg = null;
let last = { alpha: null, reason: "not sampled yet" };

/* A colour that does not exist anywhere in the palette. If it survives an
   assignment, the browser refused to parse the colour we handed it (an old
   Chromium with no oklch() in canvas, or a token that has gone malformed) and
   every number downstream would be built on black ink. Better to bail. */
const SENTINEL = [1, 0, 1];

/**
 * Resolve any CSS colour string — oklch(), color-mix(), a hex — to sRGB by
 * making the browser paint it. This is deliberately not a colour-space
 * implementation: the renderer's answer is the one on the wall, and a
 * hand-rolled OKLCH->sRGB conversion would be a second opinion that can drift
 * from it silently.
 */
function resolveColor(css) {
  if (!css) return null;
  if (!probeCanvas) probeCanvas = document.createElement("canvas");
  probeCanvas.width = 1;
  probeCanvas.height = 1;
  const ctx = probeCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.fillStyle = `rgb(${SENTINEL.map((c) => c * 255).join(",")})`;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);

  let px;
  try { px = ctx.getImageData(0, 0, 1, 1).data; }
  catch { return null; }

  const rgb = [px[0] / 255, px[1] / 255, px[2] / 255];
  const unparsed = rgb.every((c, i) => Math.abs(c - SENTINEL[i]) < 0.004);
  return unparsed ? null : rgb;
}

/**
 * Sample the photograph as the wall shows it.
 * @returns {Array<{rgb:number[], coverage:number}>|null} null when the image
 *          has no pixels yet, or when the canvas is tainted.
 */
export function sampleCells(img, boxW, boxH) {
  if (!img?.naturalWidth || !img.naturalHeight || !boxW || !boxH) return null;

  if (!sampleCanvas) sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = GRID_W;
  sampleCanvas.height = GRID_H;
  const ctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // High-quality downscale so each cell is a genuine area mean of its region
  // rather than one arbitrarily chosen pixel out of ~14,000.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const { sx, sy, sw, sh } = coverRect(img.naturalWidth, img.naturalHeight, boxW, boxH);
  let data;
  try {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, GRID_W, GRID_H);
    data = ctx.getImageData(0, 0, GRID_W, GRID_H).data;
  } catch {
    // A cross-origin photo taints the canvas. Ours are same-origin through
    // /api/immich, so this is a "something changed" signal, not a normal path.
    return null;
  }

  const cells = [];
  for (let row = 0; row < GRID_H; row++) {
    // Height of this row's centre above the BOTTOM of the frame, which is the
    // axis the gradient is written along.
    const y = 1 - (row + 0.5) / GRID_H;
    const coverage = gradientCoverage(y);
    for (let col = 0; col < GRID_W; col++) {
      const i = (row * GRID_W + col) * 4;
      cells.push({ rgb: [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255], coverage });
    }
  }
  return cells;
}

function record(reason) {
  last = { ...last, reason };
  return last;
}

/**
 * Measure one photograph and set --scrim-opacity from it.
 *
 * @param {HTMLImageElement} img
 * @param {{transitioning?: boolean}} opts  During a day-boundary cross-fade
 *        both photographs are on the glass at once, so the opacity may only
 *        RISE — settling to the incoming photo's own value once the old one is
 *        gone. Lowering it mid-fade would un-protect the outgoing photo for a
 *        minute, which is a minute of unreadable text once a day.
 */
export function applyScrim(img, opts = {}) {
  const target = img ?? currentImg;
  if (!target) return record("no photograph");
  currentImg = target;

  const root = document.documentElement;
  const cs = getComputedStyle(root);

  const scrim = resolveColor(cs.getPropertyValue("--scrim-base").trim());
  if (!scrim) return record("--scrim-base unreadable");

  const inks = INK_TOKENS
    .map((token) => ({ token, rgb: resolveColor(cs.getPropertyValue(token).trim()) }))
    .filter((i) => i.rgb);
  if (!inks.length) return record("ink tokens unreadable");

  const cells = sampleCells(target, window.innerWidth, window.innerHeight);
  if (!cells) return record("photograph not sampleable");

  // The primary ink is the one the scrim guarantees. Everything else is
  // measured and published — see chooseAlpha for why solving for the dim inks
  // costs the photograph and buys nothing.
  const chosen = chooseAlpha(cells, { scrim, ink: inks[0].rgb });

  const applied = opts.transitioning
    ? Math.max(chosen.alpha, Number(cs.getPropertyValue("--scrim-opacity")) || 0)
    : chosen.alpha;

  root.style.setProperty("--scrim-opacity", applied.toFixed(3));

  last = {
    alpha: Number(applied.toFixed(3)),
    measured: Number(chosen.alpha.toFixed(3)),
    reached: chosen.reached,
    shortfallCells: chosen.shortfallCells,
    sampled: chosen.sampled,
    meanLuminance: Number(chosen.meanLuminance.toFixed(4)),
    p90Luminance: Number(chosen.p90Luminance.toFixed(4)),
    target: CONTRAST_TARGET,
    transitioning: Boolean(opts.transitioning),
    // ⚠ THE NUMBERS TO READ IN A CONTRAST SWEEP are `worst` and `atFloor` —
    // what each ink actually measures at, over this photograph, at this
    // opacity. They are the two ends of the band and they differ a lot, because
    // the gradient thins as it rises: `worst` is the top edge (~y 0.39, where
    // the dominant cell's text bottom-aligns) and `atFloor` is the bottom
    // (~y 0.1, where the hour and the rail sit). Quoting only one of them
    // misreads the surface in one direction or the other.
    //
    // `ceiling` is the best that ink could EVER do, against a fully opaque
    // scrim. An ink whose ceiling is already under the target can never pass at
    // any opacity, over any photograph — that is a token to lift, and no amount
    // of scrim is the fix.
    inks: inks.map((i) => ({
      token: i.token,
      ceiling: Number(inkCeiling(i.rgb, scrim).toFixed(2)),
      worst: Number(worstRatio(cells, scrim, i.rgb, applied).toFixed(2)),
      atFloor: Number(worstRatio(cells, scrim, i.rgb, applied, 0.9).toFixed(2)),
      guaranteed: i === inks[0]
    })),
    reason: "measured"
  };
  return last;
}

/** Re-measure the photograph already on the glass — for the night flip, which
 *  changes the ink and therefore changes the answer. */
export function resampleScrim(opts = {}) {
  return currentImg ? applyScrim(currentImg, opts) : record("no photograph");
}

export function initScrim() {
  // House convention: every surface exposes a read-only probe so the kiosk CDP
  // sweeps and the contrast spec can read the real number rather than infer it.
  window.__scrim = () => last;
  window.__resampleScrim = (opts) => resampleScrim(opts);
  // Measure whatever is in #ground right now. The specs drive this with a
  // known image rather than waiting on Immich, and the kiosk sweep uses it to
  // force a re-measure without reloading the page and losing the soak clock.
  window.__applyScrim = (opts) => applyScrim(document.getElementById("ground"), opts);
}
