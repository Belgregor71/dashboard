import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { makeFeatureLedger, featureKey, localDay } from "../src/v3/core/feature-census.js";
import {
  mergeFeatureDelta, buildReport, baseOf, dayBefore, emptyCensus, censusSince, daysBetween,
  readCounts, readRoster, MAX_DAYS, MAX_KEYS, MAX_ROSTER, DEFAULT_SILENT_DAYS, DEFAULT_DEAD_DAYS
} from "../server/routes/censusFeatures.js";
import { SOURCE_NAMES, SOURCES } from "../src/js/services/candidateSources.js";
import { INTENT_IDS } from "../src/js/services/localIntents.js";
import { LOCATIONS } from "../src/js/services/alertRouter.js";
import { bootV3 } from "./fixtures/v3boot.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The feature census (src/v3/core/feature-census.js,
 * server/routes/censusFeatures.js) — docs/AUGUST-IMPROVEMENTS.md §1.
 *
 * Both halves are pure by design, so most of this runs straight in the
 * Playwright node process with no page and no clock, depth-census.spec.js style.
 *
 * ⚠ THE THING BEING TESTED IS A COUNTER, AND A COUNTER FAILS SILENTLY. There is
 * no wrong pixel to notice: a census that prunes its sticky `seen` map along
 * with the day window produces a perfectly plausible file that goes quiet about
 * exactly the features someone needs to ask about. So every test below is
 * written against a SPECIFIC WRONG ANSWER, not against "does it count" — and
 * several name the wrong answer they would produce.
 *
 * ⚠ AND THE INSTRUMENT MUST NOT REPRODUCE THE BUG IT CATCHES. The last describe
 * block reads the BUILT bundle, because `fn.name` is renamed by the minifier and
 * a census keyed on one would be right here and garbage on the wall.
 */

const DAY = "2026-08-29";

/* Today in the BROWSER's local terms, not UTC — `eventsForDay` compares
   toDateString() values, so a UTC-sliced stamp lands on yesterday for half of
   every Brisbane day. Same fixture and same reason as v3-subjects.spec.js. */
function calToday() {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return [{ title: "Dentist", start: `${ymd}T09:30:00` }];
}

