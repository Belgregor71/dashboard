import { test, expect } from "@playwright/test";
import { makeLedger, localDay } from "../src/v3/core/census.js";
import { mergeDelta, readByDepth, MALFORMED, emptyDay, MAX_DAYS, MAX_REASONS, DEPTHS } from "../server/routes/census.js";
import { bootV3 } from "./fixtures/v3boot.js";

/**
 * The depth census (src/v3/core/census.js, server/routes/census.js).
 *
 * Both halves are pure by design — the ledger is told what time it is and the
 * merge is told what the file said — so most of this runs straight in the
 * Playwright node process with no page and no clock, routines.spec.js style.
 *
 * ⚠ The thing being tested is a COUNTER, and a counter fails silently. There is
 * no wrong pixel to notice: a census that attributes dwell to the depth it
 * moved TO rather than the one it was IN produces a perfectly plausible file
 * that says the opposite of the truth, and the first anyone would know is a
 * design decision made on it. So every test below is written against a specific
 * wrong answer, not against "does it count".
 *
 * ⚠ Causes are now attributed PER DEPTH, and the direction is the OPPOSITE of
 * dwell's: a cause belongs to the depth being ENTERED, dwell to the depth being
 * LEFT. Both defects — attributing a cause to the depth left, and "tidying" the
 * two to point the same way — produce a file that adds up perfectly and says
 * something false, so each has a test aimed at it by name.
 */

/* A quiet evening, in the units the wall actually works in. Boot at the field,
   something composes a glance at 10s, the room dwells into a spread, the hold
   expires and it recedes. */
const T = { boot: 0, glance: 10_000, spread: 40_000, recede: 130_000, now: 190_000 };

/** Sum four cause maps back into the flat total the server derives. */
const flat = (maps) => {
  const out = {};
  for (const map of maps) {
    for (const [key, n] of Object.entries(map)) out[key] = (out[key] ?? 0) + n;
  }
  return out;
};

test.describe("the ledger — dwell belongs to the depth being LEFT", () => {
  test("each interval is credited to the depth it was spent at", () => {
    const l = makeLedger(0, T.boot);
    l.enter(1, "attention", T.glance);
    l.enter(2, "dwell", T.spread);
    l.enter(0, "recede", T.recede);
    const d = l.drain(T.now, new Date(2026, 7, 23));

    // 0→1 at 10s, 1→2 at 40s, 2→0 at 130s, drained at 190s.
    // Field: 10s before the glance + 60s after receding. This is the assertion
    // that fails if dwell is credited to the depth being entered — that defect
    // yields [30000, 90000, 60000] here, which reads just as sensible.
    expect(d.dwellMs).toEqual([70_000, 30_000, 90_000, 0]);
  });

  test("entries and dwell periods stay one-to-one, so the mean is honest", () => {
    const l = makeLedger(0, T.boot);
    l.enter(1, "attention", T.glance);
    l.enter(0, "recede", T.recede);
    const d = l.drain(T.now, new Date(2026, 7, 23));

    // Two visits to the field: the one boot started and the one recession made.
    expect(d.entries).toEqual([2, 1, 0, 0]);
    expect(d.byDepth[0].boot).toBe(1);
    // Every depth with dwell has at least one entry to divide it by.
    for (let i = 0; i < DEPTHS; i += 1) {
      if (d.dwellMs[i] > 0) expect(d.entries[i]).toBeGreaterThan(0);
    }
  });

  test("a drain resets — the next one reports only what happened after it", () => {
    const l = makeLedger(0, T.boot);
    l.enter(1, "attention", T.glance);
    const first = l.drain(T.glance, new Date(2026, 7, 23));
    const second = l.drain(T.glance + 5_000, new Date(2026, 7, 23));

    expect(first.dwellMs[0]).toBe(10_000);
    expect(first.entries[1]).toBe(1);
    // A ledger that did not zero would report the first 10s a second time, and
    // every flush after it would inflate the file further.
    expect(second.dwellMs).toEqual([0, 5_000, 0, 0]);
    expect(second.entries).toEqual([0, 0, 0, 0]);
    expect(second.byDepth).toEqual([{}, {}, {}, {}]);
  });
});

