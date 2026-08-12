/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

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

/* ── Timely windows ─────────────────────────────────────────────────────────
   Some facts are permanently true and matter for twenty minutes. The drive to
   work is the clearest case: identical at 07:00 on a Tuesday, when it is the
   most useful thing the wall can say, and at 23:00 on a Sunday, when it is
   noise. A fixed score cannot tell those apart, so the wall never showed it.

   `leaveBy` in insightRules.js already scores this way (84 + proximity), but it
   only fires for a CALENDAR EVENT with a drive — a routine departure that lives
   in nobody's calendar produces no candidate at all. These windows cover that.

   ⚠ Gated on `timely` from the runtime, not read from CONFIG here: this module
   has no imports and no globals by design, so the surface passes the flag in
   with everything else. Absent `timely`, every score below is unchanged.
   ⚠ `now` likewise comes IN — collectSources injects it once at the boundary. */
const IN_WINDOW_SCORE = 72; // clears the High floor (70) — earns the hero

const COMMUTE_WINDOW = { fromMin: 6 * 60 + 30, toMin: 8 * 60, weekdaysOnly: true };
const MENU_WINDOW = { fromMin: 17 * 60, toMin: 18 * 60 + 30, weekdaysOnly: false };

/* The camera's window is measured from the TRIGGER, not the clock — three
   minutes is roughly how long someone is still at the door or walking away. */
const CAMERA_TRIGGER_HOT_MS = 3 * 60 * 1000;

/** `now` as epoch ms, accepting a Date, a number, or nothing. */
function nowMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === "number" && Number.isFinite(now)) return now;
  return Number.NaN; // NaN comparisons are false → never "hot", never a window
}

/** Minutes since local midnight, or null when `now` is unusable. */
function minutesOfDay(now) {
  const d = now instanceof Date ? now : new Date(now ?? NaN);
  return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
}

/** Is `now` inside the window? Half-open [from, to) so 08:00 is already out. */
function inWindow(now, { fromMin, toMin, weekdaysOnly }) {
  const mins = minutesOfDay(now);
  if (mins === null) return false;
  if (weekdaysOnly) {
    const day = (now instanceof Date ? now : new Date(now)).getDay();
    if (day === 0 || day === 6) return false;
  }
  return mins >= fromMin && mins < toMin;
}

/** Plain commute readout — low band, except on a weekday morning. */
export function commuteCandidate({ commuteActive, commuteText, now, timely } = {}) {
  if (!commuteActive || !commuteText) return null;
  const timelyNow = Boolean(timely) && inWindow(now, COMMUTE_WINDOW);
  return {
    id: `commute:${commuteText}`,
    source: "commute",
    icon: "🚗",
    text: commuteText,
    /* Flat, not climbing like leaveBy: you want the drive time EARLY enough to
       act on it, so a score that peaks at the end of the window would surface it
       exactly when it is too late to help. Constant through the window. */
    score: timelyNow ? IN_WINDOW_SCORE : 42,
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
export function tonightsMenuCandidate({ menuActive, menuName, now, timely } = {}) {
  if (!menuActive || !menuName) return null;
  const timelyNow = Boolean(timely) && inWindow(now, MENU_WINDOW);
  return {
    id: `tonights-menu:${menuName}`,
    source: "tonightsMenu",
    icon: "🍽",
    text: `${menuName} for dinner`,
    // Tier-1a rich-card slots: the dish over its standing eyebrow.
    title: menuName,
    sub: "Tonight's menu",
    score: timelyNow ? IN_WINDOW_SCORE : 40,
    /* ⚠ THE SCORE ALONE WOULD CHANGE NOTHING. attentionRank picks the hero with
       `eligible.find((c) => !c.stackOnly)`, so a stackOnly candidate can never
       be the centred hero at ANY score. The window has to lift both, or the
       menu stays a stack card nobody sees on a surface that renders the hero. */
    stackOnly: !timelyNow,
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

export function cameraTriggerCandidate({ cameraTriggerName, cameraTriggerAt, cameraTriggerLabel, cameraTriggerImage, now, timely } = {}) {
  if (!cameraTriggerName || !cameraTriggerAt) return null;
  /* Unlike the commute and the menu, this window is relative to the EVENT, not
     to the clock: someone reached the door, and it matters for the couple of
     minutes you might still catch them. After that it decays back to a stack
     card for the rest of its 15-minute life rather than vanishing, because a
     recent trigger is still worth having in the stack when you walk past. */
  const ageMs = nowMs(now) - cameraTriggerAt;
  const hot = Boolean(timely) && ageMs >= 0 && ageMs <= CAMERA_TRIGGER_HOT_MS;
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
    score: hot ? IN_WINDOW_SCORE : 45,
    stackOnly: !hot, // outside the hot window: the lean-in stack, never the hero
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
  /* `now` is injected ONCE here rather than read inside each adapter: the
     adapters stay pure and unit-testable in plain node (a spec passes any clock
     it likes), and a single tick cannot have two adapters disagreeing about
     what time it is. A caller that supplies its own `now` — every spec, and the
     V3 tick, which already has one — keeps it. */
  const withNow = state.now == null ? { ...state, now: Date.now() } : state;
  return SOURCES.map((fn) => {
    try {
      return fn(withNow);
    } catch {
      return null; // one bad adapter must never take down the hero
    }
  }).filter(Boolean);
}
