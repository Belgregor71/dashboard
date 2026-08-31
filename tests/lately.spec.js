import { test, expect } from "@playwright/test";
import {
  buildClaims,
  observedRows,
  daysBetween,
  MIN_DAYS,
  MARGIN_C
} from "../server/services/lately.js";
import { latelyContext } from "../server/services/voiceShape.js";

/* ═══════════════════════════════════════════════════════════════════════════
   LATELY — what the weather record will let the house claim.

   docs/AUGUST-IMPROVEMENTS.md §4. Pure: no server, no file, no clock.

   ⚠ EVERY TEST HERE IS WRITTEN AGAINST A SPECIFIC WRONG ANSWER, not against
   "does it compute". A claim builder fails SILENTLY — there is no wrong pixel
   to notice, and a module that confidently reports the wrong coldest morning
   produces a perfectly plausible sentence that is false. The wrong answers
   pinned below are the ones the implementation could actually give:

     - reading the FORECAST high/low instead of the observed extremes
     - answering on day one, before there is a window to be a record within
     - calling "since we started counting" a window that has holes in it
     - reporting a 0.1° rounding difference as a superlative
     - crediting today with a record that belongs to a day three weeks ago
   ═══════════════════════════════════════════════════════════════════════════ */

/** A row as the file holds it: forecast high/low AND observed extremes, which
 *  are deliberately different numbers so a test can tell which one was read. */
const row = (day, { obsHigh = null, obsLow = null, high = 99, low = -99, conditions = ["Clear"] } = {}) =>
  ({ day, high, low, condition: conditions[0] ?? null, obsHigh, obsLow, conditions, n: 12 });

/** `days` consecutive rows ending at 2026-08-31, observed extremes from `fn`. */
function series(days, fn = (i) => ({ obsHigh: 20 + i * 0.1, obsLow: 10 + i * 0.1 })) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(2026, 7, 31 - (days - 1 - i))).toISOString().slice(0, 10);
    out.push(row(d, fn(i)));
  }
  return out.reverse();               // newest first, as parseHistory returns
}

const TODAY = "2026-08-31";

test.describe("lately — the guards that decide whether the house may speak", () => {
  test("says nothing at all on an empty record", () => {
    const c = buildClaims([], { today: TODAY });
    expect(c.ready).toBe(false);
    expect(c.records).toEqual({});
    expect(c.todayHolds).toEqual([]);
  });

  /* THE WRONG ANSWER: answering on day one. routes/censusFeatures.js shipped
     without this guard and reported "dead: 71" of 73 on its first morning. */
  test("withholds every record below the floor, and says how far off it is", () => {
    const c = buildClaims(series(MIN_DAYS - 1), { today: TODAY });
    expect(c.ready).toBe(false);
    expect(c.records).toEqual({});
    expect(c.observedDays).toBe(MIN_DAYS - 1);
  });

  test("speaks the moment the floor is reached, and not before", () => {
    expect(buildClaims(series(MIN_DAYS - 1), { today: TODAY }).ready).toBe(false);
    expect(buildClaims(series(MIN_DAYS), { today: TODAY }).ready).toBe(true);
  });

  /* ⚠⚠ THE WRONG ANSWER THIS WHOLE MODULE EXISTS TO PREVENT: reading
     `high`/`low`. Those are a forecast sampled at an arbitrary restart — see
     weatherHistory.js's header, 12 of the first 16 live days disagreed with
     themselves. Every row here has a forecast high of 99 and a real high near
     20; a builder that read the forecast reports 99. */
  test("reads the OBSERVED extremes, never the forecast", () => {
    const c = buildClaims(series(10), { today: TODAY });
    expect(c.records.warmestDay.value).toBeLessThan(30);
    expect(c.records.coldestMorning.value).toBeGreaterThan(0);
  });

  test("a row with no observation is not evidence", () => {
    const rows = [...series(10), row("2026-07-01", { obsHigh: null, obsLow: null, high: 40, low: 2 })];
    expect(observedRows(rows).some((r) => r.day === "2026-07-01")).toBe(false);
    // The pre-observation row is older and colder on its FORECAST; if it
    // leaked in it would take the coldest-morning record with it.
    expect(buildClaims(rows, { today: TODAY }).records.coldestMorning.day).not.toBe("2026-07-01");
  });

  test("finds the real extreme, not the first or last row", () => {
    const rows = series(10, (i) => ({ obsHigh: 20 + i * 0.1, obsLow: i === 4 ? 2.0 : 12 + i * 0.1 }));
    const c = buildClaims(rows, { today: TODAY });
    expect(c.records.coldestMorning.value).toBe(2.0);
    expect(c.records.coldestMorning.day).toBe("2026-08-26");   // the 5th of 10 ending 08-31
  });

  test("warmest night reads the LOW, not the high", () => {
    // The warmest night is the highest overnight minimum. A builder that read
    // obsHigh here would answer with the last day instead of the 3rd.
    const rows = series(10, (i) => ({ obsHigh: 30 - i, obsLow: i === 2 ? 21 : 10 }));
    const c = buildClaims(rows, { today: TODAY });
    expect(c.records.warmestNight.value).toBe(21);
    expect(c.records.warmestNight.day).toBe("2026-08-24");
  });
});

