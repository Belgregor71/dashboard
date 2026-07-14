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
  nowPlayingCandidate,
  plexCandidate,
  tonightsMenuCandidate,
  collectSources
} from "../src/js/services/candidateSources.js";
import { rankQueue, selectForMode, MODE } from "../src/js/services/attentionRank.js";
import {
  rainIncoming,
  binNight,
  onThisDay,
  evaluatePredictive
} from "../src/js/services/predictiveRules.js";
import { atmosphereFor, ATMOSPHERE_TOKENS } from "../src/js/services/atmosphere.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

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

  test("now-playing is the lowest low-band candidate, below commute", () => {
    const c = nowPlayingCandidate({ nowPlayingActive: true, nowPlayingText: "Lounge — The Parent Trap" });
    expect(c.source).toBe("nowPlaying");
    expect(c.score).toBeGreaterThanOrEqual(40);
    expect(c.score).toBeLessThan(42); // below commute (42)
    expect(c.interrupt).toBeFalsy();
    expect(c.text).toContain("The Parent Trap");
  });

  test("now-playing carries its artwork; plex is a peer low-band candidate", () => {
    const np = nowPlayingCandidate({ nowPlayingActive: true, nowPlayingText: "Lounge — Film", nowPlayingImage: "/art/x.jpg" });
    expect(np.image).toBe("/art/x.jpg");
    const px = plexCandidate({ plexActive: true, plexText: "The Bear: Ep 3", plexImage: "/api/plex/image?path=/y" });
    expect(px.source).toBe("plex");
    expect(px.image).toBe("/api/plex/image?path=/y");
    expect(px.score).toBe(41);
    expect(plexCandidate({ plexActive: false, plexText: "x" })).toBeNull();
  });

  test("tonight's menu is the quietest low-band candidate, below now-playing", () => {
    const c = tonightsMenuCandidate({ menuActive: true, menuName: "Steak Sandwich" });
    expect(c.source).toBe("tonightsMenu");
    expect(c.score).toBeGreaterThanOrEqual(40);
    expect(c.score).toBeLessThan(41); // below now-playing (41)
    expect(c.text).toContain("Steak Sandwich");
  });

  test("inactive/empty panels yield no candidate", () => {
    expect(commuteCandidate({ commuteActive: false, commuteText: "Greg 22 min" })).toBeNull();
    expect(nextEventCandidate({ nextEventActive: true, nextEventText: "" })).toBeNull();
    expect(nowPlayingCandidate({ nowPlayingActive: false, nowPlayingText: "x" })).toBeNull();
    expect(tonightsMenuCandidate({ menuActive: true, menuName: "" })).toBeNull();
    expect(collectSources({})).toEqual([]);
  });
});

// ── Phase 3: predictive candidates (docs/vision/phase-3-anticipate.md) ──

test.describe("rainIncoming", () => {
  test("fires in-band and scales with confidence", () => {
    const hi = rainIncoming(ctxWith({ nowcast: { startsInMin: 15, probabilityPct: 90, mm: 0.6 } }), NOW);
    const lo = rainIncoming(ctxWith({ nowcast: { startsInMin: 15, probabilityPct: 60, mm: 0.6 } }), NOW);
    expect(hi).not.toBeNull();
    expect(hi.score).toBe(78); // 55 + round(90*0.25)
    expect(lo.score).toBe(70); // 55 + round(60*0.25)
    expect(hi.score).toBeGreaterThan(lo.score);
    expect(hi.text).toContain("15 min");
  });

  test("sets expiresAt at the start of the rain window (decay handle)", () => {
    const c = rainIncoming(ctxWith({ nowcast: { startsInMin: 20, probabilityPct: 80, mm: 0.4 } }), NOW);
    expect(c.expiresAt).toBe(NOW.getTime() + 20 * 60_000);
  });

  test("damped out below the probability floor, and when no nowcast", () => {
    expect(rainIncoming(ctxWith({ nowcast: { startsInMin: 15, probabilityPct: 40, mm: 0.6 } }), NOW)).toBeNull();
    expect(rainIncoming(ctxWith({ nowcast: null }), NOW)).toBeNull();
    expect(rainIncoming(ctxWith(), NOW)).toBeNull();
  });

  test("calls out bins when they're still out", () => {
    const c = rainIncoming(
      ctxWith({ nowcast: { startsInMin: 12, probabilityPct: 70, mm: 0.8 }, bins: { eve: true, colours: ["Red"] } }),
      NOW
    );
    expect(c.text).toContain("bins are still out");
  });

  test("a decayed rain candidate drops out of the ranked queue", () => {
    const c = rainIncoming(ctxWith({ nowcast: { startsInMin: 10, probabilityPct: 80, mm: 0.5 } }), NOW);
    const afterOnset = new Date(c.expiresAt + 60_000);
    expect(rankQueue([c], afterOnset).map((x) => x.id)).toEqual([]);
    expect(rankQueue([c], NOW).map((x) => x.id)).toEqual([c.id]);
  });
});

