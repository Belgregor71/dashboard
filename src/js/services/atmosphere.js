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
 * @returns {string} a token from ATMOSPHERE_TOKENS.
 */
export function atmosphereFor({ condition, isNight, hour } = {}) {
  // Night owns the scene — the dim clock (screensaver--night) already governs
  // the wash; atmosphere just names the state so it composes cleanly.
  if (isNight) return "atmo-night";

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
