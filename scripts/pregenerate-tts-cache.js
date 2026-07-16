// Pre-warms the TTS disk cache (server/routes/tts.js) for the doorbell/side-gate
// alert lines that don't depend on a person's name, so real triggers play
// instantly instead of waiting on live Kokoro synthesis.
//
// The server already warms these on boot (server/services/ttsWarmer.js); this
// script is the manual equivalent for warming against a running dashboard
// without a restart. Lines + rate come from the shared source of truth so the
// two can never drift out of sync.
//
// Run on the Pi: node scripts/pregenerate-tts-cache.js

import { PREWARM_LINES, ALERT_TTS_RATE } from "../src/js/config/alertLines.js";

const SERVER_URL = process.env.DASHBOARD_URL ?? "http://localhost:3000";

for (const text of PREWARM_LINES) {
  const start = Date.now();
  try {
    const res = await fetch(`${SERVER_URL}/api/tts/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, rate: ALERT_TTS_RATE })
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${res.ok ? "OK" : "FAIL " + res.status} (${elapsed}s) - ${text}`);
  } catch (err) {
    console.log(`ERROR - ${text}: ${err.message}`);
  }
}
