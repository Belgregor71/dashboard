import { test as coverageTest, expect } from "./fixtures/coverage.js";
import { withVoiceBusLock } from "./fixtures/voice-bus-lock.js";
import { bootV3 } from "./fixtures/v3boot.js";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { INTENT_IDS, ACTING_INTENT_IDS } from "../src/js/services/localIntents.js";
import { readCounts, buildReport } from "../server/routes/censusFeatures.js";

// `voiceBus` serialises the tests that post a barge-in — see the fixture.
const test = withVoiceBusLock(coverageTest);

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE-MIND S6b — the people's counters (docs/design/HOUSE-MIND.md §S6).

   What "it worked" means, from the design's own table:
     · shown with someone present → `present` +1; with the room empty, nothing
     · a question on the same topic inside the window → `followed` +1, once per
       showing; outside the window, or on another topic → nothing
     · a barge-in while the house holds the air → `cut` +1 for that speaker;
       with nobody speaking → nothing
     · counts only, in the census's own ledger; rides `v3PresentationLog`

   Each negative has a trace that the code under test ran (the row is open, the
   intent matched, a later barge-in was counted) — a counter that reads zero
   before anything happened is the starting state, not a result.
   ═══════════════════════════════════════════════════════════════════════════ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "src");
const MIDDAY = new Date("2026-07-06T12:00:00");
const MIN = 60 * 1000;

const ON = { v3PresentationLog: true, v3FeatureCensus: true, v3Arbiter: true };
const ROUTES = {
  "/api/calendar/all": [],
  "/api/presentations": { ok: true },
  "/api/census/features": { ok: true }
};

async function boot(page, features = ON) {
  await page.clock.setFixedTime(MIDDAY);
  const { pageErrors } = await bootV3(page, ROUTES, { features });
  await page.waitForFunction(() =>
    typeof window.__v3Dinner === "function" && typeof window.__v3Transcript === "function" && typeof window.__v3Features === "function");
  await page.evaluate(() => { window.__forceCandidate(null); window.__v3Presence(false); });
  return pageErrors;
}

const ppl = (page) => page.evaluate(() =>
  Object.fromEntries(Object.entries(window.__v3Features().counts).filter(([k]) => k.startsWith("ppl:"))));
const matched = (page, id) => page.evaluate((k) => window.__v3Features().counts[`intent:${k}:matched`] ?? 0, id);
const openSources = (page) => page.evaluate(() => window.__v3().presentations.open.map((r) => `${r.surface}:${r.source}`));

/** Dinner on the stage, raised the way the house raises it (author "dinner"). */
async function dinner(page, { present }) {
  await page.evaluate((p) => window.__v3Presence(p), present);
  const r = await page.evaluate(() => window.__v3Dinner("Fixture Pie"));
  expect(r.shown).toBe(true);
  expect(await openSources(page)).toContain("stage:dinner");
}

/** Start a turn without waiting out the spoken reply; resolve once it matched. */
async function ask(page, text, intentId, times = 1) {
  page.evaluate((t) => { window.__v3Transcript(t); }, text);
  await expect.poll(() => matched(page, intentId), { timeout: 10_000 }).toBe(times);
}

test.describe("present — shown with someone in the room", () => {
  test("someone present: the showing is counted once", async ({ page }) => {
    const pageErrors = await boot(page);
    await dinner(page, { present: true });
    expect(await ppl(page)).toEqual({ "ppl:dinner:present": 1 });
    expect(pageErrors).toEqual([]);
  });

  test("an empty room: the same showing counts nothing", async ({ page }) => {
    const pageErrors = await boot(page);
    await dinner(page, { present: false });
    expect(await ppl(page)).toEqual({});
    expect(pageErrors).toEqual([]);
  });

  test("flag off: nothing is counted, though the census is running", async ({ page }) => {
    const pageErrors = await boot(page, { ...ON, v3PresentationLog: false });
    await page.evaluate(() => window.__v3Presence(true));
    expect((await page.evaluate(() => window.__v3Dinner("Fixture Pie"))).shown).toBe(true);
    await ask(page, "what's for dinner", "show.recipe");
    expect(await page.evaluate(() => window.__v3().people.armed)).toBe(false);
    expect(await ppl(page)).toEqual({});
    expect(pageErrors).toEqual([]);
  });
});