test.describe("the ledger — a flush that failed must not lose the fortnight", () => {
  test("drain + restore + drain equals one drain of the whole span", () => {
    const straight = makeLedger(0, T.boot);
    straight.enter(1, "attention", T.glance);
    straight.enter(0, "recede", T.recede);
    const whole = straight.drain(T.now, new Date(2026, 7, 23));

    const interrupted = makeLedger(0, T.boot);
    interrupted.enter(1, "attention", T.glance);
    const lost = interrupted.drain(T.spread, new Date(2026, 7, 23)); // the POST that failed
    interrupted.restore(lost);
    interrupted.enter(0, "recede", T.recede);
    const recovered = interrupted.drain(T.now, new Date(2026, 7, 23));

    expect(recovered.entries).toEqual(whole.entries);
    expect(recovered.dwellMs).toEqual(whole.dwellMs);
    // Per depth, not just in total: a restore that poured every recovered cause
    // into one map would balance the books and lose the attribution.
    expect(recovered.byDepth).toEqual(whole.byDepth);
  });

  test("a clock that steps backwards drops the interval instead of subtracting", () => {
    const l = makeLedger(0, 100_000);
    l.enter(1, "attention", 90_000); // NTP stepped the box back ten seconds
    const d = l.drain(95_000, new Date(2026, 7, 23));

    // Never negative. A subtraction here would eat dwell already counted and
    // could drive a total below zero, which the route would then reject —
    // turning a clock correction into permanent data loss.
    expect(d.dwellMs.every((n) => n >= 0)).toBe(true);
    expect(d.dwellMs[0]).toBe(0);
    expect(d.entries[1]).toBe(1);
  });

  test("the reason tally is capped, so a flush body cannot grow forever", () => {
    const l = makeLedger(0, 0);
    for (let i = 0; i < MAX_REASONS + 40; i += 1) l.enter(i % 4, `cause-${i}`, i + 1);
    const d = l.drain(1_000_000, new Date(2026, 7, 23));

    // ⚠ The cap is on the UNION of names across the four maps. Counting it per
    // map would let a body carry 4 x MAX_REASONS and still call itself capped.
    expect(Object.keys(flat(d.byDepth)).length).toBeLessThanOrEqual(MAX_REASONS + 1); // + "other"
    // Nothing is silently dropped: the overflow is counted, so the total number
    // of causes still adds up to the number of transitions plus boot.
    const counted = Object.values(flat(d.byDepth)).reduce((a, b) => a + b, 0);
    expect(counted).toBe(MAX_REASONS + 40 + 1);
  });
});

