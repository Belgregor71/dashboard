/* ═══════════════════════════════════════════════════════════════════════════
   PRESENCE — is anyone actually there.

   Step 1.5 of docs/design/V3-MIGRATION.md, and the one piece of Phase 1 that
   had to be written rather than moved. `src/js/core/presence.js` cannot be
   ported: it sets its mode off `screensaver:changed`, so presence in the
   incumbent *means* "the screensaver is awake". V3 has no screensaver — depth 0
   IS the resting state — so the proxy has nothing to stand on and the signal has
   to be read where it actually enters the house.

   THE SIGNAL. `binary_sensor.kitchen_motion_detected` and
   `..._person_detected`, the same two entities the incumbent names in its
   KITCHEN_MOTION set, arriving on the `/api/ha/stream` SSE via the entity feed
   (1.1). Both were confirmed live on the kiosk before this was written.

   MOTION STOPPING IS NOT SOMEBODY LEAVING. A PIR reports movement, not
   occupancy: stand still to read the screen and it goes `off` within seconds.
   So `off` is ignored entirely and absence is decided by a linger timer instead.

   THE LINGER IS INHERITED, NOT INVENTED. The incumbent's equivalent is the
   screensaver's own idle timeout — 5 minutes by day, 30 seconds at night
   (modules/screensaver.js IDLE_MS / NIGHT_IDLE_MS). Reusing those exact numbers
   means both surfaces agree about when the room is empty, which matters while
   both are running: a V3 that thought the kitchen emptied at a different moment
   than the wall did would make every side-by-side comparison meaningless.
   ═══════════════════════════════════════════════════════════════════════════ */

import { on } from "../../js/core/eventBus.js";

const KITCHEN = new Set([
  "binary_sensor.kitchen_motion_detected",
  "binary_sensor.kitchen_person_detected"
]);

/* modules/screensaver.js IDLE_MS / NIGHT_IDLE_MS. Night settles fast because a
   dark kitchen at 2am that someone walked through is not a room in use. */
export const LINGER_DAY_MS = 5 * 60 * 1000;
export const LINGER_NIGHT_MS = 30 * 1000;

/* core/presence.js DWELL_MS. Sustained presence, not a pass-through. */
export const DWELL_MS = 30_000;

let present = false;
let dwelling = false;
let lastMotionAt = 0;
let lingerTimer = null;
let dwellTimer = null;
let unsubscribe = null;

const listeners = new Set();

/* V3's night is the sun's, not the clock's — main.js stamps it from solar
   altitude. Read rather than recomputed so presence can never disagree with the
   surface about what time of day it is. */
function lingerMs() {
  return document.documentElement.dataset.night === "1" ? LINGER_NIGHT_MS : LINGER_DAY_MS;
}

function announce(reason) {
  for (const fn of listeners) {
    // Isolated, and re-thrown on a fresh task: one bad subscriber must not stop
    // the house noticing that the room emptied, but a genuine page error still
    // has to reach the kiosk smoke test.
    try { fn({ present, dwelling, reason }); }
    catch (err) { setTimeout(() => { throw err; }); }
  }
}

function goAbsent(reason) {
  if (lingerTimer) { clearTimeout(lingerTimer); lingerTimer = null; }
  if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; }
  if (!present && !dwelling) return;
  present = false;
  dwelling = false;
  announce(reason);
}

function armLinger() {
  if (lingerTimer) clearTimeout(lingerTimer);
  lingerTimer = setTimeout(() => {
    lingerTimer = null;
    goAbsent("linger-expired");
  }, lingerMs());
}

function sawMotion(reason) {
  lastMotionAt = Date.now();
  armLinger();

  if (!present) {
    present = true;
    announce(reason);
  }

  // Dwell is sustained presence: the clock runs from the FIRST motion of a
  // spell and is not restarted by later movement, or someone busy in the
  // kitchen would never reach it.
  if (!dwelling && !dwellTimer) {
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      if (!present) return;
      dwelling = true;
      announce("dwell");
    }, DWELL_MS);
  }
}

function onStateUpdated(entity) {
  if (!KITCHEN.has(entity?.entity_id)) return;

  // `off` says movement stopped, which is not a statement about the room. Only
  // the linger decides absence.
  if (entity.state !== "on") return;

  /* ⚠ The opening snapshot replays ~700 entities at once, including any sensor
     that is currently `on` — and a sensor stuck `on` since this morning is not
     someone standing in the kitchen. Trust the state only if the change is
     recent enough to still be inside a linger. A missing last_changed is
     treated as live, because that is what a genuine push event looks like. */
  const changedAt = entity.last_changed ? Date.parse(entity.last_changed) : NaN;
  if (Number.isFinite(changedAt) && Date.now() - changedAt > lingerMs()) return;

  sawMotion("motion");
}

export function isPresent() { return present; }
export function isDwelling() { return dwelling; }

export function onPresence(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initPresence() {
  if (unsubscribe) return unsubscribe;

  /* The bus event, not the DOM one. `entityFeed` emits this before the
     incumbent's `events.js` re-broadcasts it to `document`, and V3 has no
     document listener for it at all. */
  unsubscribe = on("ha:state-updated", onStateUpdated);

  window.__v3Presence = (force) => {
    if (force === true) sawMotion("debug");
    if (force === false) goAbsent("debug");
    return {
      present,
      dwelling,
      lastMotionAt: lastMotionAt || null,
      lingerMs: lingerMs(),
      sinceMotionMs: lastMotionAt ? Date.now() - lastMotionAt : null
    };
  };

  return unsubscribe;
}

/** Test seam — drops every timer and subscription so a spec starts cold. */
export function __resetPresence() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (lingerTimer) { clearTimeout(lingerTimer); lingerTimer = null; }
  if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; }
  present = false;
  dwelling = false;
  lastMotionAt = 0;
  listeners.clear();
}
