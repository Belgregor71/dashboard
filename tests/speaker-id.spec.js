import { test as base, expect } from "@playwright/test";
import { withVoiceBusLock } from "./fixtures/voice-bus-lock.js";
import { TEST_ORIGIN } from "../playwright.config.js";
import {
  SPEAKER_UNKNOWN_LINE,
  HOUSEHOLD,
  knownSpeaker,
  speakerKnownLine
} from "../server/services/voiceShape.js";
import { converseSystem } from "../server/routes/voice.js";
import { calendarOwners } from "../server/routes/calendar.js";
import { renderTranscript } from "../server/services/conversationLog.js";
import { answer } from "../src/js/services/localAnswers.js";

const test = withVoiceBusLock(base);

/* Speaker ID, the dashboard half (docs/design/HANDOVER-SPEAKER-ID.md).
   The STT half is proven offline in tools/voice-pc/spk_selftest.py.

   Owner, 2026-10-16: NEUTRAL — identity serves "am I free" and relationships,
   never the tease licence — and google is Greg's, apple + tripit are shared.

   Every lever here has an off state, and the off state is "today, exactly":
   a turn with no speaker, a speaker outside the household, or the page flag
   off must change nothing. Both directions are asserted. */

test.describe("knownSpeaker — only the household, everything else is unknown", () => {
  test("names the two of them and nobody else", () => {
    expect(HOUSEHOLD).toEqual(["Greg", "Brett"]);
    expect(knownSpeaker("Greg")).toBe("Greg");
    expect(knownSpeaker("Brett")).toBe("Brett");
    for (const other of [null, undefined, "", "greg", "Mallory", 42, {}]) {
      expect(knownSpeaker(other)).toBeNull();
    }
  });
});

test.describe("converseSystem — the speaker line is SWAPPED, and unknown is byte-identical", () => {
  const KEY = "HOUSE_CHARACTER_ENABLED";
  let saved;
  test.beforeEach(() => { saved = process.env[KEY]; });
  test.afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  for (const character of ["0", "1"]) {
    test(`character ${character}: null and an outsider leave the prompt exactly as it was`, () => {
      process.env[KEY] = character;
      const before = converseSystem("hello", []);
      expect(before).toContain(SPEAKER_UNKNOWN_LINE);
      expect(converseSystem("hello", [], null, null, null, null, null)).toBe(before);
      expect(converseSystem("hello", [], null, null, null, null, "Mallory")).toBe(before);
    });

    test(`character ${character}: Greg replaces the unknown line and nothing else moves`, () => {
      process.env[KEY] = character;
      const before = converseSystem("hello", []);
      const greg = converseSystem("hello", [], null, null, null, null, "Greg");
      expect(greg).not.toContain(SPEAKER_UNKNOWN_LINE);
      expect(greg).toContain(speakerKnownLine("Greg"));
      // One line swapped — so swapping it back is the original, byte for byte.
      expect(greg.replace(speakerKnownLine("Greg"), SPEAKER_UNKNOWN_LINE)).toBe(before);
    });
  }

  test("the known line is neutral: it names the speaker, forbids remarking on it, and forbids the joke", () => {
    const line = speakerKnownLine("Brett");
    expect(line).toContain("The person speaking now is Brett");
    expect(line).toMatch(/do not remark on who is speaking/i);
    expect(line).toMatch(/never make Brett or Greg the subject of a joke/i);
    expect(line).toContain("name Greg");
  });
});

test.describe("CALENDAR_OWNERS — whose feed is whose", () => {
  test("parses source:Name pairs; unset or junk is no owners at all", () => {
    expect(calendarOwners("google:Greg")).toEqual({ google: "Greg" });
    expect(calendarOwners(" google : Greg , apple:Brett ")).toEqual({ google: "Greg", apple: "Brett" });
    for (const junk of [undefined, "", "google", ":Greg", "google:", ",,"]) {
      expect(calendarOwners(junk)).toEqual({});
    }
  });
});

/* "am I free" — the one first-person calendar question. */
test.describe("cal.free — counts the speaker's own feed plus the shared ones", () => {
  const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const GREGS = { title: "Dentist", start: at(10), source: "google", owner: "Greg" };
  const SHARED = { title: "Footy", start: at(15), source: "apple" };
  const ask = (calendar, speaker) =>
    answer({ id: "cal.free", slots: {} }, speaker ? { calendar, speaker } : { calendar })?.speech;

  test("no speaker counts everything, as it always has", () => {
    expect(ask([GREGS, SHARED])).toBe("You've got 2 things on today.");
  });

  test("Greg counts his own and the shared one", () => {
    expect(ask([GREGS, SHARED], "Greg")).toBe("You've got 2 things on today.");
  });

  test("Brett counts the shared one and never Greg's", () => {
    expect(ask([GREGS, SHARED], "Brett")).toBe("You've got 1 thing on today.");
    expect(ask([GREGS], "Brett")).toBe("You're free — nothing on today.");
  });

  test("with no owners anywhere, a speaker changes nothing", () => {
    const untagged = [{ ...GREGS, owner: undefined }, SHARED];
    expect(ask(untagged, "Brett")).toBe("You've got 2 things on today.");
  });
});

