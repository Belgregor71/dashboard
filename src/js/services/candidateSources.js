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

/**
 * What's playing on a media player — the lowest low-band candidate. Folds the
 * standalone "Now Playing" panel into the one attention queue so it rides the
 * hero/stack like everything else (docs/design/DESIGN_ROLLOUT.md follow-up)
 * instead of a separate glass panel. Only present when the runtime reads it
 * (gated on features.mediaCandidate), so flag-off carries no candidate.
 */
export function nowPlayingCandidate({ nowPlayingActive, nowPlayingText, nowPlayingImage } = {}) {
  if (!nowPlayingActive || !nowPlayingText) return null;
  return {
    id: `now-playing:${nowPlayingText}`,
    source: "nowPlaying",
    icon: "🎬",
    image: nowPlayingImage || null, // the album/movie art, rendered as the thumb when present
    text: nowPlayingText,
    score: 41,
    cooldownMs: 0
  };
}

/**
 * A Plex stream — the same low band as now-playing, from the separate Plex panel
 * (not HA). Carries the poster thumb so the attention thumb shows the artwork.
 * Present only when the runtime reads it (gated on features.mediaCandidate).
 */
export function plexCandidate({ plexActive, plexText, plexImage } = {}) {
  if (!plexActive || !plexText) return null;
  return {
    id: `plex:${plexText}`,
    source: "plex",
    icon: "🎬",
    image: plexImage || null,
    text: plexText,
    score: 41,
    cooldownMs: 0
  };
}

/**
 * Tonight's dinner — the quietest low-band candidate, folding the standalone
 * "Tonight's Menu" tile into the attention queue (docs/design/DESIGN_ROLLOUT.md
 * follow-up). Only present when the runtime reads it (gated on
 * features.foldHomeTiles), so flag-off carries no candidate.
 */
export function tonightsMenuCandidate({ menuActive, menuName } = {}) {
  if (!menuActive || !menuName) return null;
  return {
    id: `tonights-menu:${menuName}`,
    source: "tonightsMenu",
    icon: "🍽",
    text: `${menuName} for dinner`,
    score: 40,
    cooldownMs: 0
  };
}

export const SOURCES = [
  bomCandidate,
  weatherSevereCandidate,
  nextEventCandidate,
  commuteCandidate,
  nowPlayingCandidate,
  plexCandidate,
  tonightsMenuCandidate
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
