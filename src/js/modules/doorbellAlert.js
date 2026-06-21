import { wakeScreensaver, resetIdleTimer } from "./screensaver.js";
import { speak } from "../core/tts.js";
import { switchView } from "../core/viewManager.js";

// Matches binary_sensor.*_ringing and binary_sensor.*_doorbell entities
const DOORBELL_PATTERN = /^binary_sensor\..+_(ringing|doorbell)$/;
const DOORBELL_STATES  = new Set(["on", "ringing"]);
const COOLDOWN_MS      = 30_000; // suppress repeat alerts for 30s per entity

const cooldowns = new Map(); // entityId → timestamp

function isDoorbellEntity(entityId) {
  return DOORBELL_PATTERN.test(String(entityId || "").toLowerCase());
}

// "binary_sensor.front_door_ringing" → "front door"
function locationFromEntity(entityId) {
  const match = /^binary_sensor\.(.+?)_(ringing|doorbell)$/.exec(
    String(entityId).toLowerCase()
  );
  if (!match) return "front door";
  return match[1].split("_").join(" ");
}

// Dry, deadpan Aussie one-liners — picked client-side (no AI round-trip) so
// the alert fires instantly and never risks an AI hallucination at the one
// moment it's announcing something actually happening right now.
const DOORBELL_LINES = [
  location => `Someone's at the ${location}. Hope you've got friends.`,
  () => "Doorbell's going. Statistically, it's a parcel, not a person you like.",
  location => `Knock knock at the ${location}. Probably not a joke.`,
  () => "Someone's at the door. Bold of them to just show up unannounced.",
  location => `There's someone at the ${location}. Could be a neighbour. Could be a scam.`,
  () => "Doorbell. Must be DoorDash, nobody else visits unannounced.",
  location => `Someone's knocking at the ${location}. Try not to look too surprised you have visitors.`,
  () => "Someone's at the door. No, it's not your imagination.",
  location => `Doorbell's ringing at the ${location}. Fifty-fifty it's someone lovely or someone selling something.`,
  location => `There's a knock at the ${location}. Miracles do happen, apparently.`
];

let lastLineIndex = -1;

function pickDoorbellLine(location) {
  let index = Math.floor(Math.random() * DOORBELL_LINES.length);
  if (DOORBELL_LINES.length > 1 && index === lastLineIndex) {
    index = (index + 1) % DOORBELL_LINES.length;
  }
  lastLineIndex = index;
  return DOORBELL_LINES[index](location);
}

export function initDoorbellAlert() {
  document.addEventListener("ha:state-updated", (event) => {
    const entityId = String(event.detail?.entity_id || "").toLowerCase();
    const state    = String(event.detail?.state    || "").toLowerCase();

    if (!isDoorbellEntity(entityId)) return;
    if (!DOORBELL_STATES.has(state)) return;

    const now = Date.now();
    if ((cooldowns.get(entityId) ?? 0) > now) return;
    cooldowns.set(entityId, now + COOLDOWN_MS);

    // 1. Wake the screensaver and reset idle timer
    wakeScreensaver();
    resetIdleTimer();

    // 2. Navigate to cameras view so the snapshot popup appears over camera feeds
    switchView("cameras");

    // 3. Speak the alert — TTS runs async so navigation happens first
    const location = locationFromEntity(entityId);
    speak(pickDoorbellLine(location));
  });
}
