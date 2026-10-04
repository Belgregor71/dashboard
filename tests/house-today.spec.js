import { test, expect } from "@playwright/test";
import express from "express";
import { foldObservation, emptyToday, todayClaims, MAX_ENTRIES, __resetHouseToday } from "../server/services/houseToday.js";
import { readSource, storeStatus } from "../server/services/houseStore.js";
import { houseTodayContext } from "../server/services/voiceShape.js";
import { converseSystem } from "../server/routes/voice.js";

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE-MIND S7 — today, answered (docs/design/HOUSE-MIND.md §S7).

   "It worked when": a forced day (a rain-chance crossing, then a condition
   change) produces exactly those entries at the store's read times; no entry
   carries a person, presence or home field; nothing outside today is handed
   over; and with the flag off nothing is folded and the prompt is unchanged.
   ═══════════════════════════════════════════════════════════════════════════ */

// 2026-07-06 in Brisbane (UTC+10, no DST).
const T = (hh, mm = 0) => Date.UTC(2026, 6, 5, 14 + hh, mm);
const weather = (label, pct, extra = {}) => ({ value: { now: { condition: { code: 3, label }, rain_chance_pct: pct, ...extra } } });
const read = (at, label, pct, extra) => ({ ...weather(label, pct, extra), at });
const fold = (reads) => reads.reduce((s, r) => foldObservation(s, "weather", r), emptyToday());

test.describe("foldObservation", () => {
  test("a forced day yields exactly its events, at the store's read times", () => {
    const state = fold([
      read(T(7, 0), "Cloudy", 30),
      read(T(7, 5), "Cloudy", 40),     // nothing changed: no entry
      read(T(7, 10), "Cloudy", 55),    // the rain chance crossed 50%
      read(T(17, 30), "Rain", 80),     // the sky changed
      read(T(19, 0), "Rain", 20)       // and the chance fell back
    ]);
    expect(state.day).toBe("2026-07-06");
    expect(state.since).toBe(T(7, 0));
    expect(state.entries).toEqual([
      { at: T(7, 10), kind: "rain-chance", direction: "up", pct: 55 },
      { at: T(17, 30), kind: "condition", from: "Cloudy", to: "Rain" },
      { at: T(19, 0), kind: "rain-chance", direction: "down", pct: 20 }
    ]);
  });

  test("the first reading is a baseline, not an event", () => {
    const state = fold([read(T(7, 0), "Rain", 90)]);
    expect(state.entries).toEqual([]);
    expect(state.condition).toBe("Rain");
  });

  test("no entry can carry a person, presence or home field", () => {
    const smuggled = { person: "person.greg", present: true, home: ["greg"], who: "Greg" };
    const state = fold([
      read(T(7, 0), "Cloudy", 30, smuggled),
      { ...read(T(8, 0), "Rain", 70, smuggled), ...smuggled }
    ]);
    expect(state.entries).toHaveLength(2);
    for (const e of state.entries) {
      const keys = Object.keys(e).sort();
      expect(keys).toEqual(
        e.kind === "condition" ? ["at", "from", "kind", "to"] : ["at", "direction", "kind", "pct"]
      );
    }
    expect(JSON.stringify(state)).not.toMatch(/greg|person|present|home/i);
  });

  test("the route's fallback payload and other store keys are not a sky", () => {
    const base = fold([read(T(7, 0), "Cloudy", 30)]);
    const unavailable = { at: T(8, 0), value: { now: { condition: { code: null, label: "Unavailable" }, rain_chance_pct: null } } };
    expect(foldObservation(base, "weather", unavailable)).toBe(base);
    expect(foldObservation(base, "nowcast", { at: T(8, 0), value: { nowcast: { startsInMin: 15, mm: 2 } } })).toBe(base);
    expect(foldObservation(base, "calendar", read(T(8, 0), "Rain", 90))).toBe(base);
  });

  test("the day's rollover forgets what happened and keeps what the sky was", () => {
    const state = fold([
      read(T(7, 0), "Cloudy", 30),
      read(T(9, 0), "Rain", 70),
      read(T(24 + 6, 0), "Clear", 10)   // 06:00 the NEXT house day
    ]);
    expect(state.day).toBe("2026-07-07");
    expect(state.since).toBe(T(24 + 6, 0));
    // Yesterday's two entries are gone; the overnight change is today's first.
    expect(state.entries).toEqual([
      { at: T(24 + 6, 0), kind: "condition", from: "Rain", to: "Clear" },
      { at: T(24 + 6, 0), kind: "rain-chance", direction: "down", pct: 10 }
    ]);
  });

  test("bounded: the newest MAX_ENTRIES are kept", () => {
    const reads = [];
    for (let i = 0; i < MAX_ENTRIES + 12; i++) reads.push(read(T(0, i), i % 2 ? "Rain" : "Cloudy", 30));
    const state = fold(reads);
    expect(state.entries).toHaveLength(MAX_ENTRIES);
    expect(state.entries.at(-1).at).toBe(T(0, MAX_ENTRIES + 11));
  });
});

/* ── Wired to the store, behind the flag ─────────────────────────────────── */

