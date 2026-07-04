import { resetIdleTimer, wakeScreensaver, isScreensaverActive } from "../modules/screensaver.js";

// Eufy Kitchen camera — HA binary sensor entity IDs
const WATCH_ENTITIES = new Set([
  "binary_sensor.kitchen_motion_detected",
  "binary_sensor.kitchen_person_detected",
]);

export function initMotionTrigger() {
  document.addEventListener("ha:state-updated", (event) => {
    const entity = event.detail;
    if (!WATCH_ENTITIES.has(entity?.entity_id)) return;
    if (entity?.state !== "on") return;

    console.info(`[MOTION] ${entity.entity_id} → on; ${isScreensaverActive() ? "waking screensaver" : "resetting idle timer"}`);
    resetIdleTimer();
    if (isScreensaverActive()) wakeScreensaver();

    // When a mic is added: uncomment to trigger voice on person detection
    // if (entity.entity_id === "binary_sensor.kitchen_person_detected") {
    //   startListening();
    // }
  });

  console.info("Motion trigger: watching Eufy Kitchen sensors via Home Assistant");
}
