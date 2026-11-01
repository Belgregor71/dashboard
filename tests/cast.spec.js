import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";
import { __resetBags, clipName, drawFrom, exchangeFault, poolFor } from "../server/routes/cast.js";
import { clipFault, wavStats } from "../scripts/cast-generate.mjs";

/* ═══════════════════════════════════════════════════════════════════════════
   THE CAST — Kath and Kim from preloaded clips. Every line here is invented: the
   real script is private, so nothing in this file may quote it.

   The queue runs in node with fetch/Audio faked, the same way house-arbiter.spec
   does, because the mic gate between two clips only exists at a moment the spec
   has to be able to hold open. The door runs on a real V3 page, flag on and off.
   ═══════════════════════════════════════════════════════════════════════════ */

const line = (speaker, text, extra = {}) => ({ speaker, text, ...extra });
const all = () => true;

test.describe("the script's rules", () => {
  const door = (lines, event = "door:doorbell:unknown") => ({ id: "x-1", event, lines });

  test("an unknown door must open plain, whichever door it is", () => {
    const gagFirst = [line("kim", "gag"), line("kath", "fact", { plain: true })];
    expect(exchangeFault(door(gagFirst), all)).toBe("not plain first");
    expect(exchangeFault(door(gagFirst, "door:side_gate:unknown"), all)).toBe("not plain first");
    expect(exchangeFault(door([line("kath", "fact", { plain: true }), line("kim", "gag")]), all)).toBeNull();
  });

  test("the plain rule does not reach lines that need no fact first", () => {
    const gag = [line("kim", "gag")];
    expect(exchangeFault(door(gag, "door:doorbell:known:sam"), all)).toBeNull();
    expect(exchangeFault(door(gag, "bins:eve"), all)).toBeNull();
  });

  test("one missing clip drops the whole exchange, not just the line", () => {
    const lines = [line("kath", "one", { plain: true }), line("kim", "two")];
    const firstOnly = (name) => name === clipName("x-1", 0);
    expect(exchangeFault(door(lines), firstOnly)).toBe("clip missing");
  });

  test("only the two voices that exist can be cast", () => {
    expect(exchangeFault(door([line("sharon", "hi", { plain: true })]), all)).toBe("speaker");
  });

  test("a veto removes a line, but never a floor line", () => {
    const pool = [
      { id: "a", event: "e", lines: [] },
      { id: "b", event: "e", lines: [] },
      { id: "floor", event: "e", floor: true, lines: [] },
      { id: "other", event: "f", lines: [] }
    ];
    const ids = poolFor(pool, "e", new Set(["a", "floor"])).map((x) => x.id);
    expect(ids).toEqual(["b", "floor"]);
  });

  test("every line once before any line twice, and no repeat across the refill", () => {
    __resetBags();
    const pool = ["a", "b", "c", "d"].map((id) => ({ id }));
    const draws = Array.from({ length: 40 }, () => drawFrom(pool, "e").id);
    for (let i = 0; i < 40; i += 4) {
      expect(new Set(draws.slice(i, i + 4)).size).toBe(4);
    }
    for (let i = 1; i < 40; i++) expect(draws[i]).not.toBe(draws[i - 1]);
  });

  test("a vetoed line leaves the bag it is already in", () => {
    __resetBags();
    const pool = ["a", "b", "c"].map((id) => ({ id }));
    drawFrom(pool, "e");
    const left = pool.filter((x) => x.id !== "b");
    for (let i = 0; i < 6; i++) expect(drawFrom(left, "e").id).not.toBe("b");
  });
});

/* A 16-bit mono WAV of a given level. */
function wav(seconds, level, rate = 24000) {
  const samples = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(i % 2 ? level : -level, 44 + i * 2);
  return buf;
}

test.describe("the generator refuses a bad clip", () => {
  const text = "A sentence of a perfectly ordinary length.";

  test("a good clip passes, and its numbers are real", () => {
    const stats = wavStats(wav(2, 3000));
    expect(stats.seconds).toBeCloseTo(2, 2);
    expect(stats.rms).toBeCloseTo(3000, 0);
    expect(clipFault(stats, text)).toBeNull();
  });

  test("silence, a stub, a runaway and a non-wav are each named", () => {
    expect(clipFault(wavStats(wav(2, 10)), text)).toBe("silent");
    expect(clipFault(wavStats(wav(0.1, 3000)), text)).toBe("too short");
    expect(clipFault(wavStats(wav(30, 3000)), text)).toBe("too long");
    expect(clipFault(wavStats(Buffer.from("{\"error\":\"nope\"}".padEnd(60))), text)).toBe("not a wav");
  });
});

