import { test, expect } from "@playwright/test";
import { getRecurrenceWindow } from "../server/routes/calendar.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE CALENDAR'S HORIZON.

   This one function bounds every calendar answer in the house, and it was
   shorter than everything downstream assumed. The window is anchored to the
   CALENDAR MONTH rather than to now — so asked on the 16th it reaches 7 Sep,
   and asked on the 30th it reaches the same date. "The next month" therefore
   shrinks as the month runs out.

   One-off events are never filtered, so this only ever bounds RECURRING ones,
   which is why the gap stays invisible until somebody asks about a birthday.
   Measured on the live G11 2026-08-16: the feed carried nothing at all between
   27 Aug and 19 Nov.

   CALENDAR_LOOKAHEAD_DAYS widens it. The rule that makes it safe to ship is
   that it can only ever EXTEND — a route that returned fewer events than before
   would silently empty every consumer that filters by day, and there are six of
   them.
   ═══════════════════════════════════════════════════════════════════════════ */

const AUG16 = new Date(2026, 7, 16, 12, 0, 0);

/* ⚠ Each test sets and restores the variable itself. The route reads
   process.env per call precisely so it can be changed without a restart (the M2
   audit finding was a module-load env read frozen above dotenv), and that is
   what makes this testable at all — but it also means a leaked value would
   travel to whatever ran next in this worker. */
function withLookahead(value, fn) {
  const prior = process.env.CALENDAR_LOOKAHEAD_DAYS;
  try {
    if (value === undefined) delete process.env.CALENDAR_LOOKAHEAD_DAYS;
    else process.env.CALENDAR_LOOKAHEAD_DAYS = String(value);
    return fn();
  } finally {
    if (prior === undefined) delete process.env.CALENDAR_LOOKAHEAD_DAYS;
    else process.env.CALENDAR_LOOKAHEAD_DAYS = prior;
  }
}

test("unset is the window this has always used — the default build is untouched", () => {
  const { rangeStart, rangeEnd } = withLookahead(undefined, () => getRecurrenceWindow(AUG16));
  // 1 Aug minus 7 days.
  expect(rangeStart.getMonth()).toBe(6);
  expect(rangeStart.getDate()).toBe(25);
  // 31 Aug plus 7 days.
  expect(rangeEnd.getMonth()).toBe(8);
  expect(rangeEnd.getDate()).toBe(7);
});

test("0 and rubbish both mean unset", () => {
  const base = withLookahead(undefined, () => getRecurrenceWindow(AUG16));
  for (const value of ["0", "", "abc", "-30"]) {
    const got = withLookahead(value, () => getRecurrenceWindow(AUG16));
    expect(got.rangeEnd.getTime(), `CALENDAR_LOOKAHEAD_DAYS=${value} changed the window`)
      .toBe(base.rangeEnd.getTime());
  }
});

test("45 reaches past the month's own edge, and moves only the end", () => {
  const base = withLookahead(undefined, () => getRecurrenceWindow(AUG16));
  const wide = withLookahead(45, () => getRecurrenceWindow(AUG16));

  expect(wide.rangeStart.getTime()).toBe(base.rangeStart.getTime());
  expect(wide.rangeEnd.getTime()).toBeGreaterThan(base.rangeEnd.getTime());
  // 16 Aug + 45 days = 30 Sep.
  expect(wide.rangeEnd.getMonth()).toBe(8);
  expect(wide.rangeEnd.getDate()).toBe(30);
});

/* ⚠ THE ONE-DIRECTIONAL RULE. Early in the month the month-anchored end is
   already further out than a modest lookahead, and the window must keep the
   further edge. Shortening it would drop recurring events that are in the feed
   today — a silent regression in every consumer, from a flag that reads like it
   only ever adds. */
test("⚠ a lookahead shorter than the month's own reach never shortens the window", () => {
  const early = new Date(2026, 7, 2, 12, 0, 0);          // 2 Aug: month-end reach is 7 Sep
  const base = withLookahead(undefined, () => getRecurrenceWindow(early));
  const short = withLookahead(7, () => getRecurrenceWindow(early));   // 9 Aug — nearer
  expect(short.rangeEnd.getTime()).toBe(base.rangeEnd.getTime());
});

test("the window always covers the 31 days the month subject asks for", () => {
  /* showAhead looks 31 days out. Checked on the LAST day of a month, which is
     where the month-anchored default is at its weakest — on 31 Aug it reaches
     only 7 Sep, seven days, and the subject would draw three-quarters of an
     empty month. */
  const last = new Date(2026, 7, 31, 12, 0, 0);
  const wide = withLookahead(45, () => getRecurrenceWindow(last));
  const needed = new Date(2026, 7, 31, 12, 0, 0);
  needed.setDate(needed.getDate() + 31);
  expect(wide.rangeEnd.getTime()).toBeGreaterThan(needed.getTime());
});

/* Expansion cost is per occurrence: a daily event over a decade is 3650 objects
   per feed, built on every uncached request. A typo in a .env file should not be
   able to turn a calendar fetch into a stall. */
test("an absurd value is capped rather than honoured", () => {
  const huge = withLookahead(36500, () => getRecurrenceWindow(AUG16));
  const capped = withLookahead(400, () => getRecurrenceWindow(AUG16));
  expect(huge.rangeEnd.getTime()).toBe(capped.rangeEnd.getTime());
});