test.describe("binNight", () => {
  test("fires on a dry bin eve and decays end of day", () => {
    const c = binNight(ctxWith({ bins: { eve: true, colours: ["Red", "Yellow"] }, weather: { rainChancePct: 10 } }), EVENING);
    expect(c).not.toBeNull();
    expect(c.score).toBe(50);
    expect(c.text).toContain("Red + Yellow");
    expect(c.expiresAt).toBeGreaterThan(EVENING.getTime());
  });

  test("stands down when rain is coming (binWeatherClash owns it) or no bin eve", () => {
    expect(binNight(ctxWith({ bins: { eve: true, colours: ["Red"] }, weather: { rainChancePct: 70 } }), EVENING)).toBeNull();
    expect(binNight(ctxWith({ bins: { eve: false, colours: ["Red"] } }), EVENING)).toBeNull();
  });
});

test.describe("onThisDay", () => {
  test("fires low-band on a matching anniversary and yields to any Medium+", () => {
    const c = onThisDay(ctxWith({ anniversaries: [{ title: "Mum & Dad's Anniversary" }] }), NOW);
    expect(c).not.toBeNull();
    expect(c.score).toBeGreaterThanOrEqual(40);
    expect(c.score).toBeLessThan(50);
    expect(c.text).toContain("Mum & Dad's Anniversary");
    // Loses the hero to a bin-night (Medium 50).
    const q = rankQueue([c, binNight(ctxWith({ bins: { eve: true, colours: [] }, weather: { rainChancePct: 0 } }), NOW)], NOW);
    expect(q[0].id).toContain("bin-night");
  });

  test("silent with no anniversaries", () => {
    expect(onThisDay(ctxWith({ anniversaries: [] }), NOW)).toBeNull();
    expect(onThisDay(ctxWith(), NOW)).toBeNull();
  });
});

