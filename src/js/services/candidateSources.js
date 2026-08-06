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
export function nextEventCandidate({ nextEventActive, nextEventText, nextEventTitle, nextEventSub } = {}) {
  if (!nextEventActive || !nextEventText) return null;
  return {
    id: `next-event:${nextEventText}`,
    source: "nextEvent",
    icon: "📅",
    text: nextEventText,
    // Tier-1a rich-card slots (features.stackCards render-gated; inert otherwise):
    // the event name and its relative line, already separate in the panel DOM.
    title: nextEventTitle || null,
    sub: nextEventSub || null,
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
export function nowPlayingCandidate({ nowPlayingActive, nowPlayingText, nowPlayingImage, nowPlayingTitle, nowPlayingSub } = {}) {
  if (!nowPlayingActive || !nowPlayingText) return null;
  return {
    id: `now-playing:${nowPlayingText}`,
    source: "nowPlaying",
    icon: "🎬",
    image: nowPlayingImage || null, // the album/movie art, rendered as the thumb when present
    text: nowPlayingText,
    // Tier-1a rich-card slots: the media title and its room/source line.
    title: nowPlayingTitle || null,
    sub: nowPlayingSub || null,
    score: 41,
    stackOnly: true, // ambient "what's on" — rides the lean-in stack, never the centred hero
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
    // Tier-1a rich-card slots: the stream title over its source.
    title: plexText,
    sub: "Plex",
    score: 41,
    stackOnly: true, // stack card only, never the centred hero (like now-playing)
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
    // Tier-1a rich-card slots: the dish over its standing eyebrow.
    title: menuName,
    sub: "Tonight's menu",
    score: 40,
    stackOnly: true, // stack card only, never the centred hero
    cooldownMs: 0
  };
}

/**
 * The most recent camera trigger — folds the always-visible #camera-last-trigger-pill
 * off the home surface into the one attention queue (docs/design/DESIGN_ROLLOUT.md
 * follow-up). Low band, above the media/menu folds (a person at the door edges out
 * "what's for dinner"), but stack-only so it never barges the centred hero. Decays
 * on its own via expiresAt: rankQueue drops it once the trigger is no longer recent,
 * so it "appears when relevant, then fades" rather than lingering like the old pill.
 * Present only when the runtime reads it (gated on features.cameraCandidate).
 */
export const CAMERA_TRIGGER_FRESH_MS = 15 * 60 * 1000;

// The event image does NOT exist at trigger time. Battery cameras upload via the
// Eufy cloud, measured at 1min+ behind the event (the same lag that made the popup
// show stale frames — see cameraPopupOverlay PENDING_TRIGGER_WINDOW_MS = 150s). So
// pinning the URL to the trigger stamp would risk showing the PREVIOUS event's
// frame: re-bust on a coarse bucket while the image is still settling, so the
// thumbnail converges onto the real frame, then pin once it has settled.
//
// The snapshot route is the real freshness guarantee (it refetches from HA per
// request and sends no-store), and renderStack rebuilds the <img> every 30s tick,
// so pinning stops URL churn — not re-fetching. The ?ts= bust matches the pattern
// cameraTiles/cameraPopupOverlay already use, for caches that ignore no-store.
export const CAMERA_IMAGE_SETTLE_MS = 150 * 1000;
export const CAMERA_IMAGE_BUCKET_MS = 15 * 1000;

export function cameraSnapshotUrl({ cameraId, at, now = Date.now() } = {}) {
  if (!cameraId || !at) return null;
  const age = now - at;
  const settling = age >= 0 && age <= CAMERA_IMAGE_SETTLE_MS;
  const ts = settling ? Math.floor(now / CAMERA_IMAGE_BUCKET_MS) * CAMERA_IMAGE_BUCKET_MS : at;
  return `/api/camera/${encodeURIComponent(cameraId)}/snapshot?ts=${ts}`;
}

export function cameraTriggerCandidate({ cameraTriggerName, cameraTriggerAt, cameraTriggerLabel, cameraTriggerImage } = {}) {
  if (!cameraTriggerName || !cameraTriggerAt) return null;
  return {
    id: `camera-trigger:${cameraTriggerAt}`,
    source: "cameraTrigger",
    icon: "📹",
    text: cameraTriggerLabel ? `${cameraTriggerName} · ${cameraTriggerLabel}` : cameraTriggerName,
    // Tier-1a rich-card slots: the camera name over its trigger time. The snapshot
    // rides the existing c.image thumbnail slot (media/plex artwork uses it too);
    // null falls back to the 📹 glyph, so a camera with no id still renders.
    image: cameraTriggerImage || null,
    title: cameraTriggerName,
    sub: cameraTriggerLabel || null,
    score: 45,
    stackOnly: true, // rides the lean-in stack, never the centred hero
    expiresAt: cameraTriggerAt + CAMERA_TRIGGER_FRESH_MS,
    cooldownMs: 0
  };
}

/**
 * The robot vacuum's "needs a human" states — the only thing it knows that nobody
 * is told. Two kinds, deliberately ranked differently:
 *
 *   problems     — `device_class: problem` binary sensors that are ON right now
 *                  (water shortage, dirty/clean tank). Actionable today.
 *   consumables  — `*_time_left` sensors gone NEGATIVE, i.e. past their service
 *                  life. Real, but measured in hours against a ~300 h life, so
 *                  they belong at the very bottom of the band.
 *
 * Selecting problems by device_class rather than by entity id is deliberate: the
 * dock sensors carry a room prefix (`piano_room_…`) that would silently stop
 * matching if the robot were ever moved or renamed.
 */
const ROBOT_PROBLEM_LABELS = {
  water_shortage: "water tank's empty",
  dock_dirty_water_box: "dirty tank needs emptying",
  dock_clean_water_box: "clean tank needs filling"
};

const ROBOT_CONSUMABLE_LABELS = {
  main_brush_time_left: "main brush",
  side_brush_time_left: "side brush",
  filter_time_left: "filter",
  sensor_time_left: "sensors",
  dock_strainer_time_left: "dock strainer",
  dock_maintenance_brush_time_left: "dock brush"
};

function labelFromSuffix(entityId, table) {
  // Match on the id's TAIL so a room prefix never breaks the lookup.
  const key = Object.keys(table).find((suffix) => entityId.endsWith(suffix));
  return key ? table[key] : null;
}

/**
 * Pure entity reader — takes the HA state map, returns what needs a human.
 * No DOM, no imports: unit-testable in plain node like the rest of this module.
 */
export function robotAttentionFrom(entities = {}) {
  const problems = [];
  const consumables = [];

  for (const [entityId, entity] of Object.entries(entities || {})) {
    if (!/roborock/i.test(entityId)) continue;
    const state = entity?.state;

    if (entityId.startsWith("binary_sensor.")) {
      if (entity?.attributes?.device_class !== "problem" || state !== "on") continue;
      const label = labelFromSuffix(entityId, ROBOT_PROBLEM_LABELS);
      if (label) problems.push(label);
      continue;
    }

    if (entityId.startsWith("sensor.")) {
      const label = labelFromSuffix(entityId, ROBOT_CONSUMABLE_LABELS);
      if (!label) continue;
      const hoursLeft = Number(state);
      // `unknown`/`unavailable` coerce to NaN — a missing reading is not an
      // overdue one, so require a real negative number.
      if (Number.isFinite(hoursLeft) && hoursLeft < 0) consumables.push(label);
    }
  }

  return { problems: problems.sort(), consumables: consumables.sort() };
}

/** Join a list the way a person would say it. */
function readableList(items) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * A chore, so it stays in the low band and never takes the centred hero. Carries
 * NO `expiresAt` — unlike a camera trigger this is a *state*, not an event: it
 * should sit there until somebody actually empties the tank.
 */
export function robotCandidate({ robotProblems, robotConsumables } = {}) {
  const problems = Array.isArray(robotProblems) ? robotProblems : [];
  const consumables = Array.isArray(robotConsumables) ? robotConsumables : [];

  if (problems.length) {
    return {
      id: `robot-problem:${problems.join("|")}`,
      source: "robot",
      icon: "🤖",
      text: `Roborock — ${readableList(problems)}.`,
      title: "Roborock",
      sub: readableList(problems),
      score: 44,
      stackOnly: true,
      cooldownMs: 6 * 60 * 60 * 1000
    };
  }

  if (consumables.length) {
    return {
      id: `robot-consumable:${consumables.join("|")}`,
      source: "robot",
      icon: "🤖",
      text: `Roborock's ${readableList(consumables)} due for a change.`,
      title: "Roborock",
      sub: `${readableList(consumables)} due`,
      score: 40,
      stackOnly: true,
      // Past a ~300 h service life, so this is not urgent — mention it once a day.
      cooldownMs: 24 * 60 * 60 * 1000
    };
  }

  return null;
}

export const SOURCES = [
  bomCandidate,
  weatherSevereCandidate,
  nextEventCandidate,
  commuteCandidate,
  cameraTriggerCandidate,
  robotCandidate,
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
