import { PREWARM_LINES, ALERT_TTS_RATE, namedPrewarmLines } from "../../src/js/config/alertLines.js";
import { getOrSynthesizeTts } from "../routes/tts.js";
import { fetchAlertNames } from "./alertNames.js";
import { normalizeBaseUrl } from "../config.js";

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

/* The named lines too. "It's Greg at the front door" was never cacheable from
   a list in the repo — the names are the household's and the repo is public —
   so a recognised face paid full synthesis at the door: measured 2026-10-03,
   the line was chosen at +0.6 s and its WAV landed at +10 s. The names are read
   from Home Assistant instead (alertNames.js), AFTER the name-free pool: that
   pool is the one every ring needs, and if Kokoro is down there is no point
   asking HA who lives here. */
function haNames() {
  const haHost = normalizeBaseUrl(process.env.HA_HOST || process.env.HA_URL);
  const token = process.env.HA_TOKEN;
  if (!haHost || !token) return [];
  return fetchAlertNames({ haHost, token });
}

/** One pass. `synth` and `names` are injectable for tests/tts-warmer.spec.js. */
export async function warmOnce({ synth = getOrSynthesizeTts, names = haNames } = {}) {
  let warmed = 0;
  const warm = async (lines) => {
    for (const text of lines) {
      const { cached } = await synth(text, ALERT_TTS_RATE);
      if (!cached) warmed += 1;
    }
  };

  try {
    await warm(PREWARM_LINES);
  } catch (err) {
    // Kokoro may be down; the next weekly pass retries. Warn once, don't
    // spam a line per remaining phrase.
    console.warn("[tts-warmer] Kokoro unavailable, skipping alert pre-warm:", err.message);
    return { warmed, named: 0 };
  }

  let named = 0;
  try {
    const who = await names();
    named = who.length;
    await warm(namedPrewarmLines(who));
  } catch (err) {
    // HA down, or Kokoro went away mid-pass. The name-free pool is already
    // warm, so a ring still rings; a recognised face is merely slow.
    console.warn("[tts-warmer] named alert lines not pre-warmed:", err.message);
  }

  if (warmed > 0) {
    // The COUNT of names only — the journal is not the place for who lives here.
    console.log(`[tts-warmer] pre-warmed ${warmed} alert line(s) into the TTS cache (${named} name(s))`);
  }
  return { warmed, named };
}

export function startTtsWarmer() {
  warmOnce();
  // unref so a warmer timer can never hold the process open on shutdown.
  setInterval(warmOnce, REWARM_INTERVAL_MS).unref();
}
