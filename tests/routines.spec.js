import { test, expect } from "@playwright/test";
import {
  emptyRoutines,
  normalize,
  observe,
  confidence,
  predict,
  learnedTime,
  attentionNudge,
  attentionWeights,
  CONF_THRESHOLD
} from "../src/js/services/routineStore.js";
import { deriveIntent } from "../src/js/services/houseModel.js";

// Pure unit tests — routineStore.js has no imports, no DOM, no storage, so these
// run straight in the Playwright node process (intent.spec.js style).
// Phase 8: docs/vision/phase-8-learn.md.

// Fold N wake-ish samples (minutes-of-day) into a fresh weekday distribution.
function seedTime(routine, minutesList, weekend = false) {
  const r = emptyRoutines();
  for (const m of minutesList) observe(r, { type: routine, minutes: m, weekend });
  return r;
}

test.describe("observe — folding into bounded aggregates", () => {
  test("a tight cluster of samples yields a mean near the samples", () => {
    const r = seedTime("wake", [420, 425, 415, 420, 422, 418]); // ~7:00am
    expect(r.wake.weekday.mean).toBeGreaterThan(410);
    expect(r.wake.weekday.mean).toBeLessThan(430);
  });

  test("the confidence counter is capped — the store never grows into a log", () => {
    const r = seedTime("departure", Array.from({ length: 200 }, () => 480));
    expect(r.departure.weekday.n).toBeLessThanOrEqual(10); // SAMPLE_CAP
    // The blob stays a fixed small shape regardless of how many events folded in.
    expect(Object.keys(r.departure.weekday).sort()).toEqual(["mean", "n", "variance"]);
  });

  test("weekday and weekend rhythms are bucketed independently", () => {
    const r = emptyRoutines();
    for (const m of [420, 420, 420, 420, 420]) observe(r, { type: "wake", minutes: m, weekend: false });
    for (const m of [540, 540, 540, 540, 540]) observe(r, { type: "wake", minutes: m, weekend: true });
    expect(Math.round(r.wake.weekday.mean)).toBe(420);
    expect(Math.round(r.wake.weekend.mean)).toBe(540);
  });
});

test.describe("confidence + predict — advisory until sure", () => {
  test("a tight, well-sampled routine becomes confident and predicts its mean", () => {
    const r = seedTime("departure", [480, 482, 478, 481, 479, 480, 480, 481]); // ~8:00am, tight
    expect(confidence(r.departure.weekday)).toBeGreaterThanOrEqual(CONF_THRESHOLD);
    expect(predict(r.departure.weekday)).toBeGreaterThan(470);
    expect(predict(r.departure.weekday)).toBeLessThan(490);
  });

  test("too few samples → null (never acts on a half-learned routine)", () => {
    const r = seedTime("departure", [480, 481]); // only 2 samples
    expect(confidence(r.departure.weekday)).toBe(0);
    expect(predict(r.departure.weekday)).toBeNull();
  });

  test("a scattered routine stays unconfident even with many samples", () => {
    const r = seedTime("departure", [300, 600, 320, 640, 310, 620, 305, 630]); // ±hours of spread
    expect(confidence(r.departure.weekday)).toBeLessThan(CONF_THRESHOLD);
    expect(predict(r.departure.weekday)).toBeNull();
  });

  test("learnedTime picks the right bucket", () => {
    const r = emptyRoutines();
    for (const m of [480, 481, 479, 480, 482, 480]) observe(r, { type: "departure", minutes: m, weekend: false });
    expect(learnedTime(r, "departure", false)).not.toBeNull();
    expect(learnedTime(r, "departure", true)).toBeNull(); // weekend never observed
  });
});

