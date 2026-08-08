/* ═══════════════════════════════════════════════════════════════════════════
   ALERTS — the door puts itself on the screen.

   Step 3.1 of docs/design/V3-MIGRATION.md, and the one the phase is named for:
   *someone at the door puts the door on the screen without anyone asking.*

   This is the only thing in V3 that takes depth 3 without being spoken to, and
   the only one that FORCES rather than deepens. Everything else in the house
   asks: attention deepens and gives way, the voice deepens and recedes. A person
   at the door outranks whatever you were looking at, including a subject you
   asked for yourself — so this calls `setDepth` directly rather than `deepen()`,
   which would fall through to `sustain()` at depth 3 and leave the OLD camera up
   while announcing the new one. That failure would be silent and would look like
   the doorbell not working.

   ── The three traps, all of them already paid for elsewhere ─────────────────

   1. THE BOOT SNAPSHOT. The opening SSE frame replays every entity in the
      house, including any binary_sensor stuck `on` since this morning. presence.js
      hit this exactly (a stuck PIR faking someone in the kitchen at every load);
      here it would announce a visitor at the door on every page load and take
      the wall to depth 3 to do it. `routeAlert` is given a freshness window and
      drops anything whose `last_changed` is older than it.

   2. THE BUS, NOT THE DOCUMENT. `entityFeed` emits on the event bus and the
      incumbent's `events.js` re-broadcasts to `document` afterwards. V3 has no
      document listener for it at all.

   3. RECESSION HAS TO LAND SOMEWHERE. Depth 2 is empty unless something composed
      it, so a subject stepping down one level used to drop the wall onto a blank
      rectangle. Fixed in depth.js this phase — recession now falls to the
      deepest inhabited depth — and it had to be, because this is the first path
      that reaches depth 3 with nobody in the room to say anything else.
   ═══════════════════════════════════════════════════════════════════════════ */

import { on } from "../../js/core/eventBus.js";
import { routeAlert } from "../../js/services/alertRouter.js";
import { ALERT_TTS_RATE } from "../../js/config/alertLines.js";
import { speak } from "../../js/core/tts.js";
import { setPhase, trackSpeech } from "./presence-light.js";
import { showSubject } from "../subjects/index.js";
import { DEPTH, setDepth } from "./depth.js";

/* How long the door holds the screen. Longer than an ordinary subject's 30 s
   (depth.js HOLD_MS) because the two are not the same event: "show me the
   driveway" is answered the moment you have looked, and a doorbell is answered
   when you have decided what to do about it — which may mean walking out of the
   room and coming back. Recession is still automatic and still downhill; this
   only says how patient it is. */
export const ALERT_HOLD_MS = 60_000;

/* Nothing older than this is happening now. Deliberately much shorter than
   presence.js's linger: a stale PIR only costs a wrong guess about an empty
   room, whereas a stale doorbell takes the whole screen and speaks out loud. */
export const ALERT_FRESH_MS = 30_000;

const cooldowns = new Map();   // location prefix → expiry ms
let unsubscribe = null;
let last = null;

/**
 * One alert, end to end. Exported for the debug hook rather than for reuse —
 * driving a real doorbell over CDP means finding someone to press it.
 */
export async function raiseAlert(entity, { now = Date.now() } = {}) {
  const alert = routeAlert(entity, { now, cooldowns, minFreshMs: ALERT_FRESH_MS });
  if (!alert) return null;

  const { location, personName, line } = alert;

  /* The camera FIRST, and the depth only if it mounted. Same ordering rule the
     composer follows: nothing may flip the depth into a layer that has nothing
     in it. `showSubject` clears whatever was mounted before it, so a doorbell
     during a driveway subject replaces it rather than layering over it. */
  const shown = await showSubject(
    { id: "show.camera", slots: { camera: location.camera } },
    null
  );

  if (shown) {
    // FORCED, not deepened — see the header. The reason carries the provenance
    // that `activeSubject()` cannot: both this and "show me the front door"
    // mount the same camera, and only the reason tells them apart afterwards.
    setDepth(DEPTH.SUBJECT, `alert:${location.prefix}`, { holdMs: ALERT_HOLD_MS });
  }

  /* Spoken whether or not the camera came up. A doorbell that says nothing
     because a snapshot 404'd is a worse failure than one with no picture — the
     announcement is the part that reaches someone in the next room. */
  if (line) {
    setPhase("speaking");
    speak(line, { rate: ALERT_TTS_RATE, onAudio: (audio) => trackSpeech(audio) })
      .then(() => setPhase("idle"), () => setPhase("idle"));
  }

  last = { prefix: location.prefix, camera: location.camera, personName, line, shown, at: new Date(now).toISOString() };
  return last;
}

function onStateUpdated(entity) {
  // Not awaited: an entity handler that returns a promise nobody holds must not
  // be able to reject into the bus. raiseAlert never throws — showSubject
  // swallows its own failures and returns false — but saying so out loud here is
  // cheaper than trusting it forever.
  raiseAlert(entity).catch(() => {});
}

/** The last alert raised, or null. For __v3(). */
export function lastAlert() {
  return last;
}

export function initAlerts() {
  if (unsubscribe) return unsubscribe;

  unsubscribe = on("ha:state-updated", onStateUpdated);

  /* Drive the door without pressing it. The synthetic entity carries a live
     `last_changed` on purpose — passing a stale one is how you check the boot
     snapshot guard, and that is a thing worth being able to check by hand on the
     kiosk as well as in a spec. */
  window.__v3Alert = (entityId = "binary_sensor.doorbell_ringing", state = "on") =>
    raiseAlert({ entity_id: entityId, state, last_changed: new Date().toISOString() });

  return unsubscribe;
}

/** Test seam — drops the subscription and every cooldown so a spec starts cold. */
export function __resetAlerts() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  cooldowns.clear();
  last = null;
}