/* ── The queue, in node ─────────────────────────────────────────────────── */

const played = [];
const audios = [];
const speaking = [];
let tts;
let arbiter;
let cast;
let reply = null;
const saved = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const audioFor = (name) => audios.filter((a) => a.name === name).at(-1);
const A = "/api/cast/clip/x-0.wav";
const B = "/api/cast/clip/x-1.wav";

test.describe("an exchange holds the room for its whole length", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    saved.window = globalThis.window;
    saved.fetch = globalThis.fetch;
    saved.Audio = globalThis.Audio;
    saved.create = URL.createObjectURL;
    saved.revoke = URL.revokeObjectURL;
    globalThis.window = { CONFIG: { features: { v3Arbiter: true } } };
    globalThis.fetch = (url, opts) => {
      if (url === "/api/cast/pick") return Promise.resolve({ ok: true, json: async () => ({ exchange: reply }) });
      const name = opts?.body ? JSON.parse(opts.body).text : url;
      return Promise.resolve({ ok: true, blob: async () => ({ __name: name }) });
    };
    URL.createObjectURL = (blob) => `blob:${blob.__name}`;
    URL.revokeObjectURL = () => {};
    globalThis.Audio = class {
      constructor(src) { this.name = src.slice(5); audios.push(this); }
      play() { played.push(this.name); return Promise.resolve(); }
      pause() {}
    };
    tts = await import("../src/js/core/tts.js");
    arbiter = await import("../src/js/core/arbiter.js");
    cast = await import("../src/v3/core/cast.js");
    tts.setSpeakingObserver((on) => speaking.push(on));
  });

  test.afterAll(() => {
    tts.setSpeakingObserver(null);
    globalThis.window = saved.window;
    globalThis.fetch = saved.fetch;
    globalThis.Audio = saved.Audio;
    URL.createObjectURL = saved.create;
    URL.revokeObjectURL = saved.revoke;
  });

  test.beforeEach(() => {
    tts.silence();
    arbiter.__resetArbiter();
    played.length = 0;
    audios.length = 0;
    speaking.length = 0;
    reply = { id: "x", clips: [A, B] };
  });

  test("the mic stays gated and the air held between the two speakers", async () => {
    const said = cast.speakCast("e", { author: "doorbell" });
    await wait(10);
    expect(played).toEqual([A]);
    expect(speaking).toEqual([true]);

    audioFor(A).onended();
    await wait(10);
    expect(played).toEqual([A, B]);
    expect(speaking).toEqual([true]);           // never opened between the voices
    expect(arbiter.arbiterState().speech?.author).toBe("doorbell");

    audioFor(B).onended();
    await expect(said).resolves.toBe(true);
    expect(speaking).toEqual([true, false]);
    expect(arbiter.arbiterState().speech).toBeNull();
  });

  test("a barge-in ends the exchange, not just the line in the air", async () => {
    const said = cast.speakCast("e", { author: "moment" });
    await wait(10);
    tts.silence();
    await expect(said).resolves.toBe(true);
    await wait(20);
    expect(played).toEqual([A]);
  });

  test("a moment never cuts the door, and it settles once the door is done", async () => {
    tts.speak("door", { author: "doorbell" });
    await wait(10);
    let settled = false;
    cast.speakCast("e", { author: "moment" }).then(() => { settled = true; });
    await wait(20);
    expect(played).toEqual(["door"]);
    expect(settled).toBe(false);

    audioFor("door").onended();
    await wait(10);
    expect(settled).toBe(true);
    expect(played).toEqual(["door"]);
  });

  test("a moment gives way to an arrival, but the door cuts a moment", async () => {
    expect(arbiter.SPEECH_PRIORITY.moment).toBeLessThan(arbiter.SPEECH_PRIORITY.arrival);
    cast.speakCast("e", { author: "moment" });
    await wait(10);
    tts.speak("door", { author: "doorbell" });
    await wait(20);
    expect(played).toEqual([A, "door"]);
  });

  test("nothing to pick says so, and speaks nothing", async () => {
    reply = null;
    await expect(cast.speakCast("e", { author: "doorbell" })).resolves.toBe(false);
    expect(played).toEqual([]);
  });

  test("a name becomes its own pool, and no name is the unknown one", () => {
    expect(cast.doorEvent("doorbell", null)).toBe("door:doorbell:unknown");
    expect(cast.doorEvent("side_gate", "Mary-Jo")).toBe("door:side_gate:known:maryjo");
  });
});

