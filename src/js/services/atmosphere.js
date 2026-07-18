// Ambient atmosphere mapper — Phase 5 (docs/vision/phase-5-atmospherics.md).
// Pure function over { condition, isNight, hour } → an atmosphere token, same
// contract as predictiveRules.js / insightRules.js: no imports, no DOM, no IO,
// so the whole module unit-tests in plain node (tests/insights.spec.js).
//
// The token names a *resting* CSS state (a slow-settling tint), never a loop —
// the idle-freeze finding (project-gpu-idle-freeze) says any continuous
// animation re-composites the whole page at ~1 GPU core, so the phase-critical
// guardrail is: no token may map to a looping-animation class. The exported
// token set lets a test assert that against the CSS.

// Every token the mapper can return. Kept in sync with the .screensaver.atmo-*
// tint states in src/css/views/screensaver.css.
export const ATMOSPHERE_TOKENS = [
  "atmo-night",
  "atmo-night-clear",
  "atmo-clear-golden",
  "atmo-clear-day",
  "atmo-cloudy",
  "atmo-rain",
  "atmo-storm",
  "atmo-fog"
];

// Golden-hour bands (local hour) — the light goes warm near dawn/dusk. Outside
// these, clear sky rests on the neutral daytime tint.
const GOLDEN_MORNING_BEFORE = 8; // before 8am
const GOLDEN_EVENING_FROM = 16;  // 4pm onward

/**
 * Map the current weather + light into one resting atmosphere token.
 *
 * @param {object} input
 * @param {string} [input.condition] base weather category — one of
 *   clear|cloudy|rain|storm|fog (getBaseCategory output). Anything else rests
 *   on the calm daytime tint.
 * @param {boolean} [input.isNight] sunset→sunrise (screensaver's suncalc view).
 * @param {number} [input.hour] local hour 0–23, for the golden-hour warmth.
 * @param {boolean} [input.nightClear] Phase 3 nightSky opt-in: a clear night
 *   names atmo-night-clear (the starfield's resting state) instead of the
 *   generic night token. Default false → the pre-Phase-3 mapping, so the flag
 *   off is byte-identical.
 * @returns {string} a token from ATMOSPHERE_TOKENS.
 */
export function atmosphereFor({ condition, isNight, hour, nightClear } = {}) {
  // Night owns the scene — the dim clock (screensaver--night) already governs
  // the wash; atmosphere just names the state so it composes cleanly.
  if (isNight) {
    return nightClear === true && condition === "clear" ? "atmo-night-clear" : "atmo-night";
  }

  switch (condition) {
    case "rain":
      return "atmo-rain";
    case "storm":
      return "atmo-storm";
    case "cloudy":
      return "atmo-cloudy";
    case "fog":
      return "atmo-fog";
    case "clear":
    default: {
      const h = Number(hour);
      const golden =
        Number.isFinite(h) && (h < GOLDEN_MORNING_BEFORE || h >= GOLDEN_EVENING_FROM);
      return golden ? "atmo-clear-golden" : "atmo-clear-day";
    }
  }
}

// ── Sky-warmth ramp (Phase 3 skyRamp) ──────────────────────────
// Sun-altitude → 0..1 warmth, peaking at the horizon and gone once the sun is
// well up or civil twilight has fully faded. The screensaver's per-minute
// syncNight() steps the value onto <body> as --sky-warmth (the --clock-dim
// pattern: a data-driven ambient level the CSS settles toward, never a loop);
// body.sky-ramp.substrate::before mixes it into the substrate tint.
export const SKY_WARMTH_ALT_HIGH = 12; // ° — sun this high, the warmth is gone
export const SKY_WARMTH_ALT_LOW = -6;  // ° — civil twilight over, warmth gone

/**
 * @param {number} altitudeDeg sun altitude in degrees (suncalc).
 * @returns {number} warmth 0..1 — a triangular ramp peaking at the horizon.
 */
export function skyWarmthFor(altitudeDeg) {
  const a = Number(altitudeDeg);
  if (!Number.isFinite(a)) return 0;
  if (a >= SKY_WARMTH_ALT_HIGH || a <= SKY_WARMTH_ALT_LOW) return 0;
  const t = a >= 0 ? 1 - a / SKY_WARMTH_ALT_HIGH : 1 - a / SKY_WARMTH_ALT_LOW;
  return Math.max(0, Math.min(1, t));
}