test.describe("the ledger — a cause belongs to the depth being ENTERED", () => {
  test("the cause lands at the destination, not at the depth it came from", () => {
    const l = makeLedger(0, T.boot);
    l.enter(2, "attention:spread", T.glance);
    l.enter(0, "recede", T.recede);
    const d = l.drain(T.now, new Date(2026, 7, 23));

    /* This is the whole point of the change, and it is the assertion that fails
       if a cause is credited to the depth being LEFT. That defect yields
       byDepth[0] = { boot: 1, "attention:spread": 1 } and byDepth[2] = { recede: 1 }
       — a file that adds up perfectly and says the spread is caused by receding. */
    expect(d.byDepth[2]).toEqual({ "attention:spread": 1 });
    expect(d.byDepth[0]).toEqual({ boot: 1, recede: 1 });
    expect(d.byDepth[1]).toEqual({});
    expect(d.byDepth[3]).toEqual({});
  });

  test("boot is attributed to the depth the surface STARTED at", () => {
    // Not always the field: a page that reloads while the room is occupied can
    // boot straight into a spread, and hard-coding depth 0 would file that as a
    // visit to the field that never happened.
    const l = makeLedger(2, T.boot);
    const d = l.drain(T.now, new Date(2026, 7, 23));

    expect(d.byDepth[2].boot).toBe(1);
    expect(d.byDepth[0]).toEqual({});
    expect(d.entries).toEqual([0, 0, 1, 0]);
  });

  test("cause and dwell point in OPPOSITE directions for the same transition", () => {
    /* The asymmetry, asserted on one event so that "tidying" the two to agree
       breaks something by name. The move to the spread at 10s means: the ten
       seconds before it were spent at the FIELD, and the cause explains the
       SPREAD. A version where both point the same way passes half of this. */
    const l = makeLedger(0, T.boot);
    l.enter(2, "attention:spread", T.glance);
    const d = l.drain(T.glance, new Date(2026, 7, 23));

    expect(d.dwellMs).toEqual([10_000, 0, 0, 0]);            // time at the depth LEFT
    expect(d.byDepth[2]["attention:spread"]).toBe(1);        // cause at the depth ENTERED
    expect(d.byDepth[0]["attention:spread"]).toBeUndefined();
  });

  test("the same cause at two depths is one name, counted twice", () => {
    // `attention:health` really does drive both a glance and a spread on the
    // wall. Keeping it as one name is what lets the union cap mean what it says.
    const l = makeLedger(0, T.boot);
    l.enter(1, "attention:health", 1_000);
    l.enter(0, "recede", 2_000);
    l.enter(2, "attention:health", 3_000);
    const d = l.drain(4_000, new Date(2026, 7, 23));

    expect(d.byDepth[1]["attention:health"]).toBe(1);
    expect(d.byDepth[2]["attention:health"]).toBe(1);
    expect(flat(d.byDepth)["attention:health"]).toBe(2);
  });

  test("an unnamed cause is still attributed, not thrown away", () => {
    // The live file carries one `attention:undefined` from 2026-08-29. A cause
    // that lost its name is still evidence of a transition somewhere.
    const l = makeLedger(0, T.boot);
    l.enter(2, undefined, 1_000);
    const d = l.drain(2_000, new Date(2026, 7, 23));

    expect(d.byDepth[2].unknown).toBe(1);
  });

  test("the peek keeps a flat total, DERIVED from the attribution", () => {
    // The debug handle answers the flat question a human asks first, but there
    // is only one stored tally — a second one could drift from it in silence.
    const l = makeLedger(0, T.boot);
    l.enter(2, "attention:spread", T.glance);
    const p = l.peek(T.spread);

    expect(p.reasons).toEqual(flat(p.byDepth));
    expect(p.reasons["attention:spread"]).toBe(1);
  });
});

