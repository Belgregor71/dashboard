import { defineConfig } from "@playwright/test";

// Test server runs on its own port so it never collides with a dev server.
// PORT set here wins over .env because dotenv does not override existing
// env vars. AI upstreams are stubbed to unreachable/empty so contract tests
// are deterministic and never spend API credits — and, since 2026-07-31, the
// CALENDAR feeds are stubbed for the same reason (see the env block).
const TEST_PORT = 3210;

export default defineConfig({
  testDir: "tests",
  // tests/verify/** are the heavier pre-push gates (playwright.verify.config.js).
  // Kept out of `npm test` so the everyday suite stays fast, and so the pre-push
  // hook does not run the contrast sweep twice.
  testIgnore: "verify/**",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${TEST_PORT}`,
    viewport: { width: 1920, height: 1080 }
  },
  webServer: {
    command: "node server.js",
    port: TEST_PORT,
    reuseExistingServer: true,
    timeout: 30_000,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      ANTHROPIC_API_KEY: "",
      OLLAMA_URL: "http://127.0.0.1:1",
      KOKORO_URL: "http://127.0.0.1:1",
      // Calendars were the one live upstream the suite still hit, and they made
      // it nondeterministic. arrival-card.spec's "byte-identical" case failed a
      // pre-push run on 2026-07-31 and passed 3/3 in isolation: the greeting
      // element is only created AFTER `await getRemainingTodayEvents()`
      // (arrivalGreeting.js:297), so the assertion's 5s budget was really a
      // budget for a real CalDAV round-trip to iCloud — which was 503-ing and
      // slow under full-suite load. Empty URLs make /api/calendar/all return
      // 500 "Calendar URLs missing" immediately with no network call, which the
      // contract test already accepts (statuses [200, 500]).
      CALENDAR_GOOGLE_URL: "",
      CALENDAR_APPLE_URL: "",
      CALENDAR_TRIPIT_URL: "",
      // Weather was the last live upstream the suite still hit, and it made the
      // pre-push gate depend on someone else's quota. On 2026-08-02 three full
      // runs in 25 minutes exhausted the Open-Meteo free tier; every subsequent
      // run 429'd, page.goto("/") stopped firing `load` inside its budget, and
      // 6 specs failed with the victim moving between runs — which reads
      // exactly like a real regression in whatever was last touched.
      //
      // Poisoning WEATHER_LAT would have been the CALENDAR_*_URL-style fix, but
      // fuel.js and radar.js read those same coords, so it breaks two unrelated
      // routes as collateral. (Note "" would not work regardless: Number("")
      // is 0, which is finite, so the route would still call out.) Pointing the
      // endpoint at a dead port is the narrower cut and matches how the AI
      // upstreams above are already stubbed: instant ECONNREFUSED, no network,
      // and /api/weather/* returns its documented degraded shape, which the
      // contract tests already accept.
      OPEN_METEO_URL: "http://127.0.0.1:1/v1/forecast",
      // The BOM fallback is default-off in production; keep it off here so the
      // suite exercises the same path the kiosk runs, and never reaches for the
      // live Home Assistant. Its mapping is covered by unit specs instead.
      WEATHER_BOM_FALLBACK: "0",
      // The vault lane is default-OFF in production but ON here, so its routes
      // are contract-covered. data/vault/ does not exist on a test machine, so
      // what the suite exercises is the cold-start path (0 notes, no crash) —
      // which is also the state the Pi is in before the vault repo is cloned.
      // The OFF state is verified by running the suite with this line removed.
      VAULT_ENABLED: "1"
    }
  }
});