test.describe("the store feeds it, and only with the flag on", () => {
  let server; let payload; let savedPort; let savedFlag;
  const SOURCE = { key: "weather", path: "/api/weather/now" };

  test.beforeAll(async () => {
    const app = express();
    app.get("/api/weather/now", (_req, res) => res.json(payload));
    await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  });
  test.afterAll(() => new Promise((resolve) => server.close(resolve)));
  test.beforeEach(() => {
    savedPort = process.env.PORT; savedFlag = process.env.HOUSE_TODAY;
    process.env.PORT = String(server.address().port);
    __resetHouseToday();
  });
  test.afterEach(() => {
    for (const [k, v] of [["PORT", savedPort], ["HOUSE_TODAY", savedFlag]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  const sky = (label, pct) => ({ now: { condition: { code: 3, label }, rain_chance_pct: pct } });
  async function twoReads() {
    payload = sky("Cloudy", 30); await readSource(SOURCE);
    payload = sky("Rain", 80); await readSource(SOURCE);
  }

  test("ON: two store reads become the day's entries, without a subscriber", async () => {
    process.env.HOUSE_TODAY = "1";
    const before = Date.now();
    await twoReads();
    const today = todayClaims();
    expect(today.entries.map((e) => e.kind)).toEqual(["condition", "rain-chance"]);
    expect(today.entries[0]).toMatchObject({ from: "Cloudy", to: "Rain" });
    expect(today.entries[0].at).toBeGreaterThanOrEqual(before);
    // A tap, not a subscription: listening must not start the polling.
    expect(storeStatus()).toMatchObject({ subscribers: 0, polling: false });
    // Nothing outside today is handed over.
    expect(todayClaims(new Date(Date.now() + 36 * 3_600_000))).toBeNull();
  });

  test("OFF: the same reads fold nothing, and turning it on later finds nothing held", async () => {
    delete process.env.HOUSE_TODAY;
    const reads = storeStatus().sources.find((s) => s.key === "weather").reads;
    await twoReads();
    // The reads really happened — this is not an idle store passing.
    expect(storeStatus().sources.find((s) => s.key === "weather").reads).toBe(reads + 2);
    expect(todayClaims()).toBeNull();
    process.env.HOUSE_TODAY = "1";
    expect(todayClaims()).toBeNull();
  });
});

/* ── The prompt ──────────────────────────────────────────────────────────── */

const TODAY = {
  day: "2026-07-06",
  since: T(6, 55),
  entries: [
    { at: T(7, 10), kind: "rain-chance", direction: "up", pct: 55 },
    { at: T(17, 30), kind: "condition", from: "Cloudy", to: "Rain" }
  ]
};

test.describe("houseTodayContext", () => {
  test("states each event with its house-time clock, and the time it started watching", () => {
    const text = houseTodayContext(TODAY);
    expect(text).toContain("watching since about 06:55");
    expect(text).toContain("- about 07:10: today's rain chance went above 50% (55%)");
    expect(text).toContain("- about 17:30: the sky changed from Cloudy to Rain");
    expect(text).toContain("ONLY clock times");
    expect(text).toContain("never volunteer");
  });

  test("an entry of an unknown kind, or with people on it, is not rendered", () => {
    const text = houseTodayContext({
      ...TODAY,
      entries: [{ at: T(7, 18), kind: "left", who: "Greg" }, { at: T(9, 0), kind: "condition", from: "Cloudy", to: "Rain", who: "Greg" }]
    });
    expect(text).not.toMatch(/Greg|07:18|left/);
    expect(text).toContain("- about 09:00: the sky changed from Cloudy to Rain");
  });

  test("a watched day with no change says so; nothing watched is the empty string", () => {
    expect(houseTodayContext({ ...TODAY, entries: [] })).toContain("- nothing has changed since then");
    expect(houseTodayContext(null)).toBe("");
    expect(houseTodayContext({ entries: TODAY.entries })).toBe("");
  });
});

test.describe("converseSystem — today rides the house-state gate", () => {
  let saved;
  test.beforeEach(() => { saved = process.env.VOICE_HOUSE_CONTEXT; });
  test.afterEach(() => {
    if (saved === undefined) delete process.env.VOICE_HOUSE_CONTEXT; else process.env.VOICE_HOUSE_CONTEXT = saved;
  });

  test("handed over: the day's times are in the prompt", () => {
    process.env.VOICE_HOUSE_CONTEXT = "1";
    expect(converseSystem("what's the day been like", [], null, null, null, TODAY)).toContain("about 17:30: the sky changed from Cloudy to Rain");
  });

  test("nothing handed over: the prompt is byte-identical to before S7", () => {
    process.env.VOICE_HOUSE_CONTEXT = "1";
    // todayLine() inside is minute-resolution, so both calls see the same clock.
    expect(converseSystem("hello", [], null, null, null, null)).toBe(converseSystem("hello", [], null, null, null));
    expect(converseSystem("hello", [], null, null, null, null)).not.toContain("noticed about the weather today");
  });

  test("house context off: even a handed-over day does not reach the prompt", () => {
    delete process.env.VOICE_HOUSE_CONTEXT;
    expect(converseSystem("hello", [], null, null, null, TODAY)).not.toContain("17:30");
  });
});