test.describe("the ledger — counts, and only what it is told", () => {
  test("records by namespaced key and drains to the route's body shape", () => {
    const l = makeFeatureLedger();
    l.record("attn", "bom", "offered");
    l.record("attn", "bom", "offered");
    l.record("attn", "bom", "hero");
    l.record("subject", "show.year", "shown");

    const d = l.drain(new Date(2026, 7, 29));
    expect(d.day).toBe(DAY);
    expect(d.counts).toEqual({
      "attn:bom:offered": 2,
      "attn:bom:hero": 1,
      "subject:show.year:shown": 1
    });
  });

  test("a drain resets — the next one reports only what happened after it", () => {
    const l = makeFeatureLedger();
    l.record("attn", "bom", "offered");
    l.drain(new Date(2026, 7, 29));
    l.record("attn", "commute", "offered");

    // The defect this catches is a drain that copies without clearing: that
    // yields bom again here, and every flush would re-send the whole day —
    // so a five-minute kiosk would multiply every count by twelve an hour.
    expect(l.drain(new Date(2026, 7, 29)).counts).toEqual({ "attn:commute:offered": 1 });
  });

  test("drain + restore + drain equals one drain of the whole span", () => {
    const l = makeFeatureLedger();
    l.record("attn", "bom", "offered");
    const lost = l.drain(new Date(2026, 7, 29));
    l.restore(lost);
    l.record("attn", "bom", "offered");

    // A failed POST must cost nothing. Restore that dropped the delta instead
    // of adding it yields 1 here, and every 500 would silently lose a window.
    expect(l.drain(new Date(2026, 7, 29)).counts).toEqual({ "attn:bom:offered": 2 });
  });

  test("an unnameable key is dropped, not thrown", () => {
    const l = makeFeatureLedger();
    // record() is called from inside the attention tick and the voice turn. An
    // instrument that can throw is an instrument that can take down the thing
    // it measures — the whole surface, on a wall, for a counter.
    expect(() => l.record("attn", "has space", "offered")).not.toThrow();
    expect(l.record("attn", "has space", "offered")).toBeNull();
    expect(l.record("attn", "bom", "offered")).toBe("attn:bom:offered");
    expect(l.drain(new Date(2026, 7, 29)).counts).toEqual({ "attn:bom:offered": 1 });
  });

  test("the key cap stops NEW keys and never stops an established one", () => {
    const l = makeFeatureLedger();
    for (let i = 0; i < MAX_KEYS; i += 1) l.record("attn", `s${i}`, "offered");
    l.record("attn", "late", "offered");     // over the cap — refused
    l.record("attn", "s0", "offered");       // already present — must still count

    const { counts } = l.drain(new Date(2026, 7, 29));
    expect(Object.keys(counts)).toHaveLength(MAX_KEYS);
    expect(counts["attn:late:offered"]).toBeUndefined();
    // The defect: a cap that refuses by key COUNT rather than by NOVELTY would
    // freeze s0 at 1 here, and the busiest features would be the first to stop
    // being counted.
    expect(counts["attn:s0:offered"]).toBe(2);
  });

  test("featureKey accepts the ids the lane really produces", () => {
    // Dots (intent ids), underscores (alert prefixes), and the colon separator.
    expect(featureKey("intent", "show.forecast", "matched")).toBe("intent:show.forecast:matched");
    expect(featureKey("alert", "side_gate", "routed")).toBe("alert:side_gate:routed");
    expect(featureKey("attn", "bom", "offered")).toBe("attn:bom:offered");
    expect(featureKey("attn", "b om", "offered")).toBeNull();
  });

  test("the date is read off the local components, not toISOString", () => {
    // 10am Brisbane on the 29th is still the 28th in UTC. A census that stamped
    // UTC would file every Brisbane morning under the previous day.
    expect(localDay(new Date(2026, 7, 29, 10, 0))).toBe(DAY);
  });
});

