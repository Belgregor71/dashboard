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
  cameraTriggerCandidate,
  cameraSnapshotUrl,
  CAMERA_TRIGGER_FRESH_MS,
  CAMERA_IMAGE_SETTLE_MS,
  collectSources
} from "../src/js/services/candidateSources.js";
import { rankQueue, selectForMode, MODE } from "../src/js/services/attentionRank.js";
import {
  rainIncoming,
  binNight,
  onThisDay,
  evaluatePredictive
} from "../src/js/services/predictiveRules.js";
import { atmosphereFor, ATMOSPHERE_TOKENS, CONDITION_TOKENS, LIGHT_TOKENS, skyWarmthFor, SKY_WARMTH_ALT_HIGH, SKY_WARMTH_ALT_LOW } from "../src/js/services/atmosphere.js";
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

  test("camera trigger is a stack-only low-band candidate that decays via expiresAt", () => {
    const at = new Date("2026-07-16T15:42:00").getTime();
    const c = cameraTriggerCandidate({ cameraTriggerName: "Driveway", cameraTriggerAt: at, cameraTriggerLabel: "Last triggered 3:42pm" });
    expect(c.source).toBe("cameraTrigger");
    expect(c.stackOnly).toBe(true); // never the centred hero
    expect(c.score).toBe(45); // low band, above commute (42)
    expect(c.text).toBe("Driveway · Last triggered 3:42pm");
    expect(c.title).toBe("Driveway");
    expect(c.expiresAt).toBe(at + CAMERA_TRIGGER_FRESH_MS); // rankQueue drops it once stale
  });

  test("camera trigger with no recent event yields no candidate", () => {
    expect(cameraTriggerCandidate({})).toBeNull();
    expect(cameraTriggerCandidate({ cameraTriggerName: "Driveway" })).toBeNull(); // no timestamp
  });

  test("camera trigger carries the snapshot through to the card thumbnail", () => {
    const at = new Date("2026-07-19T15:42:00").getTime();
    const c = cameraTriggerCandidate({
      cameraTriggerName: "Driveway",
      cameraTriggerAt: at,
      cameraTriggerImage: "/api/camera/driveway/snapshot?ts=1"
    });
    expect(c.image).toBe("/api/camera/driveway/snapshot?ts=1");
    // No id → no URL → the card falls back to the 📹 glyph rather than a broken img.
    expect(cameraTriggerCandidate({ cameraTriggerName: "Driveway", cameraTriggerAt: at }).image).toBeNull();
  });

  test("snapshot url re-busts while the event image is still settling, then freezes", () => {
    const at = new Date("2026-07-19T15:42:00").getTime();
    const url = (now) => cameraSnapshotUrl({ cameraId: "driveway", at, now });

    // Battery cameras upload 1min+ after the trigger, so a URL pinned at t=0 would
    // serve the PREVIOUS event's frame for the card's whole life. Inside the settle
    // window the bucket advances, so the thumbnail converges onto the real frame.
    const early = url(at + 1000);
    const later = url(at + 40 * 1000);
    expect(early).not.toBe(later);
    expect(early).toContain("/api/camera/driveway/snapshot?ts=");

    // Same bucket → same URL, so a 30s re-render inside one bucket adds no churn.
    expect(url(at + 1000)).toBe(url(at + 2000));

    // Past the settle window it pins to the trigger stamp and stops re-fetching.
    expect(url(at + CAMERA_IMAGE_SETTLE_MS + 60_000)).toBe(`/api/camera/driveway/snapshot?ts=${at}`);
    expect(url(at + 10 * 60 * 1000)).toBe(`/api/camera/driveway/snapshot?ts=${at}`);

    expect(cameraSnapshotUrl({ at })).toBeNull();
    expect(cameraSnapshotUrl({ cameraId: "driveway" })).toBeNull();
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

  test("nightClear opt-in: clear nights earn the starfield token, others stay night", () => {
    // Phase 3 nightSky — opt-in only, so flag-off callers keep atmo-night.
    expect(atmosphereFor({ condition: "clear", isNight: true, nightClear: true })).toBe("atmo-night-clear");
    expect(atmosphereFor({ condition: "cloudy", isNight: true, nightClear: true })).toBe("atmo-night");
    expect(atmosphereFor({ condition: "rain", isNight: true, nightClear: true })).toBe("atmo-night");
    expect(atmosphereFor({ condition: "clear", isNight: true })).toBe("atmo-night");
    expect(atmosphereFor({ condition: "clear", isNight: true, nightClear: false })).toBe("atmo-night");
  });

  test("skyWarmthFor: peaks at the horizon, gone at high sun and deep night", () => {
    expect(skyWarmthFor(0)).toBe(1);
    expect(skyWarmthFor(SKY_WARMTH_ALT_HIGH)).toBe(0);
    expect(skyWarmthFor(SKY_WARMTH_ALT_LOW)).toBe(0);
    expect(skyWarmthFor(45)).toBe(0);
    expect(skyWarmthFor(-30)).toBe(0);
    // Monotonic on each side of the peak.
    expect(skyWarmthFor(3)).toBeGreaterThan(skyWarmthFor(9));
    expect(skyWarmthFor(-2)).toBeGreaterThan(skyWarmthFor(-5));
    // Bounded and sane on garbage.
    expect(skyWarmthFor(NaN)).toBe(0);
    expect(skyWarmthFor(undefined)).toBe(0);
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

  // The guardrail, rewritten 2026-08-01 for law 1 (DESIGN_SYSTEM.md §0.1, §5.6).
  //
  // It used to assert that NO atmo-* selector may animate — the "0% GPU at rest"
  // law. That law is repealed: motion may now be continuous and may live on the
  // resting ambient surface. What survives is the reason the rule existed, which
  // was never stillness but attributability, so the assertion changes shape
  // rather than disappearing: an animation on an atmosphere selector is legal
  // ONLY if it is bound to a cause the room can see.
  //
  // The mapper is the authority for which tokens are causes. A weather condition
  // is one — you can look out the window and see the rain the surface reports.
  // The sky's light level is not: it is computed from the clock hour, and §5.1
  // rules that the passage of time is not a cause. So a rule selecting only
  // LIGHT_TOKENS may not animate, and that is where an accidental decorative
  // loop still gets caught.
  test("an animated atmosphere rule is bound to a live weather condition", () => {
    const cssPath = fileURLToPath(new URL("../src/css/views/screensaver.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

    for (const token of ATMOSPHERE_TOKENS) {
      expect(css, `${token} should be styled`).toContain(`.${token}`);
    }
    // The split must stay exhaustive, or a new token could dodge the check.
    expect([...CONDITION_TOKENS, ...LIGHT_TOKENS].sort()).toEqual([...ATMOSPHERE_TOKENS].sort());

    const atmoRules = css.match(/\.atmo-[^{}]*\{[^}]*\}/g) || [];
    for (const rule of atmoRules) {
      const [selector] = rule.split("{");
      if (!/animation(-name)?\s*:/.test(rule)) continue;
      const boundToCondition = CONDITION_TOKENS.some((t) => selector.includes(`.${t}`));
      expect(
        boundToCondition,
        `an animated atmosphere rule must be bound to a live condition (${CONDITION_TOKENS.join(", ")}), ` +
          `not to the sky's light level — the clock advancing is not a cause. Offending selector: ${selector.trim()}`
      ).toBe(true);
    }
  });

  // The other half of law 1: motion that IS bound to a cause must also end when
  // the cause does. A condition-bound loop is fine (rain falls for an hour, rain
  // may render for an hour) precisely because the mapper removes the token the
  // moment the rain stops — so the loop may only ever hang off the token, never
  // off a plain element that outlives it.
  test("no looping animation is declared outside a condition-bound selector", () => {
    const cssPath = fileURLToPath(new URL("../src/css/views/screensaver.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = css.match(/[^{}]+\{[^}]*\}/g) || [];
    for (const rule of rules) {
      if (!/\binfinite\b/.test(rule)) continue;
      const [selector] = rule.split("{");
      expect(
        CONDITION_TOKENS.some((t) => selector.includes(`.${t}`)),
        `an infinite animation must hang off a condition token so it ends when the weather does. ` +
          `Offending selector: ${selector.trim()}`
      ).toBe(true);
    }
  });
});
