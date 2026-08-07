import { PREWARM_LINES, ALERT_TTS_RATE } from "../../src/js/config/alertLines.js";
import { getOrSynthesizeTts } from "../routes/tts.js";

// Doorbell/side-gate alerts speak a fixed set of name-free lines. Kokoro
// synthesis is slow (~10-17s/line on the NAS), so a cold cache means real
// rings 502 or fall back to robotic browser TTS. Warm those lines into the
// disk cache on boot — sequentially and in the background so we never block
// startup or hammer Kokoro. Already-cached lines return instantly, so after
// the first warm this is nearly free on every restart.
// Re-run weekly, not just at boot. Reading a cache entry now refreshes its
// mtime, so any line that actually rings stays alive — but the alert lines are
// a RANDOM POOL, and a member that happens not to be chosen inside the 14-day
// ceiling would still be evicted and be slow the next time it came up. A
// kiosk stays up for weeks at a time, so "it comes back on the next restart"
// is not a recovery plan.
//
// Cheap by construction: already-cached lines return instantly, so a normal
// run does no synthesis and no network at all.
const REWARM_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

async function warmOnce() {
  let warmed = 0;
  for (const text of PREWARM_LINES) {
    try {
      const { cached } = await getOrSynthesizeTts(text, ALERT_TTS_RATE);
      if (!cached) warmed += 1;
    } catch (err) {
      // Kokoro may be down; the next weekly pass retries. Warn once, don't
      // spam a line per remaining phrase.
      console.warn("[tts-warmer] Kokoro unavailable, skipping alert pre-warm:", err.message);
      return;
    }
  }
  if (warmed > 0) {
    console.log(`[tts-warmer] pre-warmed ${warmed} alert line(s) into the TTS cache`);
  }
}

export function startTtsWarmer() {
  warmOnce();
  // unref so a warmer timer can never hold the process open on shutdown.
  setInterval(warmOnce, REWARM_INTERVAL_MS).unref();
}
