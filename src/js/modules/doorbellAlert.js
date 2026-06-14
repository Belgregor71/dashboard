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

// "binary_sensor.front_door_ringing" → "Front Door"
function locationFromEntity(entityId) {
  const match = /^binary_sensor\.(.+?)_(ringing|doorbell)$/.exec(
    String(entityId).toLowerCase()
  );
  if (!match) return "the front door";
  return match[1]
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
    speak(`Someone is at the ${location}.`);
  });
}
