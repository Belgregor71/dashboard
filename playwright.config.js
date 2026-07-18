import { defineConfig } from "@playwright/test";

// Test server runs on its own port so it never collides with a dev server.
// PORT set here wins over .env because dotenv does not override existing
// env vars. AI upstreams are stubbed to unreachable/empty so contract tests
// are deterministic and never spend API credits.
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
      KOKORO_URL: "http://127.0.0.1:1"
    }
  }
});