test.describe("the merge — the fortnight survives every writer", () => {
  test("two flushes on the same day accumulate", () => {
    let c = mergeFeatureDelta(emptyCensus(), { day: DAY, counts: { "attn:bom:offered": 2 }, roster: [] });
    c = mergeFeatureDelta(c, { day: DAY, counts: { "attn:bom:offered": 3 }, roster: [] });
    expect(c.days[DAY]["attn:bom:offered"]).toBe(5);
  });

  test("a freshly-booted page cannot zero the history", () => {
    // The kiosk reloads on every deploy and its in-memory tally starts empty.
    // This is the whole reason the wire carries DELTAS and not the blob.
    let c = mergeFeatureDelta(emptyCensus(), { day: DAY, counts: { "attn:bom:offered": 9 }, roster: [] });
    c = mergeFeatureDelta(c, { day: DAY, counts: {}, roster: [] });
    expect(c.days[DAY]["attn:bom:offered"]).toBe(9);
  });

  test("days roll oldest-first at the window", () => {
    let c = emptyCensus();
    for (let i = 0; i < MAX_DAYS + 5; i += 1) {
      c = mergeFeatureDelta(c, { day: dayBefore(DAY, MAX_DAYS + 4 - i), counts: { "attn:bom:offered": 1 }, roster: [] });
    }
    expect(Object.keys(c.days)).toHaveLength(MAX_DAYS);
    expect(Object.keys(c.days).sort()[MAX_DAYS - 1]).toBe(DAY);
  });

  test("⚠ `seen` is NOT pruned with the days — this is the point of the file", () => {
    let c = mergeFeatureDelta(emptyCensus(), { day: dayBefore(DAY, 60), counts: { "attn:bom:offered": 4 }, roster: [] });
    for (let i = 0; i < MAX_DAYS + 2; i += 1) {
      c = mergeFeatureDelta(c, { day: dayBefore(DAY, MAX_DAYS + 1 - i), counts: { "attn:commute:offered": 1 }, roster: [] });
    }

    // bom's day fell out of the window 60 days ago. If `seen` were pruned
    // alongside it, the census would go SILENT about bom at precisely the
    // moment bom became the thing worth asking about — and the report would
    // then call it neither alive nor dead, but absent.
    expect(c.days[dayBefore(DAY, 60)]).toBeUndefined();
    expect(c.seen["attn:bom:offered"]).toEqual({
      first: dayBefore(DAY, 60), last: dayBefore(DAY, 60), total: 4
    });
  });

  test("`last` only moves forward, so a late flush cannot rewind a live feature", () => {
    let c = mergeFeatureDelta(emptyCensus(), { day: DAY, counts: { "attn:bom:offered": 1 }, roster: [] });
    // A page whose clock is behind, or a keepalive flush landing after midnight.
    c = mergeFeatureDelta(c, { day: dayBefore(DAY, 3), counts: { "attn:bom:offered": 1 }, roster: [] });
    expect(c.seen["attn:bom:offered"].last).toBe(DAY);
    expect(c.seen["attn:bom:offered"].first).toBe(dayBefore(DAY, 3));
    expect(c.seen["attn:bom:offered"].total).toBe(2);
  });

  test("the roster is a UNION — a flag-off page cannot shrink it", () => {
    let c = mergeFeatureDelta(emptyCensus(), { day: DAY, counts: {}, roster: ["attn:bom", "attn:commute"] });
    // A second client that declares less (an older bundle, a laptop tab) must
    // not carry away the keys the kiosk declared. A `replace` here would take
    // every "dead" verdict with it and the report would look clean.
    c = mergeFeatureDelta(c, { day: DAY, counts: {}, roster: ["attn:bom"] });
    expect(c.roster).toEqual(["attn:bom", "attn:commute"]);
  });

  test("counts are read strictly — a string is not a number", () => {
    // Number("1") is 1, so a coercing check accepts a client that sends its
    // counts as strings and rejects the same client the day one is "12e3".
    expect(readCounts({ "attn:bom:offered": "2" })).toEqual({});
    expect(readCounts({ "attn:bom:offered": 2 })).toEqual({ "attn:bom:offered": 2 });
    expect(readCounts({ "bad key": 2, "attn:bom:offered": 1 })).toEqual({ "attn:bom:offered": 1 });
    expect(readCounts([])).toBeNull();
  });

  test("the roster is capped and non-arrays are refused", () => {
    expect(readRoster("attn:bom")).toBeNull();
    expect(readRoster(Array.from({ length: MAX_ROSTER + 10 }, (_, i) => `attn:s${i}`))).toHaveLength(MAX_ROSTER);
  });

  test("baseOf strips the outcome and leaves everything else alone", () => {
    expect(baseOf("attn:bom:offered")).toBe("attn:bom");
    expect(baseOf("intent:show.forecast:matched")).toBe("intent:show.forecast");
  });
});

