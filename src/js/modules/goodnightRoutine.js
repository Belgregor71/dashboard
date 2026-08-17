import { speak } from "../core/tts.js";
import { engageScreensaver } from "./screensaver.js";
import { prepareGoodnight } from "../services/goodnight.js";

/* The incumbent's ending. Everything above it — tomorrow's events, the line,
   the HA scene — moved to services/goodnight.js on 2026-08-17 so V3 could
   reach it without importing the screensaver. See that file's header. */
export async function triggerGoodnight() {
  // Speak the goodnight message and wait for it to finish before dimming
  await speak(await prepareGoodnight(), { rate: 0.88 });

  // Transition to minimal clock mode
  engageScreensaver({ startMode: "minimal" });
}
