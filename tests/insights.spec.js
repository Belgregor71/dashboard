import { test, expect } from "@playwright/test";
import {
  leaveEarly,
  binWeatherClash,
  fuelCycleLow,
  tomorrowRainEarlyStart,
  evaluateInsights,
  pickInsight,
  claimCooldown,
  recordFuelPrice
} from "../src/js/services/insightRules.js";
import { computeFocus } from "../src/js/services/focusEngine.js";

// Pure unit tests — insightRules.js has no imports, no DOM, no storage,
// so these run straight in the Playwright node process.

const NOW = new Date("2026-07-06T08:00:00"); // Monday 8am local
const EVENING = new Date("2026-07-06T18:30:00");

function ctxWith(overrides = {}) {
  return {
    weather: { rainChancePct: 0 },
    tomorrowWeather: null,
    calendar: { today: [], tomorrow: [] },
    bins: null,
    fuel: null,
    commute: null,
    ...overrides
  };
}

function timedEvent(title, when) {
  return {
    title,
    start: when,
    allDay: false,
    time: when.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })
  };
}

test.describe("leaveEarly", () => {
  const soon = new Date(NOW.getTime() + 60 * 60_000); // event in 1h

  test("fires when rain + upcoming event", () => {
    const c = leaveEarly(
      ctxWith({
        weather: { rainChancePct: 70 },
        calendar: { today: [timedEvent("Dentist", soon)], tomorrow: [] }
      }),
      NOW
    );
    expect(c).not.toBeNull();
    expect(c.text).toContain("Dentist");
    expect(c.score).toBeGreaterThanOrEqual(80);
  });

  test("fires on traffic delay and includes the number", () => {
    const c = leaveEarly(
      ctxWith({
        commute: { greg: { mins: 30, delayMin: 14 }, brett: null },
        calendar: { today: [timedEvent("School run", soon)], tomorrow: [] }
      }),
      NOW
    );
    expect(c.text).toContain("14 min");
  });

  test("silent with no rain and normal traffic", () => {
    expect(
      leaveEarly(ctxWith({ calendar: { today: [timedEvent("Dentist", soon)], tomorrow: [] } }), NOW)
    ).toBeNull();
  });

  test("silent when the event is too far out or too close", () => {
    const far = new Date(NOW.getTime() + 3 * 60 * 60_000);
    const imminent = new Date(NOW.getTime() + 10 * 60_000);
    const rainy = (ev) =>
      leaveEarly(
        ctxWith({ weather: { rainChancePct: 90 }, calendar: { today: [ev], tomorrow: [] } }),
        NOW
      );
    expect(rainy(timedEvent("Far", far))).toBeNull();
    expect(rainy(timedEvent("Imminent", imminent))).toBeNull();
  });

  test("silent for all-day events", () => {
    const allDay = { title: "Sports day", start: soon, allDay: true, time: "All day" };
    expect(
      leaveEarly(
        ctxWith({ weather: { rainChancePct: 90 }, calendar: { today: [allDay], tomorrow: [] } }),
        NOW
      )
    ).toBeNull();
  });
});

test.describe("binWeatherClash", () => {
  test("fires on bin eve with rain coming", () => {
    const c = binWeatherClash(
      ctxWith({
        bins: { due: true, eve: true, colours: ["Red", "Yellow"] },
        weather: { rainChancePct: 60 }
      }),
      EVENING
    );
    expect(c).not.toBeNull();
    expect(c.text).toContain("Red + Yellow");
  });

  test("silent on bin morning (eve=false) or dry night", () => {
    expect(
      binWeatherClash(
        ctxWith({ bins: { due: true, eve: false, colours: ["Red"] }, weather: { rainChancePct: 90 } }),
        EVENING
      )
    ).toBeNull();
    expect(
      binWeatherClash(
        ctxWith({ bins: { due: true, eve: true, colours: ["Red"] }, weather: { rainChancePct: 10 } }),
        EVENING
      )
    ).toBeNull();
  });
});

