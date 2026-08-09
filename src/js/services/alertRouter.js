/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

// The one definition of which door is which, what it says, and which camera
// answers for it. Pure of the DOM: it reads the HA entity cache and nothing
// else, so both surfaces can share it.
//
// Extracted from modules/doorbellAlert.js at V3 migration step 3.1. That module
// was already 103 of its 104 lines DOM-free — the single reference was the
// `document.addEventListener` it hung everything from — so the split is between
// the DECISION (here) and the EFFECTS (each surface's own: the incumbent wakes
// its screensaver and floats a popup, V3 forces depth 3 and mounts the camera).
//
// Sharing the table rather than copying it is the point. houseSnapshot had to
// duplicate nextEventPanel's window and copy format because there was no pure
// function to import, and docs/design/V3-MIGRATION.md still carries the "change
// both or they drift" warning that cost. This is the door: a V3 that greeted a
// visitor with the side gate's intruder lines, or watched the wrong camera,
// would be a genuinely bad failure, and the way to not have it is to not have
// two answers.

import { getEntity } from "./homeAssistant/state.js";
import {
  VISITOR_UNKNOWN_LINES,
  VISITOR_KNOWN_LINES,
  INTRUDER_UNKNOWN_LINES,
  INTRUDER_KNOWN_LINES
} from "../config/alertLines.js";

/** The states that mean it is happening now. */
const ACTIVE_STATES = new Set(["on", "ringing"]);

/** Suppress repeat alerts for 30s per location. */
export const ALERT_COOLDOWN_MS = 30_000;

/** Values the Eufy person-name sensor uses when it hasn't identified anyone. */
const UNKNOWN_NAME_VALUES = new Set(["no person", "unknown", "unavailable", ""]);

/* `camera` is the id the snapshot and live routes take, and it is stated rather
   than derived from `prefix` even though they currently match — the coupling is
   real (V3 mounts `/api/camera/{camera}/live` off it) and a rename of either
   side should be a visible edit, not a silent mismatch. */
export const LOCATIONS = [
  {
    prefix: "doorbell",
    camera: "doorbell",
    triggerEntities: [
      "binary_sensor.doorbell_ringing",
      "binary_sensor.doorbell_person_detected"
    ],
    personNameEntity: "sensor.doorbell_person_name",
    knownLines: VISITOR_KNOWN_LINES,
    unknownLines: VISITOR_UNKNOWN_LINES
  },
  {
    prefix: "side_gate",
    camera: "side_gate",
    triggerEntities: ["binary_sensor.side_gate_person_detected"],
    personNameEntity: "sensor.side_gate_person_name",
    knownLines: INTRUDER_KNOWN_LINES,
    unknownLines: INTRUDER_UNKNOWN_LINES
  }
];

const TRIGGER_TO_LOCATION = new Map(
  LOCATIONS.flatMap((location) =>
    location.triggerEntities.map((entityId) => [entityId, location])
  )
);

const lastIndexByPool = new Map(); // pool array → last picked index

/** The location this entity belongs to, or null if it is not a trigger. */
export function locationFor(entityId) {
  return TRIGGER_TO_LOCATION.get(String(entityId ?? "").toLowerCase()) ?? null;
}

/** Is this state the event actually happening, as opposed to it ending? */
export function isActiveState(state) {
  return ACTIVE_STATES.has(String(state ?? "").toLowerCase());
}

/** The identified visitor's name, or null when the camera didn't know them. */
export function knownPersonName(personNameEntityId) {
  if (!personNameEntityId) return null;
  const entity = getEntity(personNameEntityId);
  const name = String(entity?.state ?? "").trim();
  if (!name || UNKNOWN_NAME_VALUES.has(name.toLowerCase())) return null;
  return name;
}

/** One line from a pool, never the same one twice running. */
function pickLine(pool) {
  const last = lastIndexByPool.get(pool) ?? -1;
  let index = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && index === last) {
    index = (index + 1) % pool.length;
  }
  lastIndexByPool.set(pool, index);
  return pool[index];
}

/**
 * What the house says about this event.
 *
 * Name-free lines are plain strings the server has pre-warmed into the TTS cache
 * so playback is instant; name lines are `name => "..."` templates resolved
 * here. Picked client-side with no AI round trip, deliberately: this is the one
 * moment the house is announcing something that is happening right now, and it
 * can afford neither the latency nor the chance of an invented sentence.
 *
 * @param {object} location   from locationFor()
 * @param {string|null} [personName]  pass through from knownPersonName()
 */
export function alertLine(location, personName = null) {
  if (!location) return null;
  const entry = personName ? pickLine(location.knownLines) : pickLine(location.unknownLines);
  return typeof entry === "function" ? entry(personName) : entry;
}

/**
 * The whole decision for one entity update, or null for "not an alert".
 *
 * `cooldowns` is a Map owned by the caller (prefix → expiry ms) and IS MUTATED
 * on a hit — the surfaces each keep their own, so a doorbell shown on one is not
 * suppressed on the other.
 *
 * `minFreshMs` is the trap this shares with presence.js, and it is not optional
 * in practice: the opening SSE snapshot replays every entity in the house
 * including any binary_sensor that happens to be stuck `on`, so a doorbell that
 * has been reading `on` since this morning would announce a visitor at every
 * page load. A missing `last_changed` is treated as live, because that is what a
 * genuine push event looks like.
 */
export function routeAlert(entity, { now = Date.now(), cooldowns = null, minFreshMs = null } = {}) {
  const location = locationFor(entity?.entity_id);
  if (!location) return null;
  if (!isActiveState(entity?.state)) return null;

  if (minFreshMs != null && entity?.last_changed) {
    const changedAt = Date.parse(entity.last_changed);
    if (Number.isFinite(changedAt) && now - changedAt > minFreshMs) return null;
  }

  if (cooldowns) {
    if ((cooldowns.get(location.prefix) ?? 0) > now) return null;
    cooldowns.set(location.prefix, now + ALERT_COOLDOWN_MS);
  }

  const personName = knownPersonName(location.personNameEntity);
  return { location, personName, line: alertLine(location, personName) };
}
