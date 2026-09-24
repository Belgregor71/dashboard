import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";
import {
  departureCandidate, commuteCandidate, collectSources, DEPARTURE_WINDOW
} from "../src/js/services/candidateSources.js";

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE-MIND S4 — prediction, under the owner's rule "LEARNED TIMING, LIVE
   WORDS" (2026-09-24; docs/design/HOUSE-MIND.md §5, routineRuntime.js).

   The rule this file exists to hold: the learned departure may decide WHEN the
   card appears and must never reach its WORDS. So the central assertion is not
   "the text looks right" — it is that the text and the data line are identical
   wherever in the window the learned time puts us, and contain no clock time,
   no "usually", no "leave by". A card that quoted the learned time would pass
   every other test here and fail that one.
   ═══════════════════════════════════════════════════════════════════════════ */

const LEGS = [
  { label: "Greg", seconds: 1320, delaySeconds: 360 },
  { label: "Brett", seconds: 1080, delaySeconds: 0 }
];
const at = (minutesToGo, extra = {}) => ({ minutesToGo, present: true, rain: null, ...extra });

test.describe("the departure rule — pure", () => {
  test("its words are identical wherever the learned time falls inside the window", () => {
    const seen = new Set();
    for (let toGo = -DEPARTURE_WINDOW.afterMin; toGo <= DEPARTURE_WINDOW.beforeMin; toGo += 1) {
      const c = departureCandidate({ departure: at(toGo), commuteLegs: LEGS });
      expect(c, `minutesToGo ${toGo}`).not.toBeNull();
      seen.add(`${c.text}|${c.sub}`);
      // Nothing learned may be phrased: no clock time, no habit words.
      expect(`${c.text} ${c.sub}`).not.toMatch(/\d{1,2}:\d{2}|usual|normally|leave by|noticed|tend to/i);
    }
    expect([...seen]).toEqual(["Greg 22 min · Brett 18 min|Traffic +6 min"]);
  });

  test("the window: nothing before 45 min out or after 5 min past; interrupt only in the last 30", () => {
    expect(departureCandidate({ departure: at(46), commuteLegs: LEGS })).toBeNull();
    expect(departureCandidate({ departure: at(-6), commuteLegs: LEGS })).toBeNull();
    expect(departureCandidate({ departure: at(45), commuteLegs: LEGS }).interrupt).toBe(false);
    expect(departureCandidate({ departure: at(31), commuteLegs: LEGS }).interrupt).toBe(false);
    expect(departureCandidate({ departure: at(30), commuteLegs: LEGS }).interrupt).toBe(true);
    expect(departureCandidate({ departure: at(-5), commuteLegs: LEGS }).interrupt).toBe(true);
  });

  test("it earns the glance on its score alone (≥ 70)", () => {
    expect(departureCandidate({ departure: at(40), commuteLegs: LEGS }).score).toBeGreaterThanOrEqual(70);
  });

  test("timing alone never speaks: no live drive time, no card", () => {
    expect(departureCandidate({ departure: at(20), commuteLegs: [] })).toBeNull();
    expect(departureCandidate({ departure: at(20), commuteLegs: null })).toBeNull();
    expect(departureCandidate({ departure: at(20), commuteLegs: [{ label: "Greg" }] })).toBeNull();
  });

  test("an empty room, or no learned departure, gets nothing", () => {
    expect(departureCandidate({ departure: at(20, { present: false }), commuteLegs: LEGS })).toBeNull();
    expect(departureCandidate({ departure: null, commuteLegs: LEGS })).toBeNull();
  });

  test("the data line states only what is live: rain it can see, traffic that is there", () => {
    const rain = (startsInMin, probabilityPct) => ({ startsInMin, probabilityPct });
    const quiet = [{ label: "Greg", seconds: 1320, delaySeconds: 0 }];
    const sub = (departure, legs = quiet) => departureCandidate({ departure, commuteLegs: legs }).sub;

    expect(sub(at(20))).toBe("Drive to work");
    expect(sub(at(20, { rain: rain(25, 70) }))).toBe("Rain in 25 min");
    expect(sub(at(20, { rain: rain(0, 90) }))).toBe("Raining now");
    expect(sub(at(20, { rain: rain(25, 30) }))).toBe("Drive to work");      // below 50% is not a claim
    expect(sub(at(20, { rain: rain(25, 70) }), LEGS)).toBe("Rain in 25 min · Traffic +6 min");
    expect(sub(at(20), [{ label: "Greg", seconds: 1320, delaySeconds: 90 }])).toBe("Drive to work"); // <2 min is noise
  });

  test("the plain commute line stands down while the departure card carries the same times — and only then", () => {
    const base = { commuteActive: true, commuteText: "Greg 22 min · Brett 18 min", now: Date.now(), commuteLegs: LEGS };
    expect(commuteCandidate({ ...base, departure: at(20) })).toBeNull();
    expect(commuteCandidate({ ...base, departure: null })?.source).toBe("commute");
    expect(commuteCandidate({ ...base, departure: at(90) })?.source).toBe("commute");
  });

  test("collectSources carries it as its own source, so learned weights apply to it alone", () => {
    const got = collectSources({ departure: at(20), commuteLegs: LEGS, commuteActive: true, commuteText: "x", now: Date.now() });
    expect(got.map((c) => c.source)).toContain("departure");
    expect(got.map((c) => c.source)).not.toContain("commute");
  });
});