test.describe("fuelCycleLow", () => {
  const cycleHistory = {
    "2026-6-25": 189, "2026-6-26": 185, "2026-6-27": 180, "2026-6-28": 176,
    "2026-6-29": 172, "2026-6-30": 168, "2026-7-1": 165, "2026-7-2": 162
  };

  test("fires at the bottom of a real cycle", () => {
    const c = fuelCycleLow(
      ctxWith({ fuel: { price: 163, name: "United Nudgee", distanceKm: 1.2 } }),
      NOW,
      { fuelHistory: cycleHistory }
    );
    expect(c).not.toBeNull();
    expect(c.text).toContain("163c");
  });

  test("silent mid-cycle, on flat history, and with thin history", () => {
    expect(
      fuelCycleLow(ctxWith({ fuel: { price: 178, name: "X" } }), NOW, { fuelHistory: cycleHistory })
    ).toBeNull();
    expect(
      fuelCycleLow(ctxWith({ fuel: { price: 165, name: "X" } }), NOW, {
        fuelHistory: { "2026-7-1": 166, "2026-7-2": 165, "2026-7-3": 167, "2026-7-4": 166, "2026-7-5": 165, "2026-7-6": 166, "2026-7-7": 167 }
      })
    ).toBeNull();
    expect(
      fuelCycleLow(ctxWith({ fuel: { price: 150, name: "X" } }), NOW, {
        fuelHistory: { "2026-7-5": 180, "2026-7-6": 150 }
      })
    ).toBeNull();
  });
});

test.describe("tomorrowRainEarlyStart", () => {
  const earlyTomorrow = new Date("2026-07-07T08:30:00");

  test("fires in the evening before a wet early start", () => {
    const c = tomorrowRainEarlyStart(
      ctxWith({
        tomorrowWeather: { rainChancePct: 80 },
        calendar: { today: [], tomorrow: [timedEvent("Swimming", earlyTomorrow)] }
      }),
      EVENING
    );
    expect(c).not.toBeNull();
    expect(c.text).toContain("Swimming");
  });

  test("silent during the day and without an early event", () => {
    const wet = ctxWith({
      tomorrowWeather: { rainChancePct: 80 },
      calendar: { today: [], tomorrow: [timedEvent("Swimming", earlyTomorrow)] }
    });
    expect(tomorrowRainEarlyStart(wet, NOW)).toBeNull(); // 8am — not evening
    const lateEvent = timedEvent("Lunch", new Date("2026-07-07T12:00:00"));
    expect(
      tomorrowRainEarlyStart(
        ctxWith({ tomorrowWeather: { rainChancePct: 80 }, calendar: { today: [], tomorrow: [lateEvent] } }),
        EVENING
      )
    ).toBeNull();
  });
});

test.describe("selection & cooldowns", () => {
  const soon = new Date(EVENING.getTime() + 60 * 60_000);
  const busyCtx = ctxWith({
    weather: { rainChancePct: 70 },
    bins: { due: true, eve: true, colours: ["Red"] },
    calendar: { today: [timedEvent("Dinner", soon)], tomorrow: [] }
  });

  test("highest score wins; cooldown falls through to next candidate", () => {
    const candidates = evaluateInsights(busyCtx, EVENING);
    expect(candidates.length).toBe(2);
    expect(candidates[0].id).toContain("leave-early"); // 80+ beats bins 60

    const afterClaim = claimCooldown(candidates[0], { now: EVENING });
    const next = pickInsight(candidates, { cooldowns: afterClaim, now: EVENING });
    expect(next.id).toContain("bin-weather");
  });

  test("the currently-showing insight survives its own cooldown", () => {
    const candidates = evaluateInsights(busyCtx, EVENING);
    const cooldowns = claimCooldown(candidates[0], { now: EVENING });
    const kept = pickInsight(candidates, { cooldowns, now: EVENING, currentId: candidates[0].id });
    expect(kept.id).toBe(candidates[0].id);
  });

  test("a throwing rule never breaks evaluation", () => {
    // calendar.today = null would throw inside leaveEarly without the guard
    const broken = ctxWith({ calendar: null, bins: { due: true, eve: true, colours: [] }, weather: { rainChancePct: 90 } });
    const candidates = evaluateInsights(broken, EVENING);
    expect(candidates.some((c) => c.id.includes("bin-weather"))).toBe(true);
  });

  test("fuel history rolls off entries older than 14 days", () => {
    const history = recordFuelPrice({ "2026-6-1": 180 }, 165, NOW);
    expect(history["2026-6-1"]).toBeUndefined();
    expect(history["2026-7-6"]).toBe(165);
  });
});

test.describe("focus hero tiers", () => {
  const insight = { icon: "⏰", display: "Leave early for the 8:30 school run." };

  test("insight renders when no warning is active", () => {
    const focus = computeFocus({ insight, commuteActive: true, commuteText: "Greg 22 min" });
    expect(focus.text).toBe(insight.display);
    expect(focus.icon).toBe("⏰");
  });

  test("a BOM warning outranks an insight (observed live: marine wind warning)", () => {
    const focus = computeFocus({ bomWarning: "Marine Wind Warning for Queensland", insight });
    expect(focus.text).toContain("Marine Wind Warning");
  });

  test("insight outranks the plain commute readout", () => {
    const focus = computeFocus({ insight, commuteActive: true, commuteText: "Greg 22 min" });
    expect(focus.text).not.toContain("Greg");
  });
});