test.describe("attention preference — a small, clamped nudge", () => {
  function seedAttention(source, shownCount, dwellCount) {
    const r = emptyRoutines();
    for (let i = 0; i < shownCount; i++) {
      observe(r, { type: "attention", source, dwelt: i < dwellCount });
    }
    return r;
  }

  test("a source shown often but never dwelt is down-weighted (clamped)", () => {
    const r = seedAttention("news", 10, 0);
    const nudge = attentionNudge(r, "news");
    expect(nudge).toBeLessThan(0);
    expect(nudge).toBeGreaterThanOrEqual(-15); // NUDGE_DOWN clamp
  });

  test("a source dwelt whenever shown is up-weighted (clamped)", () => {
    const r = seedAttention("bom", 10, 10);
    const nudge = attentionNudge(r, "bom");
    expect(nudge).toBeGreaterThan(0);
    expect(nudge).toBeLessThanOrEqual(10); // NUDGE_UP clamp
  });

  test("below the appearance floor there is no nudge (advisory, not noisy)", () => {
    const r = seedAttention("plex", 3, 0); // < MIN_SHOWN
    expect(attentionNudge(r, "plex")).toBe(0);
    expect(attentionWeights(r)).toEqual({});
  });

  test("attentionWeights only lists sources with a non-zero nudge", () => {
    const r = emptyRoutines();
    for (let i = 0; i < 8; i++) observe(r, { type: "attention", source: "news", dwelt: false });
    for (let i = 0; i < 8; i++) observe(r, { type: "attention", source: "bom", dwelt: true });
    const w = attentionWeights(r);
    expect(w.news).toBeLessThan(0);
    expect(w.bom).toBeGreaterThan(0);
  });
});

test.describe("normalize — tolerant cold-start / partial load", () => {
  test("an empty or garbage blob normalizes to the full empty shape", () => {
    for (const bad of [null, undefined, {}, [], "x", 3]) {
      const r = normalize(bad);
      expect(r.wake.weekday).toEqual({ n: 0, mean: 0, variance: 0 });
      expect(r.attention).toEqual({});
    }
  });

  test("a partial blob is preserved and back-filled", () => {
    const partial = { departure: { weekday: { n: 6, mean: 480, variance: 4 } } };
    const r = normalize(partial);
    expect(r.departure.weekday.mean).toBe(480);
    expect(r.departure.weekend).toEqual({ n: 0, mean: 0, variance: 0 }); // filled
    expect(r.wake.weekday).toEqual({ n: 0, mean: 0, variance: 0 });
  });
});

test.describe("houseModel feed — learned departure sharpens the budget", () => {
  const MORNING = new Date("2026-07-06T07:30:00"); // Monday 7:30am, 450 min-of-day

  test("a confident learned departure fills timeBudget when the calendar is silent", () => {
    const out = deriveIntent({ presence: "glance", events: [], peopleHome: 1, learnedDeparture: 480, now: MORNING });
    expect(out.timeBudget).toBe(30); // 8:00am is 30 min away → rushed prior
    expect(out.tempo).toBe("rushed");
  });

  test("a hard calendar event always wins over the learned prior", () => {
    const soon = { start: new Date(MORNING.getTime() + 10 * 60_000) };
    const out = deriveIntent({ presence: "glance", events: [soon], peopleHome: 1, learnedDeparture: 480, now: MORNING });
    expect(out.timeBudget).toBe(10); // calendar (10 min) wins, not the learned 30
  });

  test("null learned departure (below threshold / flag off) → unchanged", () => {
    const withNull = deriveIntent({ presence: "glance", events: [], peopleHome: 1, learnedDeparture: null, now: MORNING });
    const without = deriveIntent({ presence: "glance", events: [], peopleHome: 1, now: MORNING });
    expect(withNull).toEqual(without);
    expect(without.timeBudget).toBeNull();
  });

  test("a learned departure already past / beyond the horizon does not apply", () => {
    const past = deriveIntent({ presence: "glance", events: [], peopleHome: 1, learnedDeparture: 400, now: MORNING });
    expect(past.timeBudget).toBeNull(); // 6:40am is behind us
  });
});