test.describe("conversation memory — a name only when the voice was identified", () => {
  test("Greg's turn reads as Greg; unknown and outsiders stay Person", () => {
    expect(renderTranscript([{ said: "hi", replied: "hello", speaker: "Greg" }])).toBe("Greg: hi\nHouse: hello");
    expect(renderTranscript([{ said: "hi", replied: "hello" }])).toBe("Person: hi\nHouse: hello");
    expect(renderTranscript([{ said: "hi", replied: "hello", speaker: "Mallory" }])).toBe("Person: hi\nHouse: hello");
  });
});

/* The transcript route is the only door identity comes in by (loopback-gated).
   ⚠ It posts on the process-wide voiceBus, so it holds the lock and says
   something no lane can act on. */
test.describe("POST /api/voice/transcript — the speaker rides the kiosk event, vetted", () => {
  async function frameFor(request, data) {
    const http = await import("node:http");
    let posted;
    const frame = await new Promise((resolve) => {
      const req = http.get(`${TEST_ORIGIN}/api/voice/stream`, (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          const hit = buf.split("\n\n").find((f) => f.includes("event: voice_transcript") && f.includes(data.text));
          if (hit) { req.destroy(); resolve(hit); }
        });
      });
      req.on("error", () => resolve("TIMEOUT"));
      setTimeout(() => { req.destroy(); resolve("TIMEOUT"); }, 6000);
      setTimeout(() => { posted = request.post("/api/voice/transcript", { data }); }, 500);
    });
    if (posted) await posted.catch(() => {});
    expect(frame, "no voice_transcript frame reached the kiosk").not.toBe("TIMEOUT");
    return JSON.parse(frame.split("data: ")[1]);
  }

  test("a household name is passed through", async ({ request, voiceBus }) => {
    const payload = await frameFor(request, { text: "zzz speaker probe one", speaker: "Greg" });
    expect(payload).toEqual({ text: "zzz speaker probe one", source: "mic", speaker: "Greg" });
  });

  test("an outsider and an absent speaker both produce the event exactly as before", async ({ request, voiceBus }) => {
    expect(await frameFor(request, { text: "zzz speaker probe two", speaker: "Mallory" }))
      .toEqual({ text: "zzz speaker probe two", source: "mic" });
    expect(await frameFor(request, { text: "zzz speaker probe three" }))
      .toEqual({ text: "zzz speaker probe three", source: "mic" });
  });
});

/* ── The page ───────────────────────────────────────────────────────────────
   ⚠ The voice stream is STUBBED here, not posted to, so this frame reaches
   this page only — never another worker's (reference-voice-bus-cross-test-
   channel). `retry` keeps EventSource from replaying it. */
const MIDDAY = new Date("2026-07-06T12:00:00");

