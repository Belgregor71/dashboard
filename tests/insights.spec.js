import { test, expect } from "@playwright/test";
import {
  leaveBy,
  binWeatherClash,
  fuelCycleLow,
  tomorrowRainEarlyStart,
  evaluateInsights,
  pickInsight,
  claimCooldown,
  recordFuelPrice
} from "../src/js/services/insightRules.js";
import { computeFocus } from "../src/js/services/focusEngine.js";
import {
  bomCandidate,
  weatherSevereCandidate,
  nextEventCandidate,
  commuteCandidate,
  collectSources
} from "../src/js/services/candidateSources.js";
import { rankQueue, selectForMode, MODE } from "../src/js/services/attentionRank.js";

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

test.describe("leaveBy", () => {
  // Event 40 min out, 20 min drive → you should leave in 20 min.
  function driveCtx(overrides = {}) {
    const start = new Date(NOW.getTime() + 40 * 60_000);
    return ctxWith({
      nextEventDrive: {
        title:      "Dentist",
        start,
        time:       "8:40 am",
        minutes:    20,
        delayMin:   6,
        leaveBy:    new Date(start.getTime() - 20 * 60_000),
        leaveByStr: "8:20 am",
        ...overrides
      }
    });
  }

  test("fires with a concrete leave-by time and drive length", () => {
    const c = leaveBy(driveCtx(), NOW);
    expect(c).not.toBeNull();
    expect(c.text).toContain("Leave by 8:20 am");
    expect(c.text).toContain("Dentist");
    expect(c.text).toContain("20 min drive");
    expect(c.score).toBeGreaterThanOrEqual(84);
  });

  test("includes the traffic delay when material", () => {
    expect(leaveBy(driveCtx({ delayMin: 6 }), NOW).text).toContain("+6 min in traffic");
  });

  test("omits the traffic chip under the noise threshold", () => {
    expect(leaveBy(driveCtx({ delayMin: 1 }), NOW).text).not.toContain("traffic");
  });

  test("silent when nothing is routed", () => {
    expect(leaveBy(ctxWith(), NOW)).toBeNull();
  });

  test("silent when leaving is still far off or well overdue", () => {
    const start = new Date(NOW.getTime() + 3 * 60 * 60_000);
    const farOff = driveCtx({ start, leaveBy: new Date(start.getTime() - 20 * 60_000) });
    expect(leaveBy(farOff, NOW)).toBeNull(); // leave-by ~2h40 away (> 45 min)

    const overdue = driveCtx({ leaveBy: new Date(NOW.getTime() - 30 * 60_000) });
    expect(leaveBy(overdue, NOW)).toBeNull(); // 30 min overdue (< -5 min)
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
  const dinnerStart = new Date(EVENING.getTime() + 40 * 60_000);
  const busyCtx = ctxWith({
    weather: { rainChancePct: 70 },
    bins: { due: true, eve: true, colours: ["Red"] },
    nextEventDrive: {
      title:      "Dinner",
      start:      dinnerStart,
      time:       "7:10 pm",
      minutes:    20,
      delayMin:   3,
      leaveBy:    new Date(dinnerStart.getTime() - 20 * 60_000),
      leaveByStr: "6:50 pm",
    }
  });

  test("highest score wins; cooldown falls through to next candidate", () => {
    const candidates = evaluateInsights(busyCtx, EVENING);
    expect(candidates.length).toBe(2);
    expect(candidates[0].id).toContain("leave-by"); // 84+ beats bins 60

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
    // A rule that throws (here leaveBy, via a poisoned getter) must be swallowed
    // by evaluateInsights so the other candidates still come through.
    const broken = ctxWith({ bins: { due: true, eve: true, colours: [] }, weather: { rainChancePct: 90 } });
    Object.defineProperty(broken, "nextEventDrive", { get() { throw new Error("boom"); } });
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

// ── Phase 2: attention engine (docs/vision/phase-2-attention-engine.md) ──

test.describe("candidateSources score bands", () => {
  test("bom warning lands in the interrupt band with interrupt:true", () => {
    const c = bomCandidate({ bomWarning: "Marine Wind Warning for Queensland" });
    expect(c.score).toBeGreaterThanOrEqual(90);
    expect(c.interrupt).toBe(true);
    expect(c.text).toContain("Marine Wind Warning");
  });

  test("severe weather is interrupt-band and reads condition · temp", () => {
    const c = weatherSevereCandidate({ weatherCondition: "Severe Thunderstorm", weatherTemp: "24°" });
    expect(c.score).toBeGreaterThanOrEqual(90);
    expect(c.interrupt).toBe(true);
    expect(c.text).toBe("Severe Thunderstorm · 24°");
  });

  test("a benign condition is not a severe-weather candidate", () => {
    expect(weatherSevereCandidate({ weatherCondition: "Clear", weatherTemp: "18°" })).toBeNull();
  });

  test("next-event lands in the medium band", () => {
    const c = nextEventCandidate({ nextEventActive: true, nextEventText: "Standup · 9:00 am" });
    expect(c.score).toBeGreaterThanOrEqual(50);
    expect(c.score).toBeLessThan(70);
  });

  test("commute lands in the low band, below next-event", () => {
    const c = commuteCandidate({ commuteActive: true, commuteText: "Greg 22 min" });
    expect(c.score).toBeGreaterThanOrEqual(40);
    expect(c.score).toBeLessThan(50);
  });

  test("inactive/empty panels yield no candidate", () => {
    expect(commuteCandidate({ commuteActive: false, commuteText: "Greg 22 min" })).toBeNull();
    expect(nextEventCandidate({ nextEventActive: true, nextEventText: "" })).toBeNull();
    expect(collectSources({})).toEqual([]);
  });
});

test.describe("attentionRank: ranking + presence gate", () => {
  const NOW_MS = new Date("2026-07-06T08:00:00").getTime();
  const now = new Date(NOW_MS);

  // A representative queue: interrupt, high, medium, low.
  function queue() {
    return rankQueue(
      [
        commuteCandidate({ commuteActive: true, commuteText: "Greg 22 min" }),          // 42
        bomCandidate({ bomWarning: "Storm warning" }),                                   // 95 interrupt
        { id: "leave-by:x", source: "insight", score: 84, icon: "🚗", text: "Leave by 8:20", cooldownMs: 1000 }, // 84
        nextEventCandidate({ nextEventActive: true, nextEventText: "Standup · 9am" })     // 50
      ],
      now
    );
  }

  test("BOM outranks the leave-by insight, which outranks commute", () => {
    const q = queue();
    expect(q.map((c) => c.source)).toEqual(["bom", "insight", "nextEvent", "commute"]);
  });

  test("expired candidates are dropped", () => {
    const q = rankQueue(
      [
        { id: "stale", score: 88, cooldownMs: 0, expiresAt: NOW_MS - 1 },
        { id: "live", score: 50, cooldownMs: 0, expiresAt: NOW_MS + 60_000 }
      ],
      now
    );
    expect(q.map((c) => c.id)).toEqual(["live"]);
  });

  test("GLANCE shows the top 1; DWELL reveals the top 3", () => {
    const glance = selectForMode(queue(), MODE.GLANCE, { now });
    expect(glance.stack).toHaveLength(1);
    expect(glance.hero.source).toBe("bom");

    const dwell = selectForMode(queue(), MODE.DWELL, { now });
    expect(dwell.stack).toHaveLength(3);
    expect(dwell.stack.map((c) => c.source)).toEqual(["bom", "insight", "nextEvent"]);
  });

  test("AMBIENT shows only interrupt candidates", () => {
    const withInterrupt = selectForMode(queue(), MODE.AMBIENT, { now });
    expect(withInterrupt.hero.source).toBe("bom");

    // No interrupt in the queue → AMBIENT shows nothing.
    const noInterrupt = rankQueue(
      [nextEventCandidate({ nextEventActive: true, nextEventText: "Standup" })],
      now
    );
    expect(selectForMode(noInterrupt, MODE.AMBIENT, { now }).hero).toBeNull();
  });

  test("VOICE hands over the floor (shows nothing)", () => {
    expect(selectForMode(queue(), MODE.VOICE, { now }).hero).toBeNull();
  });

  test("a cooldown skips an insight but never a cooldownMs:0 readout", () => {
    const q = rankQueue(
      [
        { id: "insight:a", score: 84, cooldownMs: 1000, icon: "💡", text: "a" },
        commuteCandidate({ commuteActive: true, commuteText: "Greg 22 min" })
      ],
      now
    );
    const cooldowns = { "insight:a": NOW_MS + 10_000 }; // on cooldown
    const sel = selectForMode(q, MODE.GLANCE, { cooldowns, now });
    expect(sel.hero.source).toBe("commute"); // insight skipped, live readout falls through

    // …unless it is the current hero (exempt from its own cooldown).
    const kept = selectForMode(q, MODE.GLANCE, { cooldowns, now, currentId: "insight:a" });
    expect(kept.hero.id).toBe("insight:a");
  });
});
