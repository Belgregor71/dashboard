import { test, expect } from "@playwright/test";
import {
  deriveIntent,
  settleCategory,
  ACTIVITIES,
  TEMPOS,
  COMPANY,
  NEUTRAL_INTENT
} from "../src/js/services/houseModel.js";
import { rankQueue, selectForMode, MODE } from "../src/js/services/attentionRank.js";
import { bomCandidate, nextEventCandidate, commuteCandidate } from "../src/js/services/candidateSources.js";

// Pure unit tests — houseModel.js has no imports, no DOM, no storage, so these
// run straight in the Playwright node process (insights.spec.js style).
// Phase 6: docs/vision/phase-6-intent.md.

const MIDDAY = new Date("2026-07-06T12:00:00");   // Monday midday
const DINNER = new Date("2026-07-06T18:00:00");   // Monday 6pm
const LATE = new Date("2026-07-06T22:00:00");     // Monday 10pm

function eventInMin(mins, from = MIDDAY) {
  return { start: new Date(from.getTime() + mins * 60_000) };
}

test.describe("deriveIntent — timeBudget", () => {
  test("counts minutes to the soonest future event (leaveBy wins over start)", () => {
    const start = new Date(MIDDAY.getTime() + 60 * 60_000);
    const leaveBy = new Date(MIDDAY.getTime() + 40 * 60_000);
    const out = deriveIntent({ presence: "glance", events: [{ start, leaveBy }], peopleHome: 1, now: MIDDAY });
    expect(out.timeBudget).toBe(40); // acts on leaveBy, not start
  });

  test("ignores past events and is null when nothing is upcoming", () => {
    const past = { start: new Date(MIDDAY.getTime() - 30 * 60_000) };
    expect(deriveIntent({ presence: "glance", events: [past], peopleHome: 1, now: MIDDAY }).timeBudget).toBeNull();
    expect(deriveIntent({ presence: "glance", events: [], peopleHome: 1, now: MIDDAY }).timeBudget).toBeNull();
  });
});

test.describe("deriveIntent — company", () => {
  test("maps the people-home count to alone/together/hosting/unknown", () => {
    const at = (n) => deriveIntent({ presence: "glance", peopleHome: n, now: MIDDAY }).company;
    expect(at(0)).toBe("unknown");
    expect(at(1)).toBe("alone");
    expect(at(2)).toBe("together");
    expect(at(3)).toBe("hosting");
    expect(deriveIntent({ presence: "glance", now: MIDDAY }).company).toBe("unknown"); // undefined count
  });
});

test.describe("deriveIntent — tempo (the dimension the gate reads)", () => {
  test("an imminent event while present is rushed", () => {
    const out = deriveIntent({ presence: "glance", events: [eventInMin(15)], peopleHome: 1, now: MIDDAY });
    expect(out.tempo).toBe("rushed");
    expect(out.activity).toBe("leaving");
    expect(TEMPOS).toContain(out.tempo);
  });

  test("a long steady dwell with nothing pressing is unhurried", () => {
    const out = deriveIntent({ presence: "dwell", events: [eventInMin(120)], peopleHome: 1, now: MIDDAY });
    expect(out.tempo).toBe("unhurried");
  });

  test("a dwell with an imminent event is rushed, not unhurried", () => {
    const out = deriveIntent({ presence: "dwell", events: [eventInMin(20)], peopleHome: 1, now: MIDDAY });
    expect(out.tempo).toBe("rushed");
  });

  test("a plain glance with nothing pressing stays neutral", () => {
    const out = deriveIntent({ presence: "glance", events: [], peopleHome: 1, now: MIDDAY });
    expect(out.tempo).toBe("neutral");
    expect(out.activity).toBe("passing");
  });

  test("hosting is not unhurried even on a long dwell (recede, don't lean in)", () => {
    const out = deriveIntent({ presence: "dwell", events: [], peopleHome: 4, now: MIDDAY });
    expect(out.tempo).toBe("neutral");
    expect(out.activity).toBe("entertaining");
  });
});

test.describe("deriveIntent — activity ladder & graceful degrade", () => {
  test("nobody present → unknown regardless of the clock", () => {
    const out = deriveIntent({ presence: "ambient", events: [eventInMin(10)], peopleHome: 0, now: DINNER });
    expect(out.activity).toBe("unknown");
    expect(out.tempo).toBe("neutral");
  });

  test("dinner hours + present with no appliance signal → cooking", () => {
    const out = deriveIntent({ presence: "glance", events: [], peopleHome: 1, now: DINNER });
    expect(out.activity).toBe("cooking"); // degrades to time+presence, no oven entity assumed
  });

  test("late night while present → winding-down", () => {
    const out = deriveIntent({ presence: "dwell", isNight: true, events: [], peopleHome: 1, now: LATE });
    expect(out.activity).toBe("winding-down");
  });

  test("every emitted value is a declared enum member", () => {
    const cases = [
      { presence: "glance", events: [eventInMin(10)], peopleHome: 1, now: MIDDAY },
      { presence: "dwell", events: [], peopleHome: 4, now: DINNER },
      { presence: "glance", events: [], peopleHome: 1, now: DINNER },
      { presence: "dwell", isNight: true, events: [], peopleHome: 2, now: LATE },
      { presence: "ambient", events: [], peopleHome: 0, now: MIDDAY }
    ];
    for (const c of cases) {
      const out = deriveIntent(c);
      expect(ACTIVITIES).toContain(out.activity);
      expect(TEMPOS).toContain(out.tempo);
      expect(COMPANY).toContain(out.company);
    }
  });
});

