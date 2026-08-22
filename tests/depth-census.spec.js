import { test, expect } from "@playwright/test";
import { makeLedger, localDay } from "../src/v3/core/census.js";
import { mergeDelta, emptyDay, MAX_DAYS, MAX_REASONS, DEPTHS } from "../server/routes/census.js";
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
 */

/* A quiet evening, in the units the wall actually works in. Boot at the field,
   something composes a glance at 10s, the room dwells into a spread, the hold
   expires and it recedes. */
const T = { boot: 0, glance: 10_000, spread: 40_000, recede: 130_000, now: 190_000 };

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
    expect(d.reasons.boot).toBe(1);
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
    expect(second.reasons).toEqual({});
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
    expect(recovered.reasons).toEqual(whole.reasons);
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

    expect(Object.keys(d.reasons).length).toBeLessThanOrEqual(MAX_REASONS + 1); // + "other"
    // Nothing is silently dropped: the overflow is counted, so the total number
    // of causes still adds up to the number of transitions plus boot.
    const counted = Object.values(d.reasons).reduce((a, b) => a + b, 0);
    expect(counted).toBe(MAX_REASONS + 40 + 1);
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
    expect(emptyDay()).toEqual({ entries: [0, 0, 0, 0], dwellMs: [0, 0, 0, 0], reasons: {} });
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

    const { pageErrors } = await bootV3(page);
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
    expect(body.reasons["spec-dwell"]).toBe(1);
    expect(body.reasons["spec-recede"]).toBe(1);
    expect(pageErrors).toEqual([]);
  });
});
