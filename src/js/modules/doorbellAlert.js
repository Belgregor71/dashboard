import { wakeScreensaver, resetIdleTimer } from "./screensaver.js";
import { speak } from "../core/tts.js";
import { getEntity } from "../services/homeAssistant/state.js";

const ACTIVE_STATES = new Set(["on", "ringing"]);
const COOLDOWN_MS = 30_000; // suppress repeat alerts for 30s per location

// Values the Eufy person-name sensor uses when it hasn't identified anyone.
const UNKNOWN_NAME_VALUES = new Set(["no person", "unknown", "unavailable", ""]);

// Dry, deadpan Aussie one-liners — picked client-side (no AI round-trip) so
// the alert fires instantly and never risks an AI hallucination at the one
// moment it's announcing something actually happening right now.

// Front door, nobody identified — a visitor, but we don't know who.
const VISITOR_UNKNOWN_LINES = [
  () => "Someone's at the front door. Hope you've got friends.",
  () => "Doorbell's going. Statistically, it's a parcel, not a person you like.",
  () => "Knock knock at the front door. Probably not a joke.",
  () => "Someone's at the door. Bold of them to just show up unannounced.",
  () => "There's someone at the front door. Could be a neighbour. Could be a scam.",
  () => "Doorbell. Must be DoorDash, nobody else visits unannounced.",
  () => "Someone's knocking at the front door. Try not to look too surprised you have visitors.",
  () => "Someone's at the door. No, it's not your imagination.",
  () => "Doorbell's ringing. Fifty-fifty it's someone lovely or someone selling something.",
  () => "There's a knock at the front door. Miracles do happen, apparently."
];

// Front door, person identified by name.
const VISITOR_KNOWN_LINES = [
  name => `It's ${name} at the door. Try to act surprised.`,
  name => `${name}'s here. Hope you're decent.`,
  name => `${name}'s at the door. You don't have to pretend you're not home.`,
  name => `It's ${name}. Could be worse, could've been a Jehovah's Witness.`,
  name => `${name}'s at the front door. Look alive.`
];

// Side gate, nobody identified — a much more suspicious entry point.
const INTRUDER_UNKNOWN_LINES = [
  () => "Someone's at the side gate. Hope it's a tradie, not a burglar with poor planning.",
  () => "Unidentified person at the side gate. Could be trouble, could just be the meter reader.",
  () => "Someone's sneaking round the side gate. Bold or lost, hard to say.",
  () => "Movement at the side gate. Definitely not your average Tuesday visitor.",
  () => "Someone's at the side gate. Who's breaking in this time?"
];

// Side gate, person identified by name — known, but still taking the back way.
const INTRUDER_KNOWN_LINES = [
  name => `${name}'s coming round the side gate. Bold move.`,
  name => `It's ${name}, sneaking in the back way as usual.`,
  name => `${name}'s at the side gate. Front door not good enough?`,
  name => `Spotted: ${name}, taking the scenic route via the side gate.`,
  name => `${name}'s at the side gate again. Definitely not suspicious.`
];

const LOCATIONS = [
  {
    prefix: "doorbell",
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
    triggerEntities: ["binary_sensor.side_gate_person_detected"],
    personNameEntity: "sensor.side_gate_person_name",
    knownLines: INTRUDER_KNOWN_LINES,
    unknownLines: INTRUDER_UNKNOWN_LINES
  }
];

const TRIGGER_TO_LOCATION = new Map(
  LOCATIONS.flatMap(location =>
    location.triggerEntities.map(entityId => [entityId, location])
  )
);

const cooldowns = new Map(); // location prefix → timestamp
const lastIndexByPool = new Map(); // pool array → last picked index

function pickLine(pool, arg) {
  const last = lastIndexByPool.get(pool) ?? -1;
  let index = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && index === last) {
    index = (index + 1) % pool.length;
  }
  lastIndexByPool.set(pool, index);
  return pool[index](arg);
}

function getKnownPersonName(personNameEntityId) {
  if (!personNameEntityId) return null;
  const entity = getEntity(personNameEntityId);
  const name = String(entity?.state ?? "").trim();
  if (!name || UNKNOWN_NAME_VALUES.has(name.toLowerCase())) return null;
  return name;
}

export function initDoorbellAlert() {
  document.addEventListener("ha:state-updated", (event) => {
    const entityId = String(event.detail?.entity_id || "").toLowerCase();
    const state    = String(event.detail?.state    || "").toLowerCase();

    const location = TRIGGER_TO_LOCATION.get(entityId);
    if (!location) return;
    if (!ACTIVE_STATES.has(state)) return;

    const now = Date.now();
    if ((cooldowns.get(location.prefix) ?? 0) > now) return;
    cooldowns.set(location.prefix, now + COOLDOWN_MS);

    // 1. Wake the screensaver and reset idle timer. We deliberately do NOT switch to
    //    the cameras view — the camera popup overlay (cameraPopupOverlay.js) floats the
    //    live-feed glass card over the ambient home surface instead of dumping to the
    //    old full cameras grid. The doorbell's priority (100 in config, vs 20 for every
    //    other camera) means its popup already overrides any lower one that's up.
    wakeScreensaver();
    resetIdleTimer();

    // 2. Speak the alert — TTS runs async
    const personName = getKnownPersonName(location.personNameEntity);
    const line = personName
      ? pickLine(location.knownLines, personName)
      : pickLine(location.unknownLines);
    speak(line);
  });
}