test.describe("settleCategory — anti-flap hysteresis", () => {
  const A = { activity: "passing", tempo: "neutral", company: "alone" };
  const B = { activity: "cooking", tempo: "rushed", company: "alone" };
  const SETTLE = 90_000;
  const start = NEUTRAL_INTENT; // { unknown, neutral, ..., unknown }

  test("alternating proposals never commit within the settle window", () => {
    let s = { committed: { activity: "unknown", tempo: "neutral", company: "unknown" }, pending: null };
    let t = 0;
    // A, B, A, B every 20s — a burst of noise inside the 90s window.
    for (const cat of [A, B, A, B]) {
      s = settleCategory(s, cat, (t += 20_000), SETTLE);
      expect(s.changed).toBe(false);
      expect(s.committed.activity).toBe("unknown"); // still resting
    }
  });

  test("a proposal that holds past the window commits exactly once", () => {
    let s = { committed: { activity: "unknown", tempo: "neutral", company: "unknown" }, pending: null };
    s = settleCategory(s, B, 0, SETTLE);          // start the clock
    expect(s.changed).toBe(false);
    s = settleCategory(s, B, 60_000, SETTLE);      // still settling
    expect(s.changed).toBe(false);
    s = settleCategory(s, B, 90_000, SETTLE);      // held long enough → commit
    expect(s.changed).toBe(true);
    expect(s.committed).toEqual(B);
    // A follow-up identical proposal is a no-op, not a second change.
    s = settleCategory(s, B, 150_000, SETTLE);
    expect(s.changed).toBe(false);
  });

  test("returning to the committed value cancels a pending change", () => {
    let s = { committed: A, pending: null };
    s = settleCategory(s, B, 0, SETTLE);     // pending B
    expect(s.pending).not.toBeNull();
    s = settleCategory(s, A, 30_000, SETTLE); // back to A before it settled
    expect(s.pending).toBeNull();
    expect(s.changed).toBe(false);
  });
});

test.describe("selectForMode — intent modulates the presence floor", () => {
  const now = MIDDAY;
  function queue() {
    return rankQueue(
      [
        commuteCandidate({ commuteActive: true, commuteText: "Greg 22 min" }),        // 42, ordinary
        bomCandidate({ bomWarning: "Storm warning" }),                                 // 95 interrupt
        { id: "leave-by:x", source: "insight", score: 84, icon: "🚗", text: "Leave by 8:20", cooldownMs: 1000 },
        nextEventCandidate({ nextEventActive: true, nextEventText: "Standup · 9am" })   // 50
      ],
      now
    );
  }

  test("a rushed room raises the GLANCE floor to interrupt-only", () => {
    const neutral = selectForMode(queue(), MODE.GLANCE, { now });
    expect(neutral.hero.source).toBe("bom"); // top overall; ordinary candidates below it exist

    const rushed = selectForMode(queue(), MODE.GLANCE, { now, intent: { tempo: "rushed" } });
    expect(rushed.stack.every((c) => c.interrupt)).toBe(true);
    expect(rushed.hero.source).toBe("bom");
  });

  test("a rushed room with no interrupt shows nothing (the room is left alone)", () => {
    const ordinary = rankQueue(
      [nextEventCandidate({ nextEventActive: true, nextEventText: "Standup · 9am" })],
      now
    );
    expect(selectForMode(ordinary, MODE.GLANCE, { now }).hero).not.toBeNull(); // neutral would show it
    expect(selectForMode(ordinary, MODE.GLANCE, { now, intent: { tempo: "rushed" } }).hero).toBeNull();
  });

  test("an unhurried room earns DWELL depth while still in GLANCE", () => {
    const glance = selectForMode(queue(), MODE.GLANCE, { now });
    expect(glance.stack).toHaveLength(1);

    const unhurried = selectForMode(queue(), MODE.GLANCE, { now, intent: { tempo: "unhurried" } });
    expect(unhurried.stack).toHaveLength(3);
  });

  test("no intent (flag off) is byte-identical to the pre-Phase-6 gate", () => {
    const withNull = selectForMode(queue(), MODE.GLANCE, { now, intent: null });
    const without = selectForMode(queue(), MODE.GLANCE, { now });
    expect(withNull).toEqual(without);
    expect(without.stack).toHaveLength(1); // plain GLANCE floor unchanged
  });
});
