import { test, expect } from "@playwright/test";
import {
  commuteCandidate,
  tonightsMenuCandidate,
  collectSources,
  cameraTriggerCandidate
} from "../src/js/services/candidateSources.js";

/* TIMELY CANDIDATES — the drive to work and tonight's dinner are permanently
   true and only sometimes worth the screen. These specs pin the windows and,
   more importantly, the two things that make the feature actually work:

     · the flag must leave every score untouched when off (it is the rollback);
     · the menu must lose `stackOnly` in its window, because attentionRank picks
       the hero with `find(c => !c.stackOnly)` and a stackOnly candidate can
       never be the centred hero at ANY score.

   Pure functions with an injected clock, so no spec here waits for 7am. */

const COMMUTE = { commuteActive: true, commuteText: "11 min · 16 min" };
const MENU = { menuActive: true, menuName: "BBQ Pulled Pork Sliders" };

/** A local-time Date. 2026-08-11 is a Tuesday; 2026-08-15 is a Saturday. */
const at = (iso) => new Date(iso);

test("commute: 72 inside the weekday morning window", () => {
  const c = commuteCandidate({ ...COMMUTE, now: at("2026-08-11T07:00:00"), timely: true });
  expect(c.score).toBe(72);
  // 70 is the bar. A score that merely rose to 60 would look right in a diff
  // and still never reach the wall, so assert the side of the line it lands on.
  expect(c.score).toBeGreaterThanOrEqual(70);
});

test("commute: the window is half-open — 06:30 is in, 08:00 is already out", () => {
  const open = commuteCandidate({ ...COMMUTE, now: at("2026-08-11T06:30:00"), timely: true });
  const shut = commuteCandidate({ ...COMMUTE, now: at("2026-08-11T08:00:00"), timely: true });
  const before = commuteCandidate({ ...COMMUTE, now: at("2026-08-11T06:29:00"), timely: true });

  expect(open.score).toBe(72);
  expect(shut.score).toBe(42);
  expect(before.score).toBe(42);
});

test("commute: a Saturday morning is not a commute", () => {
  // Same clock time, weekend. The whole point of the window is that it knows
  // which day it is — a time-only check would fire here and be wrong.
  const sat = commuteCandidate({ ...COMMUTE, now: at("2026-08-15T07:00:00"), timely: true });
  expect(sat.score).toBe(42);
});

test("commute: flag off leaves the old flat score, mid-window", () => {
  const off = commuteCandidate({ ...COMMUTE, now: at("2026-08-11T07:00:00"), timely: false });
  expect(off.score).toBe(42);
});

test("menu: in its window it scores 72 AND stops being stack-only", () => {
  const c = tonightsMenuCandidate({ ...MENU, now: at("2026-08-11T17:30:00"), timely: true });

  expect(c.score).toBe(72);
  /* The load-bearing half. With stackOnly still true this candidate cannot be
     the hero however high it scores, and the feature would look shipped while
     changing nothing on the glass. */
  expect(c.stackOnly).toBe(false);
});

test("menu: outside the window it is the quiet stack card it always was", () => {
  const early = tonightsMenuCandidate({ ...MENU, now: at("2026-08-11T16:59:00"), timely: true });
  const late = tonightsMenuCandidate({ ...MENU, now: at("2026-08-11T18:30:00"), timely: true });

  for (const c of [early, late]) {
    expect(c.score).toBe(40);
    expect(c.stackOnly).toBe(true);
  }
});

test("menu: dinner happens at the weekend too", () => {
  const sat = tonightsMenuCandidate({ ...MENU, now: at("2026-08-15T17:30:00"), timely: true });
  expect(sat.score).toBe(72);
});

test("menu: flag off keeps score AND stackOnly exactly as before", () => {
  const off = tonightsMenuCandidate({ ...MENU, now: at("2026-08-11T17:30:00"), timely: false });
  expect(off.score).toBe(40);
  expect(off.stackOnly).toBe(true);
});

test("collectSources injects one clock, and a caller's own clock wins", () => {
  /* Without an injected `now` the adapters would each call Date.now() and a
     single tick could straddle a window boundary. This is the guard on that. */
  const mid = collectSources({ ...COMMUTE, timely: true, now: at("2026-08-11T07:00:00") });
  expect(mid.find((c) => c.source === "commute").score).toBe(72);

  // No `now` supplied: it still produces a candidate rather than throwing on an
  // undefined clock, which is the failure this defaulting exists to prevent.
  const bare = collectSources({ ...COMMUTE, timely: true });
  expect(bare.find((c) => c.source === "commute")).toBeTruthy();
});

test("an unusable clock is not a window — it falls back to the flat score", () => {
  // A malformed `now` must never read as "in window". Failing open here would
  // put the commute on the wall at midnight.
  const c = commuteCandidate({ ...COMMUTE, now: "not a date", timely: true });
  expect(c.score).toBe(42);
});

/* ── The camera trigger: a window measured from the EVENT, not the clock ──── */

const CAM = { cameraTriggerName: "Front Door", cameraTriggerLabel: "Person", cameraTriggerAt: 0 };
const trigger = (atIso) => ({ ...CAM, cameraTriggerAt: at(atIso).getTime() });

test("camera: hot for three minutes after the trigger, and takes the hero", () => {
  const t = trigger("2026-08-11T19:00:00");
  const c = cameraTriggerCandidate({ ...t, now: at("2026-08-11T19:01:00"), timely: true });

  expect(c.score).toBe(72);
  expect(c.stackOnly).toBe(false); // same trap as the menu — score alone is not enough
});

test("camera: after the hot window it decays to a stack card, still alive", () => {
  const t = trigger("2026-08-11T19:00:00");
  const c = cameraTriggerCandidate({ ...t, now: at("2026-08-11T19:05:00"), timely: true });

  expect(c.score).toBe(45);
  expect(c.stackOnly).toBe(true);
  // It must NOT disappear — a recent trigger is worth having in the stack for
  // the rest of its 15-minute life.
  expect(c.expiresAt).toBeGreaterThan(at("2026-08-11T19:05:00").getTime());
});

test("camera: a trigger from the future is never hot", () => {
  // Clock skew between the Pi and the camera must not pin the hero indefinitely.
  const t = trigger("2026-08-11T19:10:00");
  const c = cameraTriggerCandidate({ ...t, now: at("2026-08-11T19:00:00"), timely: true });
  expect(c.score).toBe(45);
});

test("camera: flag off keeps the old stack-card behaviour", () => {
  const t = trigger("2026-08-11T19:00:00");
  const c = cameraTriggerCandidate({ ...t, now: at("2026-08-11T19:01:00"), timely: false });
  expect(c.score).toBe(45);
  expect(c.stackOnly).toBe(true);
});