test.describe("lately — the honesty of the WINDOW", () => {
  /* THE WRONG ANSWER: "since we started counting" over a record with holes.
     A day the box was off writes no row, and if those were the three hottest
     nights the claim is simply false. */
  test("a gap downgrades the scope from 'since we started counting'", () => {
    const rows = series(12).filter((r) => r.day !== "2026-08-25" && r.day !== "2026-08-26");
    const c = buildClaims(rows, { today: TODAY });
    expect(c.continuous).toBe(false);
    expect(c.gapDays).toBe(2);
    expect(c.scope).not.toContain("since we started counting");
    expect(c.scope).toContain("10 days");
  });

  test("an unbroken record earns the full phrase", () => {
    const c = buildClaims(series(12), { today: TODAY });
    expect(c.continuous).toBe(true);
    expect(c.gapDays).toBe(0);
    expect(c.scope).toBe("since we started counting");
  });

  test("the span is inclusive — 16 rows over 16 calendar days is no gap", () => {
    const c = buildClaims(series(16), { today: TODAY });
    expect(c.since).toBe("2026-08-16");
    expect(c.until).toBe(TODAY);
    expect(c.spanDays).toBe(16);
    expect(c.gapDays).toBe(0);
  });

  test("daysBetween never goes negative on a clock running backwards", () => {
    expect(daysBetween("2026-08-31", "2026-08-16")).toBe(0);
    expect(daysBetween("2026-08-16", "2026-08-31")).toBe(15);
  });
});

test.describe("lately — a record has to be WON, not tied", () => {
  /* THE WRONG ANSWER: a 0.1° difference announced as a superlative. Both
     numbers are true and the sentence is still wrong in the room. */
  test("a hair-thin lead is reported but not called clear", () => {
    const rows = series(10, (i) => ({ obsHigh: 20, obsLow: i === 0 ? 9.9 : 10.0 }));
    const c = buildClaims(rows, { today: TODAY });
    expect(c.records.coldestMorning.value).toBe(9.9);
    expect(c.records.coldestMorning.lead).toBeCloseTo(0.1, 5);
    expect(c.records.coldestMorning.clear).toBe(false);
  });

  test("a lead at the margin is clear", () => {
    const rows = series(10, (i) => ({ obsHigh: 20, obsLow: i === 0 ? 10 - MARGIN_C : 10 }));
    expect(buildClaims(rows, { today: TODAY }).records.coldestMorning.clear).toBe(true);
  });
});

test.describe("lately — todayHolds is a claim about TODAY", () => {
  /* THE WRONG ANSWER: crediting today with a record set three weeks ago. That
     turns "this is the coldest morning since we started counting" into a
     sentence about a day nobody in the room remembers. */
  test("today holds nothing when the record belongs to an older day", () => {
    const rows = series(10, (i) => ({ obsHigh: 20, obsLow: i === 0 ? 2 : 12 }));
    const c = buildClaims(rows, { today: TODAY });
    expect(c.records.coldestMorning.day).toBe("2026-08-22");
    expect(c.todayHolds).not.toContain("coldestMorning");
  });

  test("today holds the record when today actually set it", () => {
    const rows = series(10, (i) => ({ obsHigh: 20, obsLow: i === 9 ? 2 : 12 }));
    const c = buildClaims(rows, { today: TODAY });
    expect(c.records.coldestMorning.day).toBe(TODAY);
    expect(c.todayHolds).toContain("coldestMorning");
  });

  test("a today-record that is only a tie is not held", () => {
    const rows = series(10, (i) => ({ obsHigh: 20, obsLow: i === 9 ? 9.95 : 10 }));
    const c = buildClaims(rows, { today: TODAY });
    expect(c.records.coldestMorning.day).toBe(TODAY);
    expect(c.records.coldestMorning.clear).toBe(false);
    expect(c.todayHolds).not.toContain("coldestMorning");
  });
});

