import { PREWARM_LINES, ALERT_TTS_RATE } from "../../src/js/config/alertLines.js";
import { getOrSynthesizeTts } from "../routes/tts.js";

// Doorbell/side-gate alerts speak a fixed set of name-free lines. Kokoro
// synthesis is slow (~10-17s/line on the NAS), so a cold cache means real
// rings 502 or fall back to robotic browser TTS. Warm those lines into the
// disk cache on boot — sequentially and in the background so we never block
// startup or hammer Kokoro. Already-cached lines return instantly, so after
// the first warm this is nearly free on every restart.
export function startTtsWarmer() {
  (async () => {
    let warmed = 0;
    for (const text of PREWARM_LINES) {
      try {
        const { cached } = await getOrSynthesizeTts(text, ALERT_TTS_RATE);
        if (!cached) warmed += 1;
      } catch (err) {
        // Kokoro may be down at boot; a later restart retries. Warn once,
        // don't spam a line per remaining phrase.
        console.warn("[tts-warmer] Kokoro unavailable, skipping alert pre-warm:", err.message);
        return;
      }
    }
    if (warmed > 0) {
      console.log(`[tts-warmer] pre-warmed ${warmed} alert line(s) into the TTS cache`);
    }
  })();
}
