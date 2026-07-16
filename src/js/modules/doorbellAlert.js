import { wakeScreensaver, resetIdleTimer } from "./screensaver.js";
import { speak } from "../core/tts.js";
import { getEntity } from "../services/homeAssistant/state.js";
import {
  ALERT_TTS_RATE,
  VISITOR_UNKNOWN_LINES,
  VISITOR_KNOWN_LINES,
  INTRUDER_UNKNOWN_LINES,
  INTRUDER_KNOWN_LINES
} from "../config/alertLines.js";

const ACTIVE_STATES = new Set(["on", "ringing"]);
const COOLDOWN_MS = 30_000; // suppress repeat alerts for 30s per location

// Values the Eufy person-name sensor uses when it hasn't identified anyone.
const UNKNOWN_NAME_VALUES = new Set(["no person", "unknown", "unavailable", ""]);

// Dry, deadpan Aussie one-liners live in ../config/alertLines.js — a source
// shared with the server so it can pre-warm the TTS cache for the name-free
// lines. They're picked client-side (no AI round-trip) so the alert fires
// instantly and never risks an AI hallucination at the one moment it's
// announcing something actually happening right now. Name-free lines are plain
// strings; name-specific lines are `name => "..."` templates.

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

function pickLine(pool) {
  const last = lastIndexByPool.get(pool) ?? -1;
  let index = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && index === last) {
    index = (index + 1) % pool.length;
  }
  lastIndexByPool.set(pool, index);
  return pool[index];
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

    // 2. Speak the alert — TTS runs async. Name-free lines are strings the
    //    server has pre-warmed into the cache (instant playback); name lines
    //    are templates resolved here. Speak at the shared rate so the pre-warm
    //    cache keys match.
    const personName = getKnownPersonName(location.personNameEntity);
    const entry = personName
      ? pickLine(location.knownLines)
      : pickLine(location.unknownLines);
    const line = typeof entry === "function" ? entry(personName) : entry;
    speak(line, { rate: ALERT_TTS_RATE });
  });
}
