import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Phase 4 "Give it a voice" (docs/vision/phase-4-voice.md) — the Mode 3 voice
 * session, driven hardware-free through the __voiceTranscript hook (the same
 * way the Pi will be verified over CDP until the mic lands).
 *
 * With features.voiceSession ON, a submitted transcript enters MODE.VOICE and
 * walks the lanes: local commands → /api/voice/assist → /api/voice/converse,
 * then lingers and recedes to GLANCE. OFF (default) is byte-identical: the
 * hook exists but refuses, and presence never enters voice.
 *
 * The upstream lanes are stubbed with page.route so no real HA or AI is ever
 * contacted from this spec.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

// Pin a deterministic daytime so the screensaver does not auto-engage at boot
// (evening boots start AMBIENT and would fight the mode assertions).
const MIDDAY = new Date("2026-07-06T12:00:00");

function enableFlags(voiceSession) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        "\nwindow.CONFIG.features.presenceRuntime = true;" +
        `\nwindow.CONFIG.features.voiceSession = ${voiceSession};\n`;
      await route.fulfill({ response: res, body });
    });
}

async function boot(page, { voiceSession }) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(voiceSession)(page);
  await page.clock.setFixedTime(MIDDAY);
  await page.goto("/");
  await page.waitForFunction(
    () =>
      typeof window.__voiceSession === "function" &&
      typeof window.__voiceTranscript === "function"
  );
  return pageErrors;
}

test("on: a local command is handled in-session, enters MODE.VOICE, then recedes", async ({ page }) => {
  const pageErrors = await boot(page, { voiceSession: true });

  const result = await page.evaluate(() => window.__voiceTranscript("what time is it"));
  expect(result.handled).toBe(true);
  expect(result.lane).toBe("local");

  const state = await page.evaluate(() => window.__voiceSession());
  expect(state.enabled).toBe(true);
  expect(state.active).toBe(true);
  expect(state.phase).toBe("linger");
  expect(state.mode).toBe("voice");

  // Graceful recede: the ~8s linger expires → session idle, presence GLANCE.
  await expect
    .poll(() => page.evaluate(() => window.__voiceSession().phase), { timeout: 15_000 })
    .toBe("idle");
  const after = await page.evaluate(() => window.__voiceSession());
  expect(after.mode).toBe("glance");
  expect(after.turns).toBe(0); // history cleared on recede

  expect(pageErrors).toEqual([]);
});

test("on: a transcript POSTed to the mic bridge drives a turn over SSE", async ({ page, request }) => {
  const pageErrors = await boot(page, { voiceSession: true });

  // The kiosk opens the mic-bridge SSE on init; wait for it to connect so the
  // server fan-out has a listener (the bus does not buffer past emissions).
  await expect
    .poll(() => page.evaluate(() => window.__voiceSession().streamOpen), { timeout: 10_000 })
    .toBe(true);

  // The Pi's on-device wake/STT agent would POST the finished transcript here.
  const resp = await request.post("/api/voice/transcript", { data: { text: "what time is it" } });
  expect(resp.status()).toBe(200);
  expect(await resp.json()).toEqual({ ok: true });

  // It arrives over SSE → submitTranscripts → local lane → MODE.VOICE.
  await expect
    .poll(() => page.evaluate(() => window.__voiceSession().mode), { timeout: 10_000 })
    .toBe("voice");
  const state = await page.evaluate(() => window.__voiceSession());
  expect(state.active).toBe(true);
  expect(state.phase).toBe("linger");

  expect(pageErrors).toEqual([]);
});

test("on: unmatched text falls through assist → converse and keeps bounded context", async ({ page }) => {
  const converseBodies = [];
  await page.route("**/api/voice/assist", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ handled: false, speech: null, conversationId: "conv-1", source: "assist" })
    })
  );
  await page.route("**/api/voice/converse", (route) => {
    converseBodies.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ reply: "Test reply from the house.", source: "claude" })
    });
  });

  const pageErrors = await boot(page, { voiceSession: true });

  const first = await page.evaluate(() => window.__voiceTranscript("tell me something interesting"));
  expect(first.handled).toBe(true);
  expect(first.lane).toBe("converse");

  let state = await page.evaluate(() => window.__voiceSession());
  expect(state.phase).toBe("linger");
  expect(state.mode).toBe("voice");
  expect(state.turns).toBe(2); // user + assistant
  expect(state.conversationId).toBe("conv-1"); // assist id retained for follow-ups

  // A follow-up inside the linger window continues the same session and the
  // converse lane carries the rolling history.
  const second = await page.evaluate(() => window.__voiceTranscript("and one more"));
  expect(second.lane).toBe("converse");
  state = await page.evaluate(() => window.__voiceSession());
  expect(state.turns).toBe(4);

  expect(converseBodies.length).toBe(2);
  expect(converseBodies[0].history).toEqual([]);
  expect(converseBodies[1].history).toEqual([
    { role: "user", text: "tell me something interesting" },
    { role: "assistant", text: "Test reply from the house." }
  ]);

  expect(pageErrors).toEqual([]);
});

test("on: both upstream lanes down → honest unavailable state, no crash", async ({ page }) => {
  await page.route("**/api/voice/assist", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ handled: false, speech: null, conversationId: null, source: "assist" })
    })
  );
  await page.route("**/api/voice/converse", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ reply: null })
    })
  );

  const pageErrors = await boot(page, { voiceSession: true });

  const result = await page.evaluate(() => window.__voiceTranscript("complete gibberish request"));
  expect(result.handled).toBe(false);

  const overlayState = await page.evaluate(
    () => document.getElementById("voice_overlay")?.dataset.state
  );
  expect(overlayState).toBe("error");

  expect(pageErrors).toEqual([]);
});

test("off (default): the session refuses and presence never enters voice", async ({ page }) => {
  const pageErrors = await boot(page, { voiceSession: false });

  const state = await page.evaluate(() => window.__voiceSession());
  expect(state.enabled).toBe(false);

  const result = await page.evaluate(() => window.__voiceTranscript("what time is it"));
  expect(result.handled).toBe(false);

  const after = await page.evaluate(() => window.__voiceSession());
  expect(after.active).toBe(false);
  expect(after.mode).not.toBe("voice");

  expect(pageErrors).toEqual([]);
});