test.describe("the report — three findings that look identical from the kitchen", () => {
  /* A house where bom has been dead since before the census, show.year worked a
     month ago and stopped, commute is offered every tick and never reaches the
     glass, and plex is simply fine. */
  function house() {
    /* ⚠ Seeded oldest-first, which is the order a real file is written in, and
       it matters: `since` is written once on the FIRST flush, so a fixture that
       opened with today's date would describe a census one minute old and every
       "dead" verdict below would be withheld — correctly. */
    let c = mergeFeatureDelta(emptyCensus(), {
      day: dayBefore(DAY, 30), counts: { "subject:show.year:shown": 3 },
      roster: ["attn:bom", "attn:commute", "attn:plex", "subject:show.year"]
    });
    c = mergeFeatureDelta(c, { day: DAY, counts: { "attn:commute:offered": 288, "attn:commute:hero": 12 }, roster: [] });
    c = mergeFeatureDelta(c, { day: DAY, counts: { "attn:plex:offered": 40, "attn:plex:shown": 2 }, roster: [] });
    return c;
  }

  test("dead: in the roster and never once observed", () => {
    const r = buildReport(house(), { today: DAY });
    // ⚠ This is the finding the roster exists for and the ONLY one a pure
    // counter cannot reach: zero rows for bom and no such thing as bom produce
    // byte-identical files.
    expect(r.dead).toEqual(["attn:bom"]);
  });

  test("silent: it worked once, and not lately", () => {
    const r = buildReport(house(), { today: DAY, silentDays: 14 });
    expect(r.silent).toEqual([{ key: "subject:show.year", last: dayBefore(DAY, 30), total: 3 }]);
    // And it is NOT dead — a regression and a stillbirth need different answers.
    expect(r.dead).not.toContain("subject:show.year");
  });

  test("silentDays moves the line, and a live feature never crosses it", () => {
    expect(buildReport(house(), { today: DAY, silentDays: 31 }).silent).toEqual([]);
    expect(buildReport(house(), { today: DAY }).silentDays).toBe(DEFAULT_SILENT_DAYS);
    expect(buildReport(house(), { today: DAY }).silent.map((s) => s.key)).not.toContain("attn:commute");
  });

  test("offeredNeverShown: alive, winning sometimes, and never on the glass", () => {
    const r = buildReport(house(), { today: DAY });
    // commute is offered 288 times and shown 0. That is a DIFFERENT bug from
    // being dead — the adapter works and the depth gate is eating it — and the
    // two are indistinguishable from the floor of the kitchen.
    expect(r.offeredNeverShown).toEqual([{ key: "attn:commute", offered: 288, hero: 12 }]);
    // plex reaches the glass, so it must not appear.
    expect(r.offeredNeverShown.map((o) => o.key)).not.toContain("attn:plex");
  });

  test("a month-old fixture is old enough to be judged", () => {
    // The guard below is only meaningful if the fixture clears it — otherwise
    // every "dead" test above would be passing for the wrong reason.
    const r = buildReport(house(), { today: DAY });
    expect(r).toMatchObject({ since: dayBefore(DAY, 30), observedDays: 30, deadReady: true });
  });

  test("an empty census reports nothing rather than everything", () => {
    const r = buildReport(emptyCensus(), { today: DAY });
    // Day one. With no roster and no observations the honest answer is silence,
    // not a report that indicts the whole surface.
    expect(r).toMatchObject({ dead: [], silent: [], offeredNeverShown: [], alive: 0, rosterSize: 0 });
  });
});

