import { test as base, expect } from "@playwright/test";
import { withVoiceBusLock } from "./fixtures/voice-bus-lock.js";

// `voiceBus` serialises the tests that post or suffer a barge-in — see the fixture.
const test = withVoiceBusLock(base);
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

function enableFlags(voiceSession, halfDuplex) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        "\nwindow.CONFIG.features.presenceRuntime = true;" +
        `\nwindow.CONFIG.features.voiceSession = ${voiceSession};` +
        `\nwindow.CONFIG.features.voiceHalfDuplex = ${halfDuplex};\n`;
      await route.fulfill({ response: res, body });
    });
}

async function boot(page, { voiceSession, halfDuplex = false }) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(voiceSession, halfDuplex)(page);
  await page.clock.setFixedTime(MIDDAY);
  await page.goto("/index.html");
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

/* ═══════════════════════════════════════════════════════════════════════════
   HALF DUPLEX — the house stops talking when someone says the wake word, and
   never answers its own voice.

   Regression, 2026-08-08/09: the kiosk's mic hears its own HDMI speakers, so
   the wake agent transcribed the dashboard's replies back into this pipeline
   and the house answered itself — "It's 18 degrees and clear." arrived as a
   question. The agent cannot tell our voice from a person's; it has to be told
   when we are talking, and it has to be able to tell us to stop.

   The TTS fetch is stubbed with a real (tiny) WAV rather than left to hit
   Kokoro, because the whole contract under test is when playback STARTS and
   STOPS — a failed fetch would fall through to browser speechSynthesis, which
   is silent and untimed in headless Chromium.
   ═══════════════════════════════════════════════════════════════════════════ */

// 0.2s of silence, 16-bit mono 8kHz — long enough to still be playing when the
// assertions run, small enough to inline.
function silentWav(seconds = 0.2, rate = 8000) {
  const samples = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

async function stubVoiceLanes(page, speaking) {
  await page.route("**/api/tts/speak", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav() })
  );
  await page.route("**/api/voice/assist", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ handled: false, speech: null, conversationId: null, source: "assist" })
    })
  );
  await page.route("**/api/voice/converse", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ reply: "A reply the microphone must not hear.", source: "claude" })
    })
  );
  // Record the half-duplex reports instead of letting them reach the server —
  // the real endpoint would flip state shared with every other spec.
  await page.route("**/api/voice/speaking", async (route) => {
    speaking.push(route.request().postDataJSON()?.speaking);
    await route.fulfill({ status: 204, body: "" });
  });
}

/* ═══ THE BLOB LEDGER ════════════════════════════════════════════════════════
   Every utterance the house speaks arrives as a WAV blob and is played through
   `new Audio(URL.createObjectURL(blob))`. An object URL pins the whole buffer
   for the life of the document, and blob memory does not show in the JS heap —
   so on a kiosk that runs for weeks without a reload, a missed revoke is
   invisible until the tab dies. The 2026-07 audit found every TTS WAV still
   pinned; tts.js was rewritten to revoke on all four terminal paths.

   ⚠ NOTHING COUNTED THEM. A mutation sweep on 2026-09-19 deleted the revoke
   from the single-shot path, from the streamed path, and from the `finally`
   backstop, one at a time, and the whole suite stayed green each time: these
   specs DO reach the playback path (they serve a real audio/wav), they simply
   never asked what happened to the URL afterwards.

   So this counts. The ledger is created-minus-revoked, which is the only
   question that matters and the only one a heap snapshot cannot answer.
─────────────────────────────────────────────────────────────────────────── */
async function countObjectUrls(page) {
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    window.__blobLedger = { created: [], revoked: [] };
    URL.createObjectURL = (obj) => {
      const url = create(obj);
      window.__blobLedger.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__blobLedger.revoked.push(url);
      return revoke(url);
    };
  });
}

const ledger = (page) => page.evaluate(() => {
  const { created, revoked } = window.__blobLedger;
  const outstanding = created.filter((u) => !revoked.includes(u));
  return { created: created.length, revoked: revoked.length, outstanding };
});

test("every spoken WAV releases its object URL — the ledger balances", async ({ page, voiceBus }) => {
  await countObjectUrls(page);
  const speaking = [];
  await stubVoiceLanes(page, speaking);
  const pageErrors = await boot(page, { voiceSession: true, halfDuplex: true });

  for (const line of ["tell me something interesting", "and another thing", "one more"]) {
    await page.evaluate((t) => window.__voiceTranscript(t), line);
    await expect.poll(() => speaking.includes(false), { timeout: 10_000 }).toBe(true);
    speaking.length = 0;
  }

  // The count must be non-zero first: a ledger that balances at 0 = 0 is a test
  // that proves the page never spoke, which is exactly how this would rot.
  await expect.poll(async () => (await ledger(page)).created, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect
    .poll(async () => (await ledger(page)).outstanding.length, { timeout: 10_000 })
    .toBe(0);

  const final = await ledger(page);
  expect(final.revoked, `${final.outstanding.length} WAV(s) still pinned`).toBe(final.created);
  expect(pageErrors).toEqual([]);
});

test("a reply interrupted mid-sentence still releases its WAV", async ({ page, request, voiceBus }) => {
  /* The terminal path that is NOT "the audio finished": silence() cuts the
     playback when someone barges in, and an interrupted utterance leaks exactly
     as readily as a completed one — more so, because it is the path nobody
     reaches by hand. */
  await countObjectUrls(page);
  const speaking = [];
  await stubVoiceLanes(page, speaking);
  const pageErrors = await boot(page, { voiceSession: true, halfDuplex: true });

  await page.route("**/api/tts/speak", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav(30) })
  );
  await page.evaluate(() => window.__voiceTranscript("say something long"));
  await expect.poll(async () => (await ledger(page)).created, { timeout: 10_000 }).toBeGreaterThan(0);

  // Cut it off mid-sentence, then let the teardown settle.
  await page.evaluate(() => window.__voiceTranscript("stop"));
  await expect
    .poll(async () => (await ledger(page)).outstanding.length, { timeout: 10_000 })
    .toBe(0);
  expect(pageErrors).toEqual([]);
});

