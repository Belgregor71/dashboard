/* THE GRADE (features.v3GoldenHour) — the light of the hour, worn by the journey photograph.

   Since v3MemoryJourney the sky field is never seen at depth 0 (the photograph covers the
   wall), so the owner's answer was: weather and time of day go ON THE PHOTO ITSELF. Five
   looks, each approved from a still on 2026-11-14 (docs/design/HANDOVER-threejs-ambient-build.md,
   Phase B). The CSS for them lives in journey.css under `.journey__grade[data-look=…]`, copied
   from those stills; this module only decides WHICH look, and tells the shade solver what
   each look does to a pixel so the words keep their contrast over the graded photograph.

   Pure: no DOM. journey.js resolves the colours (scrim.js resolveColor) and samples. */

/** Sun altitude bands, degrees. Civil twilight is −6..0. */
export const GRADE_BANDS = Object.freeze({ nightBelow: -6, goldenFrom: 0, lateFrom: 6, dayFrom: 15 });

/** At or above this cloud fraction there is no sun to be golden. Twilight and night stand. */
export const OVERCAST = 0.7;

/**
 * Which look the hour wears, or null for none.
 *
 * @param {{sunAltDeg:number, cloud?:number|null, raining?:boolean}} s
 * @returns {"night"|"dusk"|"golden"|"late"|"rain"|null}
 */
export function gradeOf({ sunAltDeg, cloud = null, raining = false } = {}) {
  if (!Number.isFinite(sunAltDeg)) return null;          // no sun reading → no claim about the light
  if (sunAltDeg < GRADE_BANDS.nightBelow) return "night";
  if (raining) return "rain";
  if (sunAltDeg < GRADE_BANDS.goldenFrom) return "dusk";  // dawn's twilight too: same light, other side
  if (sunAltDeg >= GRADE_BANDS.dayFrom) return null;
  if (Number.isFinite(cloud) && cloud >= OVERCAST) return null;
  return sunAltDeg < GRADE_BANDS.lateFrom ? "golden" : "late";
}

/* What each look does under each corner's words, for the shade solver. `memory` is the
   top-right block (x ≥ 1080, y < 360), `today` the bottom-left (x < 840, y ≥ 720) — the
   same blocks solveShades samples. Each corner lists the gradient at the ENDS of the
   stretch it spans; the solver tries every entry and keeps the brightest result, so the
   shade is solved for the corner's worst point, not its average.
   multiply: [css colour, alpha] — CSS multiply at that alpha: out = rgb·(1 − a + a·c).
   Multiply only darkens, so its worst point is the LIGHTEST colour over the block.
   Rain is the one look that can LIGHTEN a pixel (a grey veil over shadow): filter on
   the photo, then the veil, both ends of the block's stretch of the gradient.
   Measured, not assumed: modelling the date block at the gradient's END stop put the
   real wall at 3.35:1 under rain (v3-contrast `grade`, 2026-11-14); its top edge sits
   at 67 % down, under a lighter, denser veil.
   Positions: dusk is 200deg over the wall (gradient length 1672 px): memory spans
   t 0–0.37, today t 0.63–1. Rain is top-to-bottom: memory t 0–⅓, today t ⅔–1. The
   golden/late radials centre on the memory corner; the today block's nearest point is
   ~0.58 of the radius out, just past the 55 % / 60 % stop. Interpolated in oklch. */
export const GRADE_EFFECT = Object.freeze({
  dusk:   { multiply: { memory: [["oklch(0.62 0.10 300)", 0.55]], today: [["oklch(0.42 0.075 281)", 0.55]] } },
  golden: { multiply: { memory: [["oklch(0.93 0.09 72)", 1]], today: [["oklch(0.80 0.13 52)", 1]] } },
  late:   { multiply: { memory: [["oklch(0.97 0.04 80)", 1]], today: [["oklch(0.905 0.07 68)", 1]] } },
  night:  { multiply: { memory: [["oklch(0.32 0.05 265)", 0.62]], today: [["oklch(0.32 0.05 265)", 0.62]] } },
  rain:   {
    saturate: 0.62,
    brightness: 0.92,
    veil: {
      memory: [["oklch(0.62 0.01 250)", 0.38], ["oklch(0.563 0.01 250)", 0.353]],
      today: [["oklch(0.507 0.01 250)", 0.327], ["oklch(0.45 0.01 250)", 0.30]]
    }
  }
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/* CSS filter saturate(s): the Filter Effects matrix, on encoded sRGB like the browser. */
function saturate([r, g, b], s) {
  return [
    clamp01((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
    clamp01((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
    clamp01((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b)
  ];
}

/**
 * A pixel as the wall shows it under `look`, at one corner.
 *
 * @param {number[]} rgb      encoded sRGB 0..1, as sampled
 * @param {string|null} look
 * @param {"memory"|"today"} corner
 * @param {(css:string)=>number[]|null} resolve  CSS colour → encoded sRGB 0..1
 * @returns {number[]}
 */
export function gradePixel(rgb, look, corner, resolve) {
  const fx = look ? GRADE_EFFECT[look] : null;
  if (!fx) return rgb;
  const base = fx.multiply ? rgb : saturate(rgb, fx.saturate).map((v) => clamp01(v * fx.brightness));
  let best = null;
  let bestL = -1;
  for (const [css, a] of (fx.multiply ?? fx.veil)[corner]) {
    const c = resolve(css);
    if (!c) continue;
    const out = fx.multiply
      ? base.map((v, i) => clamp01(v * (1 - a + a * c[i])))
      : base.map((v, i) => v * (1 - a) + c[i] * a);
    const l = lum(out);
    if (l > bestL) { bestL = l; best = out; }
  }
  // Nothing resolved (a browser that cannot parse oklch): multiply's untinted pixel is
  // its brightest, so that is safe-side. Rain's is NOT — the veil can lighten — but the
  // only browser this runs in (the kiosk's Chromium) resolves oklch.
  return best ?? base;
}

const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