test.describe("⚠ the age guard — a counter cannot report on a window it has not watched", () => {
  /* THIS IS THE DEFECT THIS BLOCK EXISTS FOR, and it shipped for one day.
     Minutes after the flag flip the live wall answered:

         rosterSize: 73   observedKeys: 2   alive: 2   dead: 71   silent: 0

     `dead` was "in the roster and never observed", with nothing anywhere in the
     stored shape recording WHEN counting began — so the report could not tell
     "dead for a month" from "we have been watching for nine minutes". The
     instrument committed its own headline failure, and the damage is not the
     number: a reader who sees 71 dead on day one either panics or learns to
     ignore the report, and being ignored is the unread-telemetry end the
     computed report exists to prevent. */

  /** A wall that has just started counting: three roster keys, one of which
   *  fired today. The other two are NEW, not dead — nobody can know yet. */
  function freshWall(day = DAY) {
    return mergeFeatureDelta(emptyCensus(), {
      day,
      counts: { "attn:plex:offered": 4, "attn:plex:shown": 1 },
      roster: ["attn:plex", "attn:bom", "alert:doorbell"]
    });
  }

  test("day one indicts nothing — the wrong answer here is `dead: 2`", () => {
    const r = buildReport(freshWall(), { today: DAY });
    expect(r.dead).toEqual([]);
    expect(r.deadReady).toBe(false);
    expect(r.since).toBe(DAY);
    expect(r.observedDays).toBe(0);
  });

  test("⚠ withholding the VERDICT must not discard the OBSERVATION", () => {
    // The fix is a demotion, not a deletion. `notYetSeen` is the honest claim —
    // these produced nothing since counting began — and it is what makes the
    // day-one report readable instead of alarming. A guard that simply emptied
    // the list would make the census silent about its own roster for a week.
    const r = buildReport(freshWall(), { today: DAY });
    expect(r.notYetSeen).toEqual(["alert:doorbell", "attn:bom"]);
    expect(r.observedKeys).toBe(2);
  });

  test("the same census, a week later, does say it", () => {
    const r = buildReport(freshWall(), { today: dayBefore(DAY, -DEFAULT_DEAD_DAYS) });
    expect(r.deadReady).toBe(true);
    expect(r.dead).toEqual(["alert:doorbell", "attn:bom"]);
    // And once earned, the two lists are the same list.
    expect(r.dead).toEqual(r.notYetSeen);
  });

  test("the line is at deadDays, and the day before it is still silence", () => {
    const onTheDay = buildReport(freshWall(), { today: dayBefore(DAY, -7), deadDays: 7 });
    const dayBeforeThat = buildReport(freshWall(), { today: dayBefore(DAY, -6), deadDays: 7 });
    expect(onTheDay.deadReady).toBe(true);
    expect(dayBeforeThat.deadReady).toBe(false);
    // deadDays: 0 is the escape hatch for a reader who knows what they have.
    expect(buildReport(freshWall(), { today: DAY, deadDays: 0 }).dead).toHaveLength(2);
  });

  test("⚠ a client with a wrong clock cannot rewind `since` and re-open the guard", () => {
    // A laptop tab with a bad date, or a keepalive flush landing after midnight
    // on a machine set to January. If `since` moved backward the way `seen.first`
    // does, one such flush would hand back the full day-one indictment — the
    // defect returning through a side door.
    let c = freshWall();
    c = mergeFeatureDelta(c, { day: dayBefore(DAY, 90), counts: { "attn:plex:offered": 1 }, roster: [] });
    expect(c.since).toBe(DAY);
    expect(buildReport(c, { today: DAY }).deadReady).toBe(false);
    // ...while `seen.first` is still allowed to move back. Different jobs.
    expect(c.seen["attn:plex:offered"].first).toBe(dayBefore(DAY, 90));
  });

  test("a file written before `since` existed backfills instead of starting over", () => {
    // The live census had been counting for days when this field was added. If
    // an absent `since` read as "today", a fortnight of real observation would
    // be thrown away and every verdict withheld for another week.
    const { since, ...legacy } = freshWall(dayBefore(DAY, 20));
    expect(since).toBeTruthy();          // the fixture really did drop the field
    expect(censusSince(legacy)).toBe(dayBefore(DAY, 20));
    const r = buildReport(legacy, { today: DAY });
    expect(r.observedDays).toBe(20);
    expect(r.deadReady).toBe(true);
    // ...and the next flush pins it, so the derivation happens once.
    expect(mergeFeatureDelta(legacy, { day: DAY, counts: {}, roster: [] }).since).toBe(dayBefore(DAY, 20));
  });

  test("the guard counts days across a month boundary, and never counts backwards", () => {
    expect(daysBetween("2026-08-29", "2026-09-05")).toBe(7);
    expect(daysBetween("2026-02-26", "2026-03-01")).toBe(3);
    // A server whose clock is behind the census must report 0 days observed,
    // not a negative one that would satisfy `>= deadDays` on a sign flip.
    expect(daysBetween("2026-08-29", "2026-08-01")).toBe(0);
  });
});