/* ── On the V3 glance ──────────────────────────────────────────────────── */

const ROUTINES = { routines: { departure: { weekday: { n: 10, mean: 480, variance: 25 } } } }; // 8:00, std 5 min
const COMMUTE = {
  legs: [
    { label: "Greg", seconds: 1320, trafficDelaySeconds: 360 },
    { label: "Brett", seconds: 1080, trafficDelaySeconds: 0 }
  ]
};

async function glanceAt(page, time, on) {
  await page.clock.install({ time });
  const { pageErrors } = await bootV3(page, { "/api/routines": ROUTINES, "/api/commute/all": COMMUTE },
    { features: { routineLearning: true, v3PredictDeparture: on } });
  await page.waitForFunction(() => window.__routines?.().departureWeekday === 480);
  await page.waitForFunction(() => typeof window.__v3Tick === "function");
  await page.evaluate(() => window.__v3Refresh());   // the commute legs, fetched now
  const got = await page.evaluate(() => {
    window.__v3Presence(true);
    window.__v3Tick();
    return {
      reason: window.__depth().reason,
      said: document.getElementById("glance-said")?.textContent ?? null
    };
  });
  return { ...got, pageErrors };
}

test.describe("v3PredictDeparture — the card reaches the glance, and the flag is the lever", () => {
  // Monday. The learned departure is 8:00.
  test("ON, 7:40: the departure card holds the glance with the live drive times", async ({ page }) => {
    const { reason, said, pageErrors } = await glanceAt(page, new Date("2026-07-06T07:40:00"), true);
    expect(reason).toBe("attention:departure");
    expect(said).toContain("Greg 22 min");
    expect(said).toContain("Brett 18 min");
    expect(said).not.toMatch(/8:00|usual|leave by/i);
    expect(pageErrors).toEqual([]);
  });

  test("ON, 6:30 (90 min out): no departure card — the window is the learned half", async ({ page }) => {
    const { reason, pageErrors } = await glanceAt(page, new Date("2026-07-06T06:30:00"), true);
    expect(reason).not.toBe("attention:departure");
    expect(pageErrors).toEqual([]);
  });

  test("OFF, 7:40: no departure card — exactly the glance that shipped before", async ({ page }) => {
    const { reason, pageErrors } = await glanceAt(page, new Date("2026-07-06T07:40:00"), false);
    expect(reason).not.toBe("attention:departure");
    expect(pageErrors).toEqual([]);
  });
});
