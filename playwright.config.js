import { defineConfig } from "@playwright/test";

// Test server runs on its own port so it never collides with a dev server.
// PORT set here wins over .env because dotenv does not override existing
// env vars. AI upstreams are stubbed to unreachable/empty so contract tests
// are deterministic and never spend API credits — and, since 2026-07-31, the
// CALENDAR feeds are stubbed for the same reason (see the env block).
// TEST_PORT is overridable so two suites can run at once from separate git
// worktrees (the /variants fan-out). Default unchanged at 3210: every existing
// invocation, the pre-push gate included, still lands on the same port it always
// has. Back-to-back runs on ONE port collide, which is the other reason this
// exists — an overlapping run inherits the previous server and reports nonsense.
// Exported because a handful of specs open RAW http/SSE connections that bypass
// Playwright's baseURL entirely (the voice stream ones). They must read the port
// from HERE — the same number written in two files is a drift this repo has been
// bitten by before, and on an overridden port those specs failed while the rest
// of the file passed.
export const TEST_PORT = Number(process.env.TEST_PORT) || 3210;
export const TEST_ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

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
    viewport: { width: 1920, height: 1080 },
    // KOKORO_URL is stubbed to a dead port below, so every speak() in the page
    // falls through tts.js's `speakWithBrowserTts` to window.speechSynthesis —
    // which on Windows is a real SAPI voice on the developer's default output
    // device. A suite run would announce the greeting time out loud (and, since
    // most specs pin the clock to MIDDAY, announce "12 pm" over and over).
    // Mute the test browser rather than the fallback: the fallback is the thing
    // that keeps the kiosk from going silent if Kokoro dies, so it must stay
    // exercised — it just must not be audible here.
    launchOptions: { args: ["--mute-audio"] }
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
      // Home Assistant was the LAST live upstream the gate still depended on,
      // and the one long documented as making specs fail "because the TV is on
      // at the house". It fails worse than the others did: HA runs on the NAS,
      // and a sleeping NAS BLACK-HOLES the connection rather than refusing it,
      // so on 2026-08-05 the media-art proxy spec spent its entire 10s budget
      // and failed the pre-push gate while nothing was wrong with the code.
      // A dead port refuses instantly instead, and every HA contract test
      // already accepts that: health/snapshot take [200, 502], and the
      // media-art path documents 503 as "HA unconfigured on this machine".
      // Routing stays fully asserted — only the house stops being consulted.
      HA_HOST: "http://127.0.0.1:1",
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