test.describe("⚠ the roster cannot go quietly short", () => {
  const src = (p) => readFileSync(path.join(ROOT, p), "utf8");

  test("SOURCE_NAMES is exactly the `source:` literals in candidateSources.js", () => {
    const found = [...src("src/js/services/candidateSources.js").matchAll(/source:\s*"([^"]+)"/g)]
      .map((m) => m[1]);
    // Hand-written (an adapter that returned null has no candidate to read a
    // name off), so this is the one part of the roster that can rot. An adapter
    // added without a name here would make the census permanently unable to
    // call it dead — silently, which is the failure it exists to catch.
    expect([...new Set(SOURCE_NAMES)].sort()).toEqual([...new Set(found)].sort());
    expect(SOURCE_NAMES).toHaveLength(SOURCES.length);
  });

  test("the intent roster covers every id the lane can produce", () => {
    const found = [...src("src/js/services/localIntents.js").matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
    /* ⚠ INTENT_IDS is the ANSWERABLE set — local-voice.spec.js asserts every id
       in it has an answerer — and photo.veto/photo.restore ACT instead of
       answering, so they are deliberately absent from it and named separately in
       main.js's roster. This asserts the union is complete, which is what the
       census needs, without pulling those two into a list that would go red for
       an unrelated and correct reason. */
    const declared = new Set([...INTENT_IDS, "photo.veto", "photo.restore"]);
    expect([...new Set(found)].filter((id) => !declared.has(id))).toEqual([]);
  });

  test("main.js declares an announce()-lane source for every one that exists", () => {
    const announced = [
      ...src("src/v3/core/arrival.js").matchAll(/source:\s*"([^"]+)"/g),
      ...src("src/v3/core/health.js").matchAll(/source:\s*"([^"]+)"/g),
      ...src("src/js/services/memoryEngine.js").matchAll(/source:\s*"([^"]+)"/g),
      ...src("src/js/core/personality.js").matchAll(/source:\s*"([^"]+)"/g),
      ...src("src/js/services/predictiveRules.js").matchAll(/SOURCE\s*=\s*"([^"]+)"/g),
      ...src("src/js/services/calendar/holidays.js").matchAll(/source:\s*"([^"]+)"/g)
    ].map((m) => m[1]);

    const main = src("src/v3/main.js");
    for (const s of new Set(announced)) {
      expect(main, `main.js roster is missing the announce() source "${s}"`).toContain(`"${s}"`);
    }
  });

  test("the alert roster is the LOCATIONS table's own prefixes", () => {
    // Derived, not written out — a camera added to alertRouter is in the roster
    // the same moment. Asserted anyway so the derivation cannot be replaced by
    // a literal list in a later edit.
    expect(LOCATIONS.map((l) => l.prefix)).toEqual(["doorbell", "side_gate"]);
    expect(src("src/v3/main.js")).toContain("LOCATIONS.map");
  });
});

test.describe("⚠⚠ the instrument must not reproduce the bug it catches", () => {
  test("every roster key survives minification as a string literal", () => {
    /* `SOURCES` is an array of NAMED function references, so `fn.name` looks
       like free, code-derived identity — and it is renamed by the minifier:

           $ grep -c "bomCandidate" dist/assets/v3-*.js
           0

       A census keyed on it would be perfect in dev, perfect in every spec above,
       and garbage on the wall. This reads the BUILT bundle so that trap cannot
       come back. ⚠ Needs `npm run build`, and it searches EVERY chunk —
       candidateSources and localIntents land in the shared entityFeed chunk, not
       in v3-*.js. */
    const dir = path.join(ROOT, "dist", "assets");
    const bundle = readdirSync(dir).filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");

    // The function names must NOT be there — if they are, the bundle is not
    // minified and this test is not testing what it claims to.
    expect(bundle).not.toContain("bomCandidate");

    const names = [
      ...SOURCE_NAMES,
      ...INTENT_IDS,
      "photo.veto", "photo.restore",
      ...LOCATIONS.map((l) => l.prefix)
    ];
    const missing = names.filter((n) => !bundle.includes(`"${n}"`));
    expect(missing, "roster names absent from the built bundle").toEqual([]);
  });
});

