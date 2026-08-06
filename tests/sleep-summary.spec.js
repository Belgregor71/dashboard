import { test, expect } from "@playwright/test";

import { sleepSummary, bandFor } from "../src/js/services/sleepSummary.js";
import { buildBriefPayload } from "../src/js/modules/aiBriefing.js";

// Pure unit tests. Entity shapes copied from the live house (2026-08-06).

const TODAY = new Date(2026, 7, 6, 7, 30); // 6 Aug 2026, morning

const entities = (overrides = {}) => ({
  "sensor.cpap_total_myair_score": { state: "97" },
  "sensor.cpap_ahi_events_per_hour": { state: "5.8" },
  "sensor.most_recent_sleep_date": { state: "2026-08-05" }, // last night
  ...overrides
});

test.describe("bandFor — a number nobody can read at 3 metres becomes a word", () => {
  test("maps ResMed's bands", () => {
    expect(bandFor(97)).toBe("Slept well");
    expect(bandFor(85)).toBe("Slept well");
    expect(bandFor(84)).toBe("Slept ok");
    expect(bandFor(70)).toBe("Slept ok");
    expect(bandFor(69)).toBe("Patchy night");
    expect(bandFor(51)).toBe("Patchy night");
    expect(bandFor(50)).toBe("Rough night");
    expect(bandFor(0)).toBe("Rough night");
  });
});

test.describe("sleepSummary", () => {
  test("summarises last night's reading", () => {
    const summary = sleepSummary(entities(), TODAY);
    expect(summary).toMatchObject({ label: "Slept well", score: 97, ahi: 5.8, ageDays: 1 });
  });

  test("accepts a reading dated today", () => {
    expect(sleepSummary(entities({
      "sensor.most_recent_sleep_date": { state: "2026-08-06" }
    }), TODAY)?.ageDays).toBe(0);
  });

  test("REFUSES a stale reading rather than flattering a bad night", () => {
    // A CPAP not worn, or a NAS that didn't sync, leaves the old score sitting
    // there looking current — it would say "slept well" about a night you didn't.
    expect(sleepSummary(entities({
      "sensor.most_recent_sleep_date": { state: "2026-08-04" }
    }), TODAY)).toBeNull();
  });

  test("refuses a future-dated reading — that's a clock fault, not a good sleep", () => {
    expect(sleepSummary(entities({
      "sensor.most_recent_sleep_date": { state: "2026-08-07" }
    }), TODAY)).toBeNull();
  });

  test("unknown/unavailable is absent, never zero", () => {
    // Number("unknown") is NaN; coercing it to 0 would report a "Rough night".
    expect(sleepSummary(entities({
      "sensor.cpap_total_myair_score": { state: "unknown" }
    }), TODAY)).toBeNull();
    expect(sleepSummary(entities({
      "sensor.cpap_total_myair_score": { state: "unavailable" }
    }), TODAY)).toBeNull();
  });

  test("a missing AHI still yields a summary", () => {
    const summary = sleepSummary(entities({
      "sensor.cpap_ahi_events_per_hour": { state: "unknown" }
    }), TODAY);
    expect(summary.label).toBe("Slept well");
    expect(summary.ahi).toBeNull();
  });

  test("rejects an out-of-range score", () => {
    expect(sleepSummary(entities({ "sensor.cpap_total_myair_score": { state: "160" } }), TODAY)).toBeNull();
    expect(sleepSummary(entities({ "sensor.cpap_total_myair_score": { state: "-3" } }), TODAY)).toBeNull();
  });

  test("no CPAP in the house is silent, not a crash", () => {
    expect(sleepSummary({}, TODAY)).toBeNull();
    expect(sleepSummary(undefined, TODAY)).toBeNull();
  });
});

test.describe("PRIVACY GUARD — sleep is health data and must never leave the box", () => {
  // ctx.sleep exists on the shared briefing context, and the AI briefing payload
  // is POSTed to /api/ai/brief which forwards to Anthropic. The payload is built
  // from an explicit named allowlist rather than a ctx spread, which is what makes
  // that safe. This test pins the allowlist: adding a `sleep:` line here fails.
  const ALLOWED_KEYS = ["type", "time", "weather", "events", "bins", "commute", "fuel", "news", "home"];

  const ctx = () => ({
    type: "morning",
    generatedAt: TODAY,
    weather: { lowC: 9, highC: 21 },
    calendar: { today: [], tomorrow: [] },
    bins: null,
    commute: null,
    fuel: null,
    news: [],
    people: [],
    // The sensitive payload, present exactly as the runtime would carry it.
    sleep: { label: "Slept well", score: 97, ahi: 5.8, date: "2026-08-05", ageDays: 1 }
  });

  test("the payload key set is exactly the allowlist", () => {
    expect(Object.keys(buildBriefPayload(ctx())).sort()).toEqual([...ALLOWED_KEYS].sort());
  });

  test("no sleep value appears anywhere in the serialised payload", () => {
    const serialised = JSON.stringify(buildBriefPayload(ctx()));
    for (const leak of ["sleep", "myAir", "AHI", "ahi", "Slept well", "97", "5.8"]) {
      expect(serialised).not.toContain(leak);
    }
  });
});