test.describe("followed — a question on the same topic", () => {
  test("asked while it is up: +1, and a second ask of the same showing adds nothing", async ({ page, voiceBus }) => {
    const pageErrors = await boot(page);
    await dinner(page, { present: false });

    await ask(page, "what's for dinner", "show.recipe", 1);
    expect(await ppl(page)).toEqual({ "ppl:dinner:followed": 1 });

    await expect.poll(() => page.evaluate(() => window.__v3Voice().busy), { timeout: 15_000 }).toBe(false);
    await ask(page, "what's for dinner", "show.recipe", 2);
    expect((await ppl(page))["ppl:dinner:followed"]).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  test("another topic follows nothing", async ({ page, voiceBus }) => {
    const pageErrors = await boot(page);
    await dinner(page, { present: false });
    await ask(page, "what time is it", "time.now");
    expect(await ppl(page)).toEqual({});
    expect(pageErrors).toEqual([]);
  });

  for (const [label, minutes, expected] of [["inside", 5, { "ppl:dinner:followed": 1 }], ["outside", 11, {}]]) {
    test(`asked ${minutes} min after it left the glass: ${label} the window`, async ({ page, voiceBus }) => {
      const pageErrors = await boot(page);
      await dinner(page, { present: false });
      // Something else takes the stage, so dinner's row closes at MIDDAY.
      await page.evaluate(() => window.__v3Subject("show.day"));
      expect(await openSources(page)).not.toContain("stage:dinner");

      await page.clock.setFixedTime(new Date(MIDDAY.getTime() + minutes * MIN));
      await ask(page, "what's for dinner", "show.recipe");
      expect(await ppl(page)).toEqual(expected);
      expect(pageErrors).toEqual([]);
    });
  }
});

/* ── cut ─────────────────────────────────────────────────────────────────── */

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

test("cut — a barge-in counts against whoever held the air, and nobody when the air was free", async ({ page, request, voiceBus }) => {
  /* Not bootV3: its catch-all answers /api/voice/stream with a 503, and the
     barge-in arrives on that stream. The real test server instead, as
     v3-voice.spec.js does, with only the writes and the audio stubbed. */
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.addInitScript((f) => {
    let real;
    Object.defineProperty(window, "CONFIG", {
      configurable: true,
      get() { return real; },
      set(value) { real = value ?? {}; real.features = { ...(real.features ?? {}), ...f }; }
    });
  }, { ...ON, voiceSession: true, voiceHalfDuplex: true });
  // Half a minute of reply, so "it stopped" cannot be the clip simply ending.
  await page.route("**/api/tts/speak", (route) => route.fulfill({ contentType: "audio/wav", body: silentWav(30) }));
  await page.route("**/api/voice/speaking", (route) => route.fulfill({ status: 204, body: "" }));
  await page.route("**/api/presentations", (route) => route.fulfill({ status: 201, contentType: "application/json", body: "{\"ok\":true}" }));
  await page.route("**/api/census/features", (route) => route.fulfill({ contentType: "application/json", body: "{\"ok\":true}" }));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3Transcript === "function" && typeof window.__v3Features === "function", null, { timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => window.__v3Voice().streamOpen), { timeout: 10_000 }).toBe(true);

  const speaker = () => page.evaluate(() => window.__v3().arbiter.speech?.author ?? null);
  const bargeIn = async () => expect((await request.post("/api/voice/barge-in", { data: {} })).status()).toBe(200);

  page.evaluate(() => { window.__v3Transcript("what time is it"); });
  await expect.poll(speaker, { timeout: 10_000 }).toBe("voice");
  await bargeIn();
  await expect.poll(() => ppl(page), { timeout: 10_000 }).toEqual({ "ppl:voice:cut": 1 });
  await expect.poll(speaker, { timeout: 10_000 }).toBeNull();

  // Nobody is speaking: this one counts nothing...
  await bargeIn();
  await expect.poll(() => page.evaluate(() => window.__v3Voice().busy), { timeout: 15_000 }).toBe(false);

  // ...and the proof it was processed is the NEXT one, which arrives after it
  // on the same stream and takes the count to exactly 2, not 3.
  page.evaluate(() => { window.__v3Transcript("what time is it"); });
  await expect.poll(speaker, { timeout: 10_000 }).toBe("voice");
  await bargeIn();
  await expect.poll(() => ppl(page), { timeout: 10_000 }).toEqual({ "ppl:voice:cut": 2 });
  expect(pageErrors).toEqual([]);
});

/* ── The topic table, against the source ─────────────────────────────────── */

function topicTable() {
  const text = readFileSync(path.join(SRC, "v3", "core", "people-counters.js"), "utf8");
  const body = text.match(/TOPIC_SOURCES = Object\.freeze\(\{([\s\S]*?)\}\);/)?.[1] ?? "";
  const rows = [...body.matchAll(/"([^"]+)":\s*\[([^\]]*)\]/g)]
    .map((m) => [m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((s) => s[1])]);
  return rows;
}

function sourceLiterals() {
  const found = new Set();
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".js") && ent.name !== "people-counters.js") {
        for (const m of readFileSync(full, "utf8").matchAll(/\b(?:source|author):\s*"([A-Za-z]+)"/g)) found.add(m[1]);
      }
    }
  };
  walk(path.join(SRC, "js"));
  walk(path.join(SRC, "v3"));
  return found;
}

test.describe("the topic table", () => {
  test("every intent is one the matcher can yield, and every source one a row can carry", () => {
    const rows = topicTable();
    expect(rows.length).toBeGreaterThan(10);   // the parse found the table
    const intents = new Set([...INTENT_IDS, ...ACTING_INTENT_IDS]);
    const sources = sourceLiterals();
    expect(sources.has("cameraTrigger")).toBe(true);   // the scan found the literals
    for (const [intent, mapped] of rows) {
      expect(intents.has(intent), `"${intent}" is not an intent id`).toBe(true);
      expect(mapped.length).toBeGreaterThan(0);
      for (const s of mapped) expect(sources.has(s), `"${s}" (for ${intent}) is no source or author literal`).toBe(true);
    }
  });
});

test.describe("the server's half", () => {
  test("only a count is ever stored under a people key", () => {
    expect(readCounts({ "ppl:dinner:followed": 2, "ppl:dinner:at": "12:05", "ppl:dinner:who": { name: "x" } }))
      .toEqual({ "ppl:dinner:followed": 2 });
  });

  test("a quiet people counter is not reported as a silent feature", () => {
    const census = {
      days: {}, roster: [], since: "2026-06-01",
      seen: {
        "ppl:voice:cut": { first: "2026-06-01", last: "2026-06-01", total: 1 },
        "attn:bom:shown": { first: "2026-06-01", last: "2026-06-01", total: 1 }
      }
    };
    const report = buildReport(census, { today: "2026-07-06" });
    expect(report.silent.map((s) => s.key)).toEqual(["attn:bom"]);
  });
});
