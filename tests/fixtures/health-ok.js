/* Pin /api/system/health to a wall with nothing wrong with it.

   ── WHY A SPEC ABOUT ATTENTION HAS TO SAY ANYTHING ABOUT HEALTH ─────────────

   The suite points HA at a dead port on purpose (playwright.config.js, HA_HOST
   =127.0.0.1:1) so no spec depends on the real house. healthService then draws
   the only correct conclusion — "Home Assistant isn't answering" — and V3's
   health lane does its job and announces it: v3/core/health.js, `id: "health"`,
   HEALTH_SCORE **72**, the High band.

   72 outranks every probe the attention specs inject (42, 45, 50), so `hero`
   comes back `health` and an assertion about the engine's ranking fails for a
   reason that has nothing to do with the engine.

   ⚠⚠ THE TRAP IS THE TIMING, AND IT IS WHY THIS LOOKED LIKE A FLAKE FOR WEEKS.
   getHealth() serves `state` and `coverage` feeds live but reads `heartbeat`
   and `on-demand` feeds from a CACHE that only evaluateAll() writes, on
   EVAL_INTERVAL_MS = 60_000 (server/services/healthService.js). So a freshly
   booted test server reports `ok` for a definitively unreachable HA for its
   first minute, and only then flips to `error` — permanently.

   Measured 2026-08-19 on a server with zero traffic, no specs and no AI calls:

       t+54s  overall=error  ERROR: ha (disconnected)

   The consequence for anyone debugging this: the affected specs PASS in
   isolation (a three-file run finishes in ~13s, inside the quiet minute) and
   FAIL in the full suite (~11min, long past it). That is server WALL-CLOCK AGE,
   not suite length or test count — and `reuseExistingServer: true` means a
   leftover server from an earlier run is already degraded, so even an isolated
   run fails against one. A green isolated run proves nothing here.

   ── WHY PIN RATHER THAN LOOSEN THE ASSERTION ────────────────────────────────

   Exactly the precedent tests/v3-presence-depth.spec.js already set when the
   memory lane's MEMORY_SCORE 44 outranked its 42 probe: turn the competing lane
   OFF rather than widen the expectation, because the real defect is that the
   result depended on uncontrolled state of the machine running the suite. Same
   rule as the repo's contract-test philosophy — assert shapes, never live data.

   ⚠ THIS DOES NOT MAKE THE HEALTH LANE UNCONDITIONALLY SILENT, and it must not:
   bootFault() outranks every feed in worstFault(), so a spec whose page failed
   to boot still gets its health candidate. That is the one fault worth keeping,
   since it is known locally rather than read from the server being stubbed.

   Health's OWN behaviour is covered where it belongs — tests/v3-health.spec.js
   and tests/v3-boot.spec.js, both of which serve their own payloads. Registering
   a route here does not disturb them: page.route() matches LAST-registered
   first, so a spec that installs its own health route after calling this still
   wins.
─────────────────────────────────────────────────────────────────────────── */

/* The live shape, feed-for-feed with FEEDS in server/services/healthService.js,
   rather than a two-entry stub. A fixture that is missing the feed a regression
   introduces is a fixture that cannot catch it. */
export const HEALTH_OK = Object.freeze({
  overall: "ok",
  feeds: Object.freeze([
    { id: "ha", label: "Home Assistant", level: "ok", detail: null },
    { id: "wan", label: "Internet", level: "ok", detail: null },
    { id: "motion", label: "Motion events", level: "ok", detail: null },
    { id: "motionCoverage", label: "Motion coverage", level: "ok", detail: null },
    { id: "weather", label: "Weather", level: "ok", detail: null },
    { id: "calendar", label: "Calendar", level: "ok", detail: null },
    { id: "cameras", label: "Camera snapshots", level: "ok", detail: null },
    { id: "ai", label: "AI briefings", level: "ok", detail: null },
    { id: "tts", label: "Text-to-speech", level: "ok", detail: null }
  ]),
  recoveries: Object.freeze([])
});

/**
 * Answer /api/system/health with a healthy wall, so the health lane announces
 * nothing and the attention engine is asked only about the spec's own probes.
 *
 * ⚠ Call BEFORE page.goto(). v3/core/health.js polls once during initHealth()
 * rather than waiting out its 60s interval, so a route installed after the
 * navigation arrives too late for the poll that actually matters.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function pinHealthOk(page) {
  await page.route("**/api/system/health*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      // updatedAt is stamped per request: the readout renders an age from it,
      // and a frozen timestamp would drift into "stale" over a long file.
      body: JSON.stringify({ ...HEALTH_OK, updatedAt: Date.now() })
    })
  );
}
