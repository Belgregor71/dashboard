// Pure adapters that turn focusEngine's DOM-derived inputs into scored
// candidates for the attention engine. Same discipline as insightRules.js:
// no imports, no DOM, no storage — the runtime (focusHero) reads state and
// passes it in, so the whole module unit-tests in plain node.
//
// Score bands (docs/vision/phase-2-attention-engine.md):
//   Interrupt 90–100 · High 70–89 · Medium 50–69 · Low 40–49
// These bands reproduce the old computeFocus ladder as plain numbers, so the
// unified queue ranks the same sources without the if/else special-casing.

const SEVERE_WEATHER_PATTERN = /storm|severe|warning|heavy rain|flood/i;

/** Active BOM warning — interrupt band; may override the AMBIENT floor. */
export function bomCandidate({ bomWarning } = {}) {
  if (!bomWarning) return null;
  return {
    id: `bom:${bomWarning}`,
    source: "bom",
    icon: "⚠️",
    text: bomWarning,
    score: 95,
    interrupt: true,
    cooldownMs: 0
  };
}

/** Severe live weather condition (storm/flood/heavy rain) — interrupt band. */
export function weatherSevereCandidate({ weatherCondition, weatherTemp } = {}) {
  if (!weatherCondition || !SEVERE_WEATHER_PATTERN.test(weatherCondition)) return null;
  return {
    id: `weather:${weatherCondition}`,
    source: "weather",
    icon: "⚠️",
    text: weatherTemp ? `${weatherCondition} · ${weatherTemp}` : weatherCondition,
    score: 91,
    interrupt: true,
    cooldownMs: 0
  };
}

/** Next calendar event readout — medium band. */
export function nextEventCandidate({ nextEventActive, nextEventText } = {}) {
  if (!nextEventActive || !nextEventText) return null;
  return {
    id: `next-event:${nextEventText}`,
    source: "nextEvent",
    icon: "📅",
    text: nextEventText,
    score: 50,
    cooldownMs: 0
  };
}

/** Plain commute readout — low band. */
export function commuteCandidate({ commuteActive, commuteText } = {}) {
  if (!commuteActive || !commuteText) return null;
  return {
    id: `commute:${commuteText}`,
    source: "commute",
    icon: "🚗",
    text: commuteText,
    score: 42,
    cooldownMs: 0
  };
}

export const SOURCES = [
  bomCandidate,
  weatherSevereCandidate,
  nextEventCandidate,
  commuteCandidate
];

/** Run every source adapter over the runtime-read state; drop nulls. */
export function collectSources(state = {}) {
  return SOURCES.map((fn) => {
    try {
      return fn(state);
    } catch {
      return null; // one bad adapter must never take down the hero
    }
  }).filter(Boolean);
}