test.describe("wired to the wall", () => {
  test("flag off: no handle, no interval, no request", async ({ page }) => {
    const seen = [];
    // Registered before boot on purpose — a listener added after an async load
    // has already missed the thing it was watching for.
    page.on("request", (r) => { if (r.url().includes("/api/census/features")) seen.push(r.url()); });

    /* ⚠ PINNED OFF EXPLICITLY, not left to the default. This asserts the
       ROLLBACK PATH, so it has to keep testing that whichever way the default
       points — written while the default was false, and inheriting it would
       turn this into a test of nothing the day it is flipped. */
    const { pageErrors } = await bootV3(page, {}, { features: { v3FeatureCensus: false } });
    await page.evaluate(() => window.__v3Subject("show.status"));

    expect(await page.evaluate(() => typeof window.__v3Features)).toBe("undefined");
    expect(await page.evaluate(() => typeof window.__v3FeaturesFlush)).toBe("undefined");
    expect(seen).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("flag on: a subject shown on the page arrives at the route, with the roster", async ({ page }) => {
    const posted = [];
    /* ⚠ THE SUBJECT NEEDS ITS UPSTREAM STUBBED OR IT RECORDS `empty`, NOT
       `shown` — measured: under the bare fixture show.status, show.list and
       show.year all return false, because every route they need is answered
       503. That is the census being RIGHT (a subject asked for and unable to
       draw is exactly what `empty` means), and it would have made this test
       assert the wrong path while looking like a broken feature. */
    const { pageErrors } = await bootV3(page, { "/api/calendar/all": calToday() },
      { features: { v3FeatureCensus: true } });
    await page.evaluate(() => window.__v3Refresh());

    /* ⚠ Registered AFTER bootV3, which installs a catch-all `**​/api/**`.
       page.route() matches the LAST-registered handler first — reverse the
       order and the POST is answered 503 by the fixture and this asserts
       nothing. */
    await page.route("**/api/census/features", async (route) => {
      if (route.request().method() === "POST") posted.push(JSON.parse(route.request().postData()));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.evaluate(() => window.__v3Subject("show.day"));
    await page.evaluate(() => window.__v3Subject("show.status"));
    await page.evaluate(() => window.__v3FeaturesFlush());

    expect(posted).toHaveLength(1);
    const [body] = posted;
    expect(body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The day mounts against the stubbed calendar — the `shown` path.
    expect(body.counts["subject:show.day:shown"]).toBe(1);
    // And the status cannot, because its feed is 503 here — the `empty` path.
    // Both in one flush, because the whole point of counting them apart is
    // that a subject which is always empty looks busy from any other angle.
    expect(body.counts["subject:show.status:empty"]).toBe(1);
    // The roster rides the first accepted flush, or the report can never say
    // "dead" — see the module header.
    expect(body.roster).toContain("attn:bom");
    expect(body.roster).toContain("subject:show.status");
    expect(body.roster).toContain("alert:doorbell");
    expect(pageErrors).toEqual([]);
  });

  test("an intent matched by the voice lane is counted under its own id", async ({ page }) => {
    const posted = [];
    await bootV3(page, {}, { features: { v3FeatureCensus: true, voiceSession: false } });
    await page.route("**/api/census/features", async (route) => {
      if (route.request().method() === "POST") posted.push(JSON.parse(route.request().postData()));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.evaluate(() => window.__v3Transcript("what time is it"));
    await page.waitForFunction(() => Object.keys(window.__v3Features().counts).length > 0);
    await page.evaluate(() => window.__v3FeaturesFlush());

    expect(posted).toHaveLength(1);
    expect(posted[0].counts["intent:time.now:matched"]).toBe(1);
  });
});