test.describe("lately — never throws on rubbish", () => {
  test("survives every malformed input", () => {
    for (const bad of [null, undefined, "", 42, [null], [{}], [{ day: "nope" }], {}]) {
      expect(() => buildClaims(bad, { today: TODAY })).not.toThrow();
      expect(buildClaims(bad, { today: TODAY }).ready).toBe(false);
    }
  });

  test("a malformed today is refused rather than guessed", () => {
    for (const bad of [null, undefined, "31-08-2026", 20260831]) {
      expect(buildClaims(series(20), { today: bad }).ready).toBe(false);
    }
  });
});

test.describe("latelyContext — the prompt lines, and what they refuse to say", () => {
  test("says nothing at all when the record is not ready", () => {
    expect(latelyContext(null)).toBe("");
    expect(latelyContext(buildClaims([], { today: TODAY }))).toBe("");
    expect(latelyContext(buildClaims(series(MIN_DAYS - 1), { today: TODAY }))).toBe("");
  });

  /* ⚠ THE INSTRUCTION IS THE FEATURE. Without it the model is handed a list of
     temperatures and will happily volunteer a superlative unprompted — which
     is the exact failure phase-8-learn.md:81 and CHARACTER.md forbid. */
  test("always carries the do-not-volunteer instruction", () => {
    const out = latelyContext(buildClaims(series(20), { today: TODAY }));
    expect(out).toContain("only if asked");
    expect(out).toMatch(/do not volunteer/i);
    expect(out).toContain("scoreboard");
  });

  /* THE WRONG ANSWER: letting the model borrow a longer window than the record
     covers. "Coldest all winter" off eleven days of data. */
  test("states the window so a longer one cannot be borrowed", () => {
    const out = latelyContext(buildClaims(series(20), { today: TODAY }));
    expect(out).toContain("20 day(s)");
    expect(out).toContain("2026-08-12");
    expect(out).toMatch(/never claim a longer stretch/i);
  });

  test("names the missing days when the record has holes", () => {
    const rows = series(20).filter((r) => r.day !== "2026-08-20");
    const out = latelyContext(buildClaims(rows, { today: TODAY }));
    expect(out).toContain("1 day(s) missing");
  });

  /* THE WRONG ANSWER: printing "warmest day since we started counting: 21.8"
     when another day also hit 21.8. The number is true, the superlative is
     not, and the model will reach for the superlative. */
  test("a tied record keeps its number and loses its superlative", () => {
    const rows = series(10, (i) => ({ obsHigh: 21.8, obsLow: 10 + i }));
    const out = latelyContext(buildClaims(rows, { today: TODAY }));
    expect(out).toContain("21.8");
    expect(out).toMatch(/do not call this a record/i);
  });

  test("a clearly won record carries no such qualifier", () => {
    // Every record must be won outright, or an unrelated tie qualifies a row
    // and this asserts nothing about the case it names.
    const rows = series(10, (i) => ({ obsHigh: i === 0 ? 31 : 20 + i, obsLow: 10 + i * 0.6 }));
    const out = latelyContext(buildClaims(rows, { today: TODAY }));
    expect(out).toContain("31");
    expect(out).not.toMatch(/do not call this a record/i);
  });

  test("announces today's record only when today holds one", () => {
    const held = series(10, (i) => ({ obsHigh: 20, obsLow: i === 9 ? 2 : 12 }));
    expect(latelyContext(buildClaims(held, { today: TODAY }))).toContain("Today is on record");

    const notHeld = series(10, (i) => ({ obsHigh: 20, obsLow: i === 0 ? 2 : 12 }));
    expect(latelyContext(buildClaims(notHeld, { today: TODAY }))).not.toContain("Today is on record");
  });
});