test.describe("localDay — the house's day, not Greenwich's", () => {
  test("the date is read off the local components", () => {
    expect(localDay(new Date(2026, 7, 23, 9, 14))).toBe("2026-08-23");
    expect(localDay(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
    expect(localDay(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  test("it disagrees with toISOString exactly when the timezone says it should", () => {
    // In Brisbane (+10) a 9am reading is still the previous day in UTC, so a
    // census built on toISOString would file every morning under yesterday.
    // Asserted conditionally because the suite runs on developer boxes in other
    // zones, where there is no disagreement to catch.
    const morning = new Date(2026, 7, 23, 9, 0);
    const utcDay = morning.toISOString().slice(0, 10);
    if (utcDay !== "2026-08-23") expect(localDay(morning)).not.toBe(utcDay);
    expect(localDay(morning)).toBe("2026-08-23");
  });
});

test.describe("readByDepth — what the wire will accept", () => {
  /* ⚠ This is a DIFFERENT bound from mergeDelta's. mergeDelta caps what is
     STORED and is what keeps the file small; this caps what is ACCEPTED and is
     what keeps a flush BODY small. A defect here is invisible through the route
     — the storage cap catches the overflow either way and the file looks
     perfect — so it has to be tested at this seam or not at all. */

  test("absent, malformed and present are three different answers", () => {
    // Folding the first two together is how a real client bug turns into a
    // permanent silent gap: every delta rejected, or every delta unattributed.
    expect(readByDepth(undefined)).toBeNull();
    expect(readByDepth(null)).toBeNull();
    expect(readByDepth({ 0: { boot: 1 } })).toBe(MALFORMED);
    expect(readByDepth([{}, {}, {}])).toBe(MALFORMED);
    expect(readByDepth([["boot"], {}, {}, {}])).toBe(MALFORMED);
    expect(readByDepth([{ boot: 1 }, {}, {}, {}])).toEqual([{ boot: 1 }, {}, {}, {}]);
  });

  test("the accepted body is capped on the UNION of names, not per depth", () => {
    /* Split one map into four and a per-map cap silently quadruples the ceiling
       — the exact size the cap exists to prevent. Twenty novel names at each of
       four depths is eighty names; a per-map cap accepts all eighty. */
    const perDepth = MAX_REASONS - 4;
    const body = Array.from({ length: DEPTHS }, (_, d) => {
      const map = {};
      for (let i = 0; i < perDepth; i += 1) map[`d${d}-cause-${i}`] = 1;
      return map;
    });
    const read = readByDepth(body);
    const names = new Set(read.flatMap((map) => Object.keys(map)));

    expect(names.size).toBeLessThanOrEqual(MAX_REASONS);
    // Not merely "smaller than what was sent" — that is true of a per-map cap
    // too. The number that separates them is MAX_REASONS itself.
    expect(DEPTHS * perDepth).toBeGreaterThan(MAX_REASONS);
  });

  test("a cause seen at every depth costs ONE name against the ceiling", () => {
    // The other half of the union rule: four appearances of `recede` must not
    // burn four slots, or a real day of causes would hit the cap on names it
    // already has.
    const body = [{ recede: 1 }, { recede: 2 }, { recede: 3 }, { recede: 4 }];
    expect(readByDepth(body)).toEqual(body);
  });

  test("an unnameable cause is dropped without losing the flush it rode in on", () => {
    const read = readByDepth([{ "not a reason!": 3, recede: 2 }, {}, {}, {}]);
    expect(read[0]["not a reason!"]).toBeUndefined();
    expect(read[0].recede).toBe(2);
  });
});

test.describe("mergeDelta — the server adds, it never replaces", () => {
  const delta = (day, over = {}) => ({
    day,
    entries: [1, 0, 0, 0],
    dwellMs: [1000, 0, 0, 0],
    reasons: { boot: 1 },
    ...over
  });

  test("two flushes on the same day accumulate", () => {
    const once = mergeDelta({ days: {} }, delta("2026-08-23"));
    const twice = mergeDelta(once, delta("2026-08-23"));

    expect(twice.days["2026-08-23"].entries[0]).toBe(2);
    expect(twice.days["2026-08-23"].dwellMs[0]).toBe(2000);
    expect(twice.days["2026-08-23"].reasons.boot).toBe(2);
  });

  test("a freshly-booted page cannot zero the history", () => {
    // The whole reason this route takes deltas rather than a blob: a page that
    // reloaded at 3pm has an in-memory tally starting at zero, and a PUT of it
    // would erase the fortnight. An all-zero delta must be a no-op.
    const seeded = mergeDelta({ days: {} }, delta("2026-08-23", { entries: [9, 4, 2, 1], dwellMs: [9e5, 4e4, 2e4, 1e4] }));
    const after = mergeDelta(seeded, delta("2026-08-23", { entries: [0, 0, 0, 0], dwellMs: [0, 0, 0, 0], reasons: {} }));

    expect(after.days["2026-08-23"].entries).toEqual([9, 4, 2, 1]);
    expect(after.days["2026-08-23"].dwellMs).toEqual([9e5, 4e4, 2e4, 1e4]);
  });

  test("days are kept separate and the window rolls oldest-first", () => {
    let census = { days: {} };
    for (let i = 1; i <= MAX_DAYS + 5; i += 1) {
      census = mergeDelta(census, delta(`2026-06-${String(i).padStart(2, "0")}`));
    }
    const kept = Object.keys(census.days).sort();

    expect(kept).toHaveLength(MAX_DAYS);
    expect(kept[0]).toBe("2026-06-06");                     // the five oldest went
    expect(kept.at(-1)).toBe(`2026-06-${MAX_DAYS + 5}`);    // today survived
  });

  test("a burst of novel causes cannot evict established ones", () => {
    let census = mergeDelta({ days: {} }, delta("2026-08-23", { reasons: { recede: 40 } }));
    for (let i = 0; i < MAX_REASONS + 20; i += 1) {
      census = mergeDelta(census, delta("2026-08-23", { reasons: { [`novel-${i}`]: 1 } }));
    }
    const { reasons } = census.days["2026-08-23"];

    expect(Object.keys(reasons).length).toBeLessThanOrEqual(MAX_REASONS);
    // The count that had forty observations behind it is still there. A cap
    // that evicted on arrival would trade the whole signal for noise.
    expect(reasons.recede).toBe(40);
  });

  test("an empty day is four depths of zero and nothing else", () => {
    expect(emptyDay()).toEqual({
      entries: [0, 0, 0, 0],
      dwellMs: [0, 0, 0, 0],
      reasons: {},
      byDepth: [{}, {}, {}, {}]
    });
  });

  /* ── Attribution across the merge ───────────────────────────────── */

  const attributed = (day, byDepth, over = {}) =>
    delta(day, { reasons: undefined, byDepth, ...over });

  test("byDepth is stored per depth AND summed into the flat total", () => {
    const census = mergeDelta({ days: {} }, attributed("2026-08-30", [
      { boot: 1, recede: 3 }, {}, { "attention:spread": 5 }, {}
    ]));
    const stored = census.days["2026-08-30"];

    expect(stored.byDepth[2]["attention:spread"]).toBe(5);
    expect(stored.byDepth[0].recede).toBe(3);
    // The flat total is the union, so the first week stays comparable with
    // every week after it without the reader knowing which shape arrived.
    expect(stored.reasons).toEqual({ boot: 1, recede: 3, "attention:spread": 5 });
  });

  test("⚠ a body carrying BOTH shapes is counted ONCE, not twice", () => {
    /* The one failure this route cannot have. A client that sent byDepth and a
       flat total, merged by a server that added both, would double every cause
       in silence — and a doubled counter reads exactly like a busy house. The
       rule is that byDepth WINS and the flat body field is ignored. */
    const census = mergeDelta({ days: {} }, delta("2026-08-30", {
      reasons: { recede: 4 },
      byDepth: [{ recede: 4 }, {}, {}, {}]
    }));

    expect(census.days["2026-08-30"].reasons.recede).toBe(4);   // not 8
    expect(census.days["2026-08-30"].byDepth[0].recede).toBe(4);
  });

  test("a delta with no byDepth still lands — that path is the deploy window", () => {
    // The kiosk runs the bundle it loaded until something reloads it, so the
    // live page keeps POSTing flat causes for a while after this ships. Losing
    // them would put a hole in the file on exactly the day it changed shape.
    const census = mergeDelta({ days: {} }, delta("2026-08-30", { reasons: { recede: 7 } }));
    const stored = census.days["2026-08-30"];

    expect(stored.reasons.recede).toBe(7);
    expect(stored.byDepth).toEqual([{}, {}, {}, {}]);
  });

  test("a day straddling the deploy window holds sum(byDepth) < reasons", () => {
    /* Both halves are true at once and the difference is the honest record of
       the part that arrived unattributed. A merge that quietly zeroed the flat
       total on the first attributed delta would erase the older half instead. */
    let census = mergeDelta({ days: {} }, delta("2026-08-30", { reasons: { recede: 6 } }));
    census = mergeDelta(census, attributed("2026-08-30", [{ recede: 2 }, {}, {}, {}]));
    const stored = census.days["2026-08-30"];

    expect(stored.reasons.recede).toBe(8);
    expect(flat(stored.byDepth).recede).toBe(2);
    expect(flat(stored.byDepth).recede).toBeLessThan(stored.reasons.recede);
  });

  test("a stored day from before attribution gains maps without losing counts", () => {
    // Read straight off the shipped file: seven days of { entries, dwellMs,
    // reasons } with no byDepth at all. Merging onto one must not throw it away.
    const legacy = {
      days: { "2026-08-29": { entries: [71, 31, 50, 19], dwellMs: [1, 2, 3, 4], reasons: { recede: 25 } } }
    };
    const census = mergeDelta(legacy, attributed("2026-08-29", [{ recede: 1 }, {}, {}, {}]));
    const stored = census.days["2026-08-29"];

    expect(stored.entries).toEqual([72, 31, 50, 19]);
    expect(stored.reasons.recede).toBe(26);
    expect(stored.byDepth[0].recede).toBe(1);
  });

  test("the cap counts NAMES, not name-depth pairs", () => {
    /* Splitting one map into four is exactly how a bounded file quietly becomes
       a 4x file. `recede` at all four depths is one name against the ceiling,
       and a novel name is refused once the union is full however empty any
       individual map still looks.

       ⚠ THE NOVEL NAMES MUST BE SPREAD ACROSS THE DEPTHS. Sent to one depth,
       a per-map cap and a union cap behave identically and this test goes
       green against the defect — measured, not assumed. */
    let census = mergeDelta({ days: {} }, attributed("2026-08-30", [
      { recede: 1 }, { recede: 1 }, { recede: 1 }, { recede: 1 }
    ]));
    const novel = DEPTHS * MAX_REASONS;
    for (let i = 0; i < novel; i += 1) {
      const maps = [{}, {}, {}, {}];
      maps[i % DEPTHS][`novel-${i}`] = 1;
      census = mergeDelta(census, attributed("2026-08-30", maps));
    }
    const stored = census.days["2026-08-30"];

    // A per-map cap admits up to DEPTHS x MAX_REASONS distinct names here and
    // still looks capped from inside any one map.
    expect(Object.keys(stored.reasons).length).toBeLessThanOrEqual(MAX_REASONS);
    expect(Object.keys(flat(stored.byDepth)).length).toBeLessThanOrEqual(MAX_REASONS);
    expect(novel).toBeGreaterThan(MAX_REASONS);
    expect(stored.reasons.recede).toBe(4);   // the established count survived
  });

  test("the flat total never disagrees with the attribution it sums", () => {
    // The invariant a reader relies on. Asserted over a mixed run rather than
    // one delta, because drift needs more than one merge to show up.
    let census = { days: {} };
    for (let i = 0; i < 20; i += 1) {
      census = mergeDelta(census, attributed("2026-08-30", [
        { boot: 1 }, { "attention:health": 1 }, { "attention:spread": 2 }, { "alert:doorbell": 1 }
      ]));
    }
    const stored = census.days["2026-08-30"];

    expect(stored.reasons).toEqual(flat(stored.byDepth));
    expect(stored.reasons["attention:spread"]).toBe(40);
  });
});

/* ── On the surface ─────────────────────────────────────────────────────────
   The pure halves above can both be right while nothing is wired to anything.
   These two are the wiring: the flag actually gates it, and a real depth change
   on a real page reaches the route.
─────────────────────────────────────────────────────────────────────────── */

test.describe("wired to the wall", () => {
  test("flag off: no handle, no subscription, no request", async ({ page }) => {
    const seen = [];
    // Registered before boot on purpose — a listener added after an async load
    // has already missed the thing it was watching for.
    page.on("request", (r) => { if (r.url().includes("/api/census")) seen.push(r.url()); });

    /* ⚠ PINNED OFF EXPLICITLY, not left to the default. This test asserts the
       ROLLBACK PATH — the state the wall falls back to if the census ever has
       to be switched off — so it has to keep testing that whichever way the
       default points. Written while the default was false; inheriting it would
       have turned this into a test of nothing on the day it was flipped. */
    const { pageErrors } = await bootV3(page, {}, { features: { v3DepthCensus: false } });
    await page.evaluate(() => { window.__setDepth(2, "spec-dwell"); window.__setDepth(0, "spec-recede"); });

    expect(await page.evaluate(() => typeof window.__v3Census)).toBe("undefined");
    expect(await page.evaluate(() => typeof window.__v3CensusFlush)).toBe("undefined");
    expect(seen).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("flag on: a depth change on the page arrives at the route", async ({ page }) => {
    const posted = [];
    const { pageErrors } = await bootV3(page, {}, { features: { v3DepthCensus: true } });

    /* ⚠ Registered AFTER bootV3, which installs a catch-all `**​/api/**`.
       page.route() matches the LAST-registered handler first, so this one wins
       — reverse the order and the census POST is answered 503 by the fixture
       and this test asserts nothing. */
    await page.route("**/api/census/depth", async (route) => {
      if (route.request().method() === "POST") posted.push(JSON.parse(route.request().postData()));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.evaluate(() => { window.__setDepth(2, "spec-dwell"); window.__setDepth(0, "spec-recede"); });
    await page.evaluate(() => window.__v3CensusFlush());

    expect(posted).toHaveLength(1);
    const [body] = posted;
    expect(body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.entries).toHaveLength(DEPTHS);
    expect(body.entries[2]).toBe(1);          // the spread was entered once
    /* Attributed on the way out, not flattened by the server on the way in — so
       this asserts the DEPTHS, not just that two causes arrived. */
    expect(body.byDepth).toHaveLength(DEPTHS);
    expect(body.byDepth[2]["spec-dwell"]).toBe(1);
    expect(body.byDepth[0]["spec-recede"]).toBe(1);
    // The flat field is gone from the wire; sending both is what doubles.
    expect(body.reasons).toBeUndefined();
    expect(pageErrors).toEqual([]);
  });
});
