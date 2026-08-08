import { wakeScreensaver, resetIdleTimer } from "./screensaver.js";
import { speak } from "../core/tts.js";
import { ALERT_TTS_RATE } from "../config/alertLines.js";
import { routeAlert } from "../services/alertRouter.js";

// The doorbell and side gate, on the incumbent surface.
//
// The DECISION — which entities are triggers, which camera answers for them,
// which line pool, the identified name, the per-location cooldown — moved to
// services/alertRouter.js at V3 migration step 3.1 so both surfaces share one
// answer. What stays here is what is genuinely this surface's: the DOM event it
// listens on, and the effects it produces.
//
// This module's behaviour is unchanged by that move. It is what is on the wall.

const cooldowns = new Map(); // location prefix → expiry timestamp

export function initDoorbellAlert() {
  document.addEventListener("ha:state-updated", (event) => {
    // No freshness gate here, and that is deliberate: this listener is on the
    // `document` re-broadcast, which the incumbent only starts hearing after its
    // own boot, whereas V3 subscribes to the bus and does see the opening
    // snapshot. Adding one would be harmless; claiming it were load-bearing here
    // would not be true.
    const alert = routeAlert(event.detail, { cooldowns });
    if (!alert) return;

    // 1. Wake the screensaver and reset idle timer. We deliberately do NOT switch to
    //    the cameras view — the camera popup overlay (cameraPopupOverlay.js) floats the
    //    live-feed glass card over the ambient home surface instead of dumping to the
    //    old full cameras grid. The doorbell's priority (100 in config, vs 20 for every
    //    other camera) means its popup already overrides any lower one that's up.
    wakeScreensaver();
    resetIdleTimer();

    // 2. Speak the alert — TTS runs async. Speak at the shared rate so the
    //    server's pre-warmed cache keys match.
    speak(alert.line, { rate: ALERT_TTS_RATE });
  });
}