test.describe("evaluatePredictive", () => {
  test("returns in-band candidates sorted best-first", () => {
    const ctx = ctxWith({
      nowcast: { startsInMin: 15, probabilityPct: 90, mm: 0.6 }, // rain 78
      bins: { eve: true, colours: ["Red"] },                     // bin-night 50 (dry)
      weather: { rainChancePct: 0 },
      anniversaries: [{ title: "Anniversary" }]                  // on-this-day 42
    });
    const out = evaluatePredictive(ctx, NOW);
    expect(out[0].id).toContain("rain-incoming");
    expect(out.map((c) => c.score)).toEqual([78, 50, 42]);
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

  test("stackOnly candidates never take the hero, but still ride the DWELL stack", () => {
    const nowP = rankQueue(
      [{ id: "np", source: "nowPlaying", score: 41, stackOnly: true, text: "x", cooldownMs: 0 }],
      now
    );
    // The only candidate is stack-only → GLANCE has no hero (concierge fills it).
    const glance = selectForMode(nowP, MODE.GLANCE, { now });
    expect(glance.hero).toBeNull();
    // DWELL surfaces it in the stack (as a card), still never as the hero.
    const dwell = selectForMode(nowP, MODE.DWELL, { now });
    expect(dwell.hero).toBeNull();
    expect(dwell.stack.map((c) => c.id)).toEqual(["np"]);

    // With a real candidate present, the hero skips the stack-only one but the
    // stack still includes it.
    const mixed = rankQueue(
      [
        commuteCandidate({ commuteActive: true, commuteText: "Greg 22 min" }), // 42, hero-eligible
        { id: "np", source: "nowPlaying", score: 41, stackOnly: true, text: "x", cooldownMs: 0 }
      ],
      now
    );
    const sel = selectForMode(mixed, MODE.DWELL, { now });
    expect(sel.hero.source).toBe("commute");
    expect(sel.stack.map((c) => c.source)).toEqual(["commute", "nowPlaying"]);
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

test.describe("atmosphere mapper (Phase 5)", () => {
  test("night beats every weather condition", () => {
    for (const condition of ["clear", "cloudy", "rain", "storm", "fog", undefined]) {
      expect(atmosphereFor({ condition, isNight: true, hour: 3 })).toBe("atmo-night");
    }
  });

  test("each daytime condition maps to its token", () => {
    expect(atmosphereFor({ condition: "rain", isNight: false, hour: 12 })).toBe("atmo-rain");
    expect(atmosphereFor({ condition: "storm", isNight: false, hour: 12 })).toBe("atmo-storm");
    expect(atmosphereFor({ condition: "cloudy", isNight: false, hour: 12 })).toBe("atmo-cloudy");
    expect(atmosphereFor({ condition: "fog", isNight: false, hour: 12 })).toBe("atmo-fog");
  });

  test("clear sky goes golden near dawn/dusk, neutral midday", () => {
    expect(atmosphereFor({ condition: "clear", isNight: false, hour: 7 })).toBe("atmo-clear-golden");
    expect(atmosphereFor({ condition: "clear", isNight: false, hour: 18 })).toBe("atmo-clear-golden");
    expect(atmosphereFor({ condition: "clear", isNight: false, hour: 12 })).toBe("atmo-clear-day");
  });

  test("unknown/missing condition rests on the calm daytime tint", () => {
    expect(atmosphereFor({ condition: undefined, isNight: false, hour: 12 })).toBe("atmo-clear-day");
    expect(atmosphereFor({ condition: "snow", isNight: false, hour: 12 })).toBe("atmo-clear-day");
    expect(atmosphereFor({})).toBe("atmo-clear-day");
  });

  test("every emitted token is a declared token", () => {
    const cases = [
      { isNight: true, hour: 2 },
      { condition: "clear", isNight: false, hour: 6 },
      { condition: "clear", isNight: false, hour: 13 },
      { condition: "rain", isNight: false, hour: 10 },
      { condition: "storm", isNight: false, hour: 15 },
      { condition: "cloudy", isNight: false, hour: 9 },
      { condition: "fog", isNight: false, hour: 8 }
    ];
    for (const c of cases) expect(ATMOSPHERE_TOKENS).toContain(atmosphereFor(c));
  });

  // The phase-critical guardrail (project-gpu-idle-freeze): no atmosphere token
  // may map to a looping animation, or Mode 0 re-composites the whole page at
  // ~1 GPU core forever. Assert the CSS gives each token a resting tint only —
  // no `animation` on an atmo-* selector, no atmo-* @keyframes.
  test("no atmosphere token maps to a looping-animation class", () => {
    const cssPath = fileURLToPath(new URL("../src/css/views/screensaver.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");
    for (const token of ATMOSPHERE_TOKENS) {
      expect(css, `${token} should be styled`).toContain(`.${token}`);
      expect(css, `${token} must not @keyframes`).not.toMatch(new RegExp(`@keyframes\s+${token}\b`));
    }
    // No rule that selects an atmo-* class may declare an animation.
    const atmoRules = css.match(/\.atmo-[^{}]*\{[^}]*\}/g) || [];
    for (const rule of atmoRules) {
      expect(rule, `atmo rule must not animate: ${rule}`).not.toMatch(/animation(-name)?\s*:/);
    }
  });
});