/* ── The door, on a real page ───────────────────────────────────────────── */

const MIDDAY = new Date("2026-07-06T12:00:00");
const CLIPS = ["/api/cast/clip/door-0.wav", "/api/cast/clip/door-1.wav"];

async function ring(page, { on, pick }) {
  await page.clock.install({ time: MIDDAY });
  const asked = [];
  page.on("request", (req) => {
    const { pathname } = new URL(req.url());
    if (pathname.startsWith("/api/cast/") || pathname === "/api/tts/speak") {
      asked.push(pathname === "/api/cast/pick" ? `pick:${JSON.parse(req.postData()).event}` : pathname);
    }
  });
  const { pageErrors } = await bootV3(page, {
    "/api/cast/pick": pick,
    "/api/cast/clip/": {
      __fulfill: { status: 200, contentType: "audio/wav", body: wav(0.05, 3000) }
    }
  }, { features: { v3CastVoice: on } });
  await page.waitForFunction(() => typeof window.__v3Alert === "function");
  await page.evaluate(() => window.__v3Alert("binary_sensor.doorbell_ringing", "on"));
  return { asked, pageErrors };
}

test("ON: the door plays both clips in order and never reaches the old voice", async ({ page }) => {
  const { asked, pageErrors } = await ring(page, { on: true, pick: { exchange: { id: "door", clips: CLIPS } } });
  await expect.poll(() => asked.filter((x) => x.includes("/clip/"))).toEqual(CLIPS);
  expect(asked[0]).toBe("pick:door:doorbell:unknown");
  expect(asked).not.toContain("/api/tts/speak");
  expect(pageErrors).toEqual([]);
});

test("ON with nothing to play: the door is still announced in the plain line", async ({ page }) => {
  const { asked, pageErrors } = await ring(page, { on: true, pick: { exchange: null } });
  await expect.poll(() => asked).toContain("/api/tts/speak");
  expect(asked[0]).toBe("pick:door:doorbell:unknown");
  expect(pageErrors).toEqual([]);
});

test("ON with the cast route down: the door is still announced", async ({ page }) => {
  const { asked, pageErrors } = await ring(page, { on: true, pick: null });
  await expect.poll(() => asked).toContain("/api/tts/speak");
  expect(pageErrors).toEqual([]);
});

test("OFF: the door never asks the cast anything", async ({ page }) => {
  const { asked, pageErrors } = await ring(page, { on: false, pick: { exchange: { id: "door", clips: CLIPS } } });
  await expect.poll(() => asked).toContain("/api/tts/speak");
  expect(asked.filter((x) => x.includes("cast"))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

/* ── The routes, against the real server ────────────────────────────────── */

test.describe("cast routes contract", () => {
  test("state answers with the switch off", async ({ request }) => {
    const res = await request.get("/api/cast/state");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, exchanges: 0 });
  });

  test("a pick needs an event, and with the switch off finds nothing", async ({ request }) => {
    expect((await request.post("/api/cast/pick", { data: {} })).status()).toBe(400);
    const res = await request.post("/api/cast/pick", { data: { event: "bins:eve" } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ exchange: null });
  });

  test("a clip name cannot climb out of the folder", async ({ request }) => {
    expect((await request.get("/api/cast/clip/..%2F..%2Fserver.js")).status()).toBe(400);
    expect((await request.get("/api/cast/clip/nope.wav")).status()).toBe(404);
  });

  test("a veto with nothing played is a 404", async ({ request }) => {
    expect((await request.post("/api/cast/veto", { data: {} })).status()).toBe(404);
  });
});