/* ⛔ NOT COVERED, DELIBERATELY LEFT UNCOVERED RATHER THAN COVERED BADLY:
   tts.js's `voiceschanged` listener in ensureVoices(). Without { once: true }
   that is one permanent listener per browser-fallback utterance on a page that
   never reloads, and the 2026-09-19 sweep removed the flag with nothing going
   red. A first attempt at a test here counted REGISTRATIONS and passed at zero
   in both directions — headless Chromium already has voices, so ensureVoices()
   returns before it ever listens — which is precisely the vacuous assertion
   this sweep exists to find, so it was deleted rather than shipped.
   Observing it needs getVoices() forced empty AND a voiceschanged dispatched
   per utterance to keep the promise from pending; worth doing, not worth a
   flaky gate. See the session's harden-tests report. */

test("half duplex on: the page tells the mic when it starts and stops talking", async ({ page, voiceBus }) => {
  const speaking = [];
  await stubVoiceLanes(page, speaking);
  const pageErrors = await boot(page, { voiceSession: true, halfDuplex: true });

  expect(await page.evaluate(() => window.__voiceSession().halfDuplex)).toBe(true);

  await page.evaluate(() => window.__voiceTranscript("tell me something interesting"));

  // true first, and eventually false — a mic gated open forever is a mic that
  // has stopped listening, which is worse than the echo it was fixing.
  await expect.poll(() => speaking[0], { timeout: 10_000 }).toBe(true);
  await expect.poll(() => speaking.includes(false), { timeout: 10_000 }).toBe(true);
  expect(speaking.indexOf(true)).toBeLessThan(speaking.lastIndexOf(false));

  expect(pageErrors).toEqual([]);
});

test("half duplex on: a barge-in over SSE silences the page mid-sentence", async ({ page, request, voiceBus }) => {
  const speaking = [];
  await stubVoiceLanes(page, speaking);

  // tts.js plays through `new Audio(url)`, which is NEVER appended to the
  // document — the first version of this test looked for it with
  // querySelectorAll("audio"), found nothing, and could not have observed the
  // interruption whether or not it happened. Capture the constructor instead.
  await page.addInitScript(() => {
    const Native = window.Audio;
    window.__ttsAudio = [];
    window.Audio = function (...args) {
      const el = new Native(...args);
      window.__ttsAudio.push(el);
      return el;
    };
    window.Audio.prototype = Native.prototype;
  });

  const pageErrors = await boot(page, { voiceSession: true, halfDuplex: true });

  await expect
    .poll(() => page.evaluate(() => window.__voiceSession().streamOpen), { timeout: 10_000 })
    .toBe(true);

  // Half a minute of reply, so "it stopped" cannot be the clip simply ending.
  // Registered after the 0.2s stub and therefore matched first.
  await page.route("**/api/tts/speak", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav(30) })
  );
  await page.evaluate(() => window.__voiceTranscript("tell me something interesting"));
  await expect.poll(() => speaking[speaking.length - 1], { timeout: 10_000 }).toBe(true);
  const playingBefore = await page.evaluate(
    () => window.__ttsAudio.some((a) => !a.paused)
  );

  // The agent hears the wake word over the reply and takes the floor.
  expect((await request.post("/api/voice/barge-in", { data: {} })).status()).toBe(200);

  await expect
    .poll(() => page.evaluate(() => window.__ttsAudio.every((a) => a.paused)), { timeout: 10_000 })
    .toBe(true);
  // And the gate reopens, or the barge-in would have deafened the mic it served.
  await expect.poll(() => speaking[speaking.length - 1], { timeout: 10_000 }).toBe(false);

  // Asserted last so a failure above reports the interesting thing first — but
  // asserted, because a clip that never started cannot be interrupted and the
  // two polls above would both pass on an empty list.
  expect(playingBefore, "nothing was playing, so nothing was interrupted").toBe(true);
  expect(pageErrors).toEqual([]);
});

test("half duplex off (default): nothing is reported and no observer is installed", async ({ page }) => {
  const speaking = [];
  await stubVoiceLanes(page, speaking);
  const pageErrors = await boot(page, { voiceSession: true, halfDuplex: false });

  expect(await page.evaluate(() => window.__voiceSession().halfDuplex)).toBe(false);

  await page.evaluate(() => window.__voiceTranscript("tell me something interesting"));
  await expect
    .poll(() => page.evaluate(() => window.__voiceSession().phase), { timeout: 10_000 })
    .toBe("linger");

  // The flag-off build must make no request this file did not make before.
  expect(speaking, "the flag-off build reported speaking state").toEqual([]);
  expect(pageErrors).toEqual([]);
});