function silentWav(seconds, rate = 8000) {
  const samples = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

/* Every endpoint refreshVoiceCache() awaits in ONE Promise.all
   (src/js/services/voiceSnapshot.js). The calendar only reaches the voice cache
   once ALL of them settle, so "the calendar was served" is not "the page has
   it": the weather legs go to the suite's dead upstream and are the slowest.
   Found 2026-10-23: a pre-push run spoke "ok" (this file's /converse stub)
   because cal.free saw no calendar, returned null and fell through. That was
   under the gate's 10-worker load; the old 300 ms margin held in quiet runs. */
const VOICE_REFRESH = [
  "/api/weather/now", "/api/weather/forecast", "/api/weather/nowcast", "/api/calendar/all",
  "/api/bins", "/api/commute/all", "/api/fuel", "/api/chores", "/api/calendar/holidays"
];

/** Resolves once every voice-refresh request the page has issued has finished. */
function voiceRefreshSettled(page) {
  const inFlight = new Map(VOICE_REFRESH.map((p) => [p, 0]));
  const key = (req) => VOICE_REFRESH.find((p) => new URL(req.url()).pathname === p);
  page.on("request", (req) => { const k = key(req); if (k) inFlight.set(k, inFlight.get(k) + 1); });
  const done = (req) => { const k = key(req); if (k) inFlight.set(k, inFlight.get(k) - 1); };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return async () => {
    const deadline = Date.now() + 15_000;
    while ([...inFlight.values()].some((n) => n > 0) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
  };
}

async function bootWithTurn(page, { flagOn, text, speaker }) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  const refreshSettled = voiceRefreshSettled(page);
  const spoken = [];
  const converse = [];
  let calendarServed;
  const served = new Promise((r) => { calendarServed = r; });

  await page.clock.setFixedTime(MIDDAY);
  await page.addInitScript((on) => {
    let real;
    Object.defineProperty(window, "CONFIG", {
      configurable: true,
      get() { return real; },
      set(value) {
        real = value ?? {};
        // The page fetches its own calendar (store off), so the stub below is
        // what "am I free" reads.
        real.features = { ...(real.features ?? {}), voiceSession: true, v3HouseStoreVoice: false, v3SpeakerId: on };
      }
    });
  }, flagOn);

  const at = (h) => new Date(new Date(MIDDAY).setHours(h, 0, 0, 0)).toISOString();
  await page.route("**/api/calendar/all", async (route) => {
    await route.fulfill({
      json: [
        { title: "Dentist", start: at(10), end: at(11), source: "google", owner: "Greg", allDay: false, location: "" },
        { title: "Footy", start: at(15), end: at(17), source: "apple", allDay: false, location: "" }
      ]
    });
    calendarServed();
  });
  await page.route("**/api/tts/speak", (route) => {
    spoken.push(route.request().postDataJSON()?.text);
    return route.fulfill({ contentType: "audio/wav", body: silentWav(0.2) });
  });
  await page.route("**/api/voice/assist", (route) =>
    route.fulfill({ json: { handled: false, speech: null, conversationId: null } }));
  await page.route("**/api/voice/converse", (route) => {
    const body = route.request().postDataJSON();
    converse.push(body);
    if (!body?.stream) return route.fulfill({ json: { reply: "ok" } });
    return route.fulfill({
      contentType: "text/event-stream",
      body: `event: chunk\ndata: ${JSON.stringify({ text: "ok" })}\n\n`
          + `event: done\ndata: ${JSON.stringify({ reply: "ok", source: "claude" })}\n\n`
    });
  });
  await page.route("**/api/voice/stream", async (route) => {
    await served;                                   // the calendar was requested and served,
    await refreshSettled();                         // and the Promise.all it rides in settled
    await new Promise((r) => setTimeout(r, 300));   // then the page's own apply step
    const payload = speaker ? { text, source: "mic", speaker } : { text, source: "mic" };
    await route.fulfill({
      contentType: "text/event-stream",
      body: `retry: 600000\n\nevent: voice_transcript\ndata: ${JSON.stringify(payload)}\n\n`
    });
  });

  await page.goto("/v3/");
  return { pageErrors, spoken, converse };
}

test.describe("the page — flag on uses the speaker, flag off never reads it", () => {
  test("ON: Brett asking 'am I free' does not count Greg's dentist", async ({ page }) => {
    const { pageErrors, spoken } = await bootWithTurn(page, { flagOn: true, text: "am i free today", speaker: "Brett" });
    await expect.poll(() => spoken.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(spoken[0]).toBe("You've got 1 thing on today.");
    expect(pageErrors).toEqual([]);
  });

  test("OFF: the same turn counts both, exactly as before", async ({ page }) => {
    const { pageErrors, spoken } = await bootWithTurn(page, { flagOn: false, text: "am i free today", speaker: "Brett" });
    await expect.poll(() => spoken.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(spoken[0]).toBe("You've got 2 things on today.");
    expect(pageErrors).toEqual([]);
  });

  test("ON: an identified converse turn carries the speaker to /converse", async ({ page }) => {
    const { pageErrors, converse } = await bootWithTurn(page, { flagOn: true, text: "zzz tell me about pirates", speaker: "Greg" });
    await expect.poll(() => converse.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(converse[0].text).toBe("zzz tell me about pirates");      // the turn under test, not another
    expect(converse[0].speaker).toBe("Greg");
    expect(pageErrors).toEqual([]);
  });

  test("OFF, and ON with no speaker: the converse body has no speaker key", async ({ page, browser }) => {
    const off = await bootWithTurn(page, { flagOn: false, text: "zzz tell me about pirates", speaker: "Greg" });
    await expect.poll(() => off.converse.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(off.converse[0].text).toBe("zzz tell me about pirates");
    expect(off.converse[0]).not.toHaveProperty("speaker");

    const ctx = await browser.newContext({ baseURL: TEST_ORIGIN });
    const page2 = await ctx.newPage();
    try {
      const anon = await bootWithTurn(page2, { flagOn: true, text: "zzz tell me about pirates" });
      await expect.poll(() => anon.converse.length, { timeout: 10_000 }).toBeGreaterThan(0);
      expect(anon.converse[0].text).toBe("zzz tell me about pirates");
      expect(anon.converse[0]).not.toHaveProperty("speaker");
    } finally {
      await ctx.close();
    }
  });
});
