import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  buildHouseClaims,
  coverageOf,
  recordDay,
  occupancyClaims,
  humanise,
  GROUPS,
  MIN_DAYS,
  MIN_AWAKE_MS,
  MIN_EVENTS,
  QUIET_MIN_DAYS
} from "../server/services/houseLately.js";
import {
  foldSample,
  foldTransition,
  emptyStore,
  personIdOf,
  loadStore,
  startOccupancyDays,
  __resetOccupancy,
  MAX_DAYS,
  MAX_PEOPLE,
  MIN_SPELL_MS
} from "../server/services/occupancyDays.js";
import { houseLatelyContext } from "../server/services/voiceShape.js";

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE LATELY — what the wall's own counting will let it claim.

   docs/AUGUST-IMPROVEMENTS.md §4.6, "the larger half". Pure: no server, no
   clock; the sampler's tests get a temp dir and a fake manager.

   ⚠ EVERY TEST HERE IS WRITTEN AGAINST A SPECIFIC WRONG ANSWER, the way
   lately.spec.js is, and for the sharper version of the same reason: a claim
   about the HOUSE fails silently AND sounds true. "Nothing has come to the door
   in eleven days" is a perfectly good sentence whether or not it happened. The
   wrong answers pinned below are the ones this implementation could really give:

     - counting a day the WALL WAS ASLEEP as a day nothing happened
     - saying a counter that has NEVER FIRED has been quiet
     - answering on day one, before there is a window to be quiet within
     - calling a one-event lead, or a two-event day, a record
     - reading a window from the depth census that the feature census never had
     - a sampler that INTEGRATES minutes and so loses them on every restart
   ═══════════════════════════════════════════════════════════════════════════ */

const FULL_DAY = 20 * 60 * 60 * 1000; // comfortably over MIN_AWAKE_MS

/** N consecutive days ending the day before `today`. */
function daysEnding(today, n) {
  const out = [];
  const [y, m, d] = today.split("-").map(Number);
  for (let i = n; i >= 1; i--) {
    out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  }
  return out;
}

/** A depth census where every listed day was awake for `awakeMs`. */
const depthOf = (days, awakeMs = FULL_DAY) => ({
  days: Object.fromEntries(days.map((day) => [day, { entries: [1, 0, 0, 0], dwellMs: [awakeMs, 0, 0, 0] }]))
});

/** A feature census. `counts` is {day: {key: n}}; `seen` is derived unless given. */
function featuresOf(days, counts, { roster = ["alert:doorbell"], since = days[0], seen } = {}) {
  const derived = {};
  for (const day of Object.keys(counts)) {
    for (const [key, n] of Object.entries(counts[day])) {
      if (!n) continue;
      derived[key] ??= { first: day, last: day, total: 0 };
      derived[key].last = day > derived[key].last ? day : derived[key].last;
      derived[key].first = day < derived[key].first ? day : derived[key].first;
      derived[key].total += n;
    }
  }
  return { days: counts, seen: seen ?? derived, roster, since };
}

const TODAY = "2026-09-01";
const WEEK = daysEnding(TODAY, 8); // 8 days, so one can be dropped and still clear MIN_DAYS

/* ───────────────────────────────────────────────────────────────────────────
   COVERAGE — the denominator, and the trap this module exists for.
─────────────────────────────────────────────────────────────────────────── */

test.describe("coverage — a sleeping wall is not a quiet house", () => {
  test("sums dwellMs across all four depths", () => {
    const cov = coverageOf({ days: { "2026-08-30": { dwellMs: [10, 20, 30, 40] } } }, { minAwakeMs: 100 });
    expect(cov[0].awakeMs).toBe(100);
    expect(cov[0].covered).toBe(true);
  });

  test("a day under MIN_AWAKE_MS is NOT covered", () => {
    const cov = coverageOf(depthOf(["2026-08-30"], MIN_AWAKE_MS - 1));
    expect(cov[0].covered).toBe(false);
  });

  test("⚠⚠⚠ a day the wall was asleep is a GAP, never a quiet day", () => {
    /* The defect this pins: computing over the feature census alone. On the
       asleep day the doorbell key is simply absent, which reads as "nobody came
       to the door" — and that sentence is the whole product. */
    const asleep = WEEK[3];
    const depth = {
      days: {
        ...depthOf(WEEK).days,
        [asleep]: { entries: [1, 0, 0, 0], dwellMs: [60_000, 0, 0, 0] }
      }
    };
    const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:doorbell:routed": 4 }]));
    delete counts[asleep];

    const claims = buildHouseClaims({ features: featuresOf(WEEK, counts), depth }, { today: TODAY });

    expect(claims.ready).toBe(true);
    // The asleep day is outside the window entirely...
    expect(claims.observedDays).toBe(WEEK.length - 1);
    // ...and its absence is reported as a HOLE, which downgrades the phrasing.
    expect(claims.gapDays).toBe(1);
    expect(claims.continuous).toBe(false);
    expect(claims.scope).toBe(`in ${WEEK.length - 1} days on record`);
    expect(claims.groups.door.scope).not.toContain("since we started counting");
    // And it never became a record for having zero events.
    expect(claims.groups.door.busiest.day).not.toBe(asleep);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   THE FLOOR, and the window the two censuses share.
─────────────────────────────────────────────────────────────────────────── */

test.describe("the floor", () => {
  test("says nothing below MIN_DAYS, and says so honestly", () => {
    const days = daysEnding(TODAY, MIN_DAYS - 1);
    const counts = Object.fromEntries(days.map((d) => [d, { "alert:doorbell:routed": 9 }]));
    const claims = buildHouseClaims(
      { features: featuresOf(days, counts), depth: depthOf(days) },
      { today: TODAY }
    );
    expect(claims.ready).toBe(false);
    expect(claims.groups).toEqual({});
    expect(claims.observedDays).toBe(MIN_DAYS - 1);
    expect(houseLatelyContext(claims)).toBe("");
  });

  test("speaks at exactly MIN_DAYS", () => {
    const days = daysEnding(TODAY, MIN_DAYS);
    const counts = Object.fromEntries(days.map((d) => [d, { "alert:doorbell:routed": 9 }]));
    const claims = buildHouseClaims(
      { features: featuresOf(days, counts), depth: depthOf(days) },
      { today: TODAY }
    );
    expect(claims.ready).toBe(true);
    expect(claims.groups.door.total).toBe(9 * MIN_DAYS);
  });

  test("⚠ the window is the INTERSECTION of the two censuses, not the depth one", () => {
    /* Depth has counted since day one; the feature census only started four
       days ago. The defect: a "nothing came to the door in nine days" built on
       a counter that is four days old. */
    const depthDays = daysEnding(TODAY, 14);
    const featureDays = depthDays.slice(-8);
    const counts = Object.fromEntries(featureDays.map((d) => [d, { "alert:doorbell:routed": 3 }]));
    const claims = buildHouseClaims(
      {
        features: featuresOf(featureDays, counts, { since: featureDays[0] }),
        depth: depthOf(depthDays)
      },
      { today: TODAY }
    );
    expect(claims.since).toBe(featureDays[0]);
    expect(claims.observedDays).toBe(featureDays.length);
  });

  test("today is neither a gap nor a record — it is today", () => {
    const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:doorbell:routed": 2 }]));
    counts[TODAY] = { "alert:doorbell:routed": 400 };
    const claims = buildHouseClaims(
      { features: featuresOf(WEEK, counts), depth: depthOf([...WEEK, TODAY]) },
      { today: TODAY }
    );
    expect(claims.continuous).toBe(true);            // today did not open a hole
    expect(claims.until).toBe(WEEK[WEEK.length - 1]); // nor did it end the window
    expect(claims.groups.door.busiest.day).not.toBe(TODAY);
    expect(claims.today.counts.door).toBe(400);      // but it is still reported
    expect(claims.today.partial).toBe(true);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   QUIET — the claim most likely to be a lie.
─────────────────────────────────────────────────────────────────────────── */

test.describe("quiet", () => {
  const quietSetup = ({ seen, roster } = {}) => {
    const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:side_gate:routed": 5 }]));
    // The doorbell last fired on the third day of the window.
    counts[WEEK[2]]["alert:doorbell:routed"] = 4;
    return buildHouseClaims(
      {
        features: featuresOf(WEEK, counts, {
          roster: roster ?? ["alert:doorbell", "alert:side_gate"],
          seen
        }),
        depth: depthOf(WEEK)
      },
      { today: TODAY }
    );
  };

  test("reports days since the last firing", () => {
    const quiet = quietSetup().groups.door.quiet;
    const doorbell = quiet.find((q) => q.base === "alert:doorbell");
    expect(doorbell).toBeTruthy();
    expect(doorbell.lastDay).toBe(WEEK[2]);
    expect(doorbell.daysSince).toBe(WEEK.length - 2);
  });

  test("⚠⚠ a counter that has NEVER FIRED is not quiet — it is broken", () => {
    /* The defect: deriving "days since" from the absence of a key. A base in
       the roster with no `seen` entry has produced nothing since counting
       began, which routes/censusFeatures.js calls notYetSeen/dead. Saying the
       doorbell has been quiet for eight days about a dead counter is the
       manufactured particular CHARACTER.md:105 bans outright. */
    const claims = quietSetup({
      roster: ["alert:doorbell", "alert:side_gate", "alert:front_yard"],
      seen: { "alert:side_gate:routed": { first: WEEK[0], last: WEEK[7], total: 40 } }
    });
    const bases = claims.groups.door.quiet.map((q) => q.base);
    expect(bases).not.toContain("alert:front_yard"); // never fired
    expect(bases).not.toContain("alert:doorbell");   // no seen entry either
  });

  test("a last-firing OLDER than the window is not a quiet claim", () => {
    /* `seen` is held outside the 30-day window on purpose, so it can name a day
       nothing else in the file covers. The days in between were never observed,
       so "in N days" would be a number about a file rather than about the house. */
    const claims = quietSetup({
      seen: {
        "alert:doorbell:routed": { first: "2026-06-01", last: "2026-06-02", total: 3 },
        "alert:side_gate:routed": { first: WEEK[0], last: WEEK[7], total: 40 }
      }
    });
    expect(claims.groups.door.quiet.map((q) => q.base)).not.toContain("alert:doorbell");
  });

  test("one quiet day is Tuesday, not news — and two is the boundary", () => {
    const at = (lastFiring) => {
      const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:doorbell:routed": 3 }]));
      // Silence from the day after the last firing to the end of the window.
      for (let i = WEEK.indexOf(lastFiring) + 1; i < WEEK.length; i++) counts[WEEK[i]] = {};
      const claims = buildHouseClaims(
        { features: featuresOf(WEEK, counts), depth: depthOf(WEEK) },
        { today: TODAY }
      );
      return claims.groups.door.quiet.find((q) => q.base === "alert:doorbell");
    };

    expect(QUIET_MIN_DAYS).toBe(2);
    // Yesterday — daysSince 1. Not a fact about the house.
    expect(at(WEEK[WEEK.length - 1])).toBeUndefined();
    // The day before — daysSince 2. Now it is worth saying, and only just.
    expect(at(WEEK[WEEK.length - 2])?.daysSince).toBe(2);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   RECORDS — a thin lead is a number, not a superlative.
─────────────────────────────────────────────────────────────────────────── */

test.describe("records", () => {
  test("a lead of one is not clear", () => {
    const r = recordDay([{ day: "2026-08-30", n: 9 }, { day: "2026-08-29", n: 9 }]);
    expect(r.value).toBe(9);
    expect(r.lead).toBe(0);
    expect(r.clear).toBe(false);
  });

  test("⚠ a two-event day does not become a record just by winning", () => {
    const r = recordDay([{ day: "2026-08-30", n: 2 }, { day: "2026-08-29", n: 0 }]);
    expect(r.value).toBe(2);
    expect(r.lead).toBe(2);
    expect(MIN_EVENTS).toBe(3);
    expect(r.clear).toBe(false); // won the field, still under the floor
  });

  test("a real record is clear, and keeps its lead", () => {
    const r = recordDay([{ day: "2026-08-30", n: 12 }, { day: "2026-08-29", n: 4 }]);
    expect(r.clear).toBe(true);
    expect(r.lead).toBe(8);
  });

  test("no events at all is no record, not a record of zero", () => {
    expect(recordDay([{ day: "2026-08-30", n: 0 }, { day: "2026-08-29", n: 0 }])).toBeNull();
    expect(recordDay([])).toBeNull();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   GROUPS — the outcome matters as much as the namespace.
─────────────────────────────────────────────────────────────────────────── */

test.describe("groups", () => {
  test("⚠ `dropped` is not `routed` — the doorbell rang and the house said nothing", () => {
    /* Measured on the live box: 122 alert:doorbell:dropped. Counting those as
       "the house told you about someone at the door" would be false, and it is
       the single easiest mistake to make in the GROUPS table. */
    const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:doorbell:dropped": 20 }]));
    const claims = buildHouseClaims(
      { features: featuresOf(WEEK, counts), depth: depthOf(WEEK) },
      { today: TODAY }
    );
    expect(claims.groups.door.total).toBe(0);
  });

  test("every group in the table is present once ready", () => {
    const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:doorbell:routed": 5 }]));
    const claims = buildHouseClaims(
      { features: featuresOf(WEEK, counts), depth: depthOf(WEEK) },
      { today: TODAY }
    );
    expect(Object.keys(claims.groups).sort()).toEqual(GROUPS.map((g) => g.group).sort());
  });

  test("only roster bases count — an unknown key cannot invent a subject", () => {
    const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:mystery:routed": 50 }]));
    const claims = buildHouseClaims(
      { features: featuresOf(WEEK, counts, { roster: ["alert:doorbell"] }), depth: depthOf(WEEK) },
      { today: TODAY }
    );
    expect(claims.groups.door.total).toBe(0);
  });

  test("⚠⚠⚠ A YOUNGER COUNTER GETS A YOUNGER WINDOW — the census-wide phrase is not free", () => {
    /* The `spoke:*` taps shipped six days after the feature census started.
       Computed over the census-wide window the spoken group carried
       `overDays: 7` and "since we started counting" against a counter four days
       old — three of those days were structurally incapable of holding an
       event. The COUNT is true and the WINDOW around it is false, and the
       window is the half that turns a number into a superlative. */
    const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:doorbell:routed": 4 }]));
    // The spoken lane only starts on the last three days of the window.
    const late = WEEK.slice(-3);
    for (const d of late) counts[d]["spoke:voice:said"] = 5;

    const claims = buildHouseClaims(
      {
        features: featuresOf(WEEK, counts, { roster: ["alert:doorbell", "spoke:voice"] }),
        depth: depthOf(WEEK)
      },
      { today: TODAY }
    );

    expect(claims.ready).toBe(true);
    // The old lane still speaks over the whole record...
    expect(claims.groups.door.observedDays).toBe(WEEK.length);
    expect(claims.groups.door.scope).toBe("since we started counting");
    // ...and the young one is honest about being young.
    expect(claims.groups.spoke.since).toBe(late[0]);
    expect(claims.groups.spoke.observedDays).toBe(3);
    expect(claims.groups.spoke.scope).toBe("in 3 days on record");
    expect(claims.groups.spoke.scope).not.toContain("since we started counting");
    // Its total counts only its own days — 3 × 5, never 7 × 5.
    expect(claims.groups.spoke.total).toBe(15);
    // And under the floor it earns no superlative at all.
    expect(claims.groups.spoke.busiest).toBeNull();
  });

  test("a group that has counted the whole time keeps the census-wide phrase", () => {
    const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:doorbell:routed": 4 }]));
    counts[WEEK[1]]["alert:doorbell:routed"] = 30;
    const claims = buildHouseClaims(
      { features: featuresOf(WEEK, counts), depth: depthOf(WEEK) },
      { today: TODAY }
    );
    expect(claims.groups.door.since).toBe(WEEK[0]);
    expect(claims.groups.door.observedDays).toBe(WEEK.length);
    expect(claims.groups.door.busiest.scope).toBe("since we started counting");
    expect(claims.groups.door.busiest.day).toBe(WEEK[1]);
  });

  test("a group nothing has ever been observed for reports zeroes, not a window", () => {
    const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:doorbell:routed": 4 }]));
    const claims = buildHouseClaims(
      {
        features: featuresOf(WEEK, counts, { roster: ["alert:doorbell", "spoke:voice"] }),
        depth: depthOf(WEEK)
      },
      { today: TODAY }
    );
    expect(claims.groups.spoke.total).toBe(0);
    expect(claims.groups.spoke.since).toBeNull();
    expect(claims.groups.spoke.observedDays).toBe(0);
    expect(claims.groups.spoke.scope).toBeNull();
    expect(claims.groups.spoke.busiest).toBeNull();
    // ...and it contributes nothing to the prompt rather than a row of zeroes.
    expect(houseLatelyContext(claims)).not.toContain("speaking out loud");
  });

  test("humanise strips the namespace and the underscores", () => {
    expect(humanise("alert:side_gate")).toBe("side gate");
    expect(humanise("intent:cal.next")).toBe("cal.next");
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   THE PROMPT — hand over numbers, never the comparison.
─────────────────────────────────────────────────────────────────────────── */

test.describe("houseLatelyContext", () => {
  const ready = () => {
    const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:doorbell:routed": 4 }]));
    counts[WEEK[1]]["alert:doorbell:routed"] = 30;
    return buildHouseClaims(
      { features: featuresOf(WEEK, counts), depth: depthOf(WEEK) },
      { today: TODAY }
    );
  };

  test("silent when not ready", () => {
    expect(houseLatelyContext(null)).toBe("");
    expect(houseLatelyContext({ ready: false })).toBe("");
  });

  test("states the window and forbids borrowing a longer one", () => {
    const text = houseLatelyContext(ready());
    expect(text).toContain(`${WEEK.length} day(s) the wall was actually awake`);
    expect(text).toContain(WEEK[0]);
    expect(text).toContain("never say nothing happened on one");
  });

  test("⛔ says outright that none of it may be volunteered", () => {
    /* The split unresolved.js:36-45 draws and phase-8-learn.md:81 makes
       absolute. It is in the PROMPT rather than left to tone, because the model
       cannot infer a ban from a list of numbers. */
    expect(houseLatelyContext(ready())).toContain("NEVER VOLUNTEER");
  });

  test("a record that is not clear is handed over WITHOUT the word", () => {
    const counts = Object.fromEntries(WEEK.map((d) => [d, { "alert:doorbell:routed": 4 }]));
    const claims = buildHouseClaims(
      { features: featuresOf(WEEK, counts), depth: depthOf(WEEK) },
      { today: TODAY }
    );
    expect(claims.groups.door.busiest.clear).toBe(false); // every day tied at 4
    expect(houseLatelyContext(claims)).toContain("too close to call a record");
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   OCCUPANCY — samples, never durations.
─────────────────────────────────────────────────────────────────────────── */

test.describe("occupancyDays — the writer", () => {
  const states = (greg, brett) => [
    { entity_id: "person.greg_dee", state: greg },
    { entity_id: "person.brett", state: brett },
    { entity_id: "sensor.kitchen_temperature", state: "21.4" }
  ];

  test("personIdOf accepts only the person domain", () => {
    expect(personIdOf("person.greg_dee")).toBe("greg_dee");
    expect(personIdOf("device_tracker.greg_phone")).toBeNull();
    expect(personIdOf("sensor.person_count")).toBeNull();
  });

  test("counts one sample per person per call, and ignores everything else", () => {
    const store = emptyStore();
    foldSample(store, states("home", "not_home"), "2026-09-01");
    foldSample(store, states("home", "home"), "2026-09-01");
    const row = store.days["2026-09-01"];
    expect(row.samples).toBe(2);
    expect(row.people.greg_dee).toEqual({ home: 2, away: 0, unknown: 0, arrivals: 0, departures: 0 });
    expect(row.people.brett.home).toBe(1);
    expect(row.people.brett.away).toBe(1);
    expect(Object.keys(row.people)).toHaveLength(2); // the sensor is not a person
  });

  test("⚠⚠⚠ HOME ASSISTANT DOWN: a round that saw NOBODY is not a sample of an empty house", () => {
    /* FOUND ON THE LIVE G11, two minutes after this shipped. HA was down —
       every call 504ing, the websocket `disconnected` — so getStates() returned
       [], and the first version of foldSample counted it, writing
       {samples: 1, people: {}}.

       `samples` is the denominator houseLately.js reads to decide how well a
       day was observed. An hour of outage writes samples: 12 with nobody in it,
       and the day then reads as WELL OBSERVED AND EMPTY — the sleeping-wall
       trap this whole lane exists to avoid, reproduced inside the writer built
       to avoid it. A blind round is counted as blind and nothing else. */
    const store = emptyStore();
    for (let i = 0; i < 12; i++) foldSample(store, [], "2026-09-01");         // HA down
    foldSample(store, [{ entity_id: "sensor.kitchen_temperature", state: "21" }], "2026-09-01");

    const row = store.days["2026-09-01"];
    expect(row.samples).toBe(0);
    expect(row.blind).toBe(13);
    expect(row.people).toEqual({});
    // ...and an outage must not date the record either.
    expect(store.since).toBeNull();
  });

  test("a blind day never becomes an observed day in the reader", () => {
    const days = daysEnding(TODAY, MIN_DAYS);
    const store = { days: {}, since: days[0] };
    for (const day of days) {
      store.days[day] = {
        samples: 288,
        blind: 0,
        people: { greg_dee: { home: 288, away: 0, arrivals: 0, departures: 0 } }
      };
    }
    // One day HA was down all day: rounds ran, nobody was ever visible.
    store.days[days[2]] = { samples: 0, blind: 288, people: {} };

    const claims = occupancyClaims(store, { today: TODAY });
    expect(claims.observedDays).toBe(MIN_DAYS - 1);
    expect(claims.ready).toBe(false); // and that drops it back under the floor
  });

  test("an unavailable tracker is UNKNOWN, never away", () => {
    /* healthService.occupancyFrom's reasoning, and it matters: recording an
       integration outage as "away" turns a broken tracker into a claim about
       where somebody was. */
    const store = emptyStore();
    foldSample(store, states("unavailable", "unknown"), "2026-09-01");
    expect(store.days["2026-09-01"].people.greg_dee.unknown).toBe(1);
    expect(store.days["2026-09-01"].people.greg_dee.away).toBe(0);
  });

  test("🔑 A RESTART LOSES AT MOST ONE SAMPLE — the whole reason this counts rather than integrates", () => {
    /* The defect this pins is the one weatherHistory.js had to be fixed for:
       an accumulator that resets on restart writes a NARROWER day and it does
       not look like a bug, it looks like a quieter one. The kiosk restarts
       ~7.6x a day. Counters cannot have it. */
    const store = emptyStore();
    for (let i = 0; i < 10; i++) foldSample(store, states("home", "home"), "2026-09-01");
    const before = JSON.parse(JSON.stringify(store.days["2026-09-01"]));

    // "Restart": a fresh process loads the same file and keeps going.
    const reloaded = { ...emptyStore(), days: JSON.parse(JSON.stringify(store.days)) };
    for (let i = 0; i < 5; i++) foldSample(reloaded, states("home", "home"), "2026-09-01");

    expect(reloaded.days["2026-09-01"].samples).toBe(before.samples + 5);
    expect(reloaded.days["2026-09-01"].people.greg_dee.home).toBe(before.people.greg_dee.home + 5);
  });

  test("transitions count only real edges", () => {
    const store = emptyStore();
    const T0 = Date.parse("2026-09-01T08:00:00Z");
    const HOUR = 3600_000;
    // Witness the spell first — an edge with nothing behind it is not a journey.
    const witness = (state, t) =>
      foldSample(store, [{ entity_id: "person.greg_dee", state }], "2026-09-01", t);
    const at = (from, to, t) =>
      foldTransition(store, { entityId: "person.greg_dee", from, to }, "2026-09-01", t);

    witness("not_home", T0);
    at("not_home", "home", T0 + HOUR);        // an arrival, an hour out
    witness("home", T0 + HOUR);
    at("home", "not_home", T0 + 2 * HOUR);    // a departure, an hour in
    at("home", "home", T0 + 3 * HOUR);        // an attribute-only re-emit
    at("unavailable", "home", T0 + 4 * HOUR); // ⚠ an HA restart, not a journey
    at("home", "unknown", T0 + 5 * HOUR);     // a tracker dropping out

    const person = store.days["2026-09-01"].people.greg_dee;
    expect(person.arrivals).toBe(1);
    expect(person.departures).toBe(1);
  });

  test("⚠⚠⚠ HA RESTORING STATE IS NOT A HOMECOMING — the edge is well-formed and never happened", () => {
    /* FOUND ON THE LIVE G11. HA came back from a 19-minute outage and BOTH
       people flipped to `home` in the same instant, each from their own iPhone
       tracker. The edge HA emitted was a textbook `not_home -> home`, so the
       from/to guard could not see it: THERE IS NOTHING WRONG WITH THE EDGE.

       The spell before it is the evidence. We had witnessed both of them HOME
       before the outage and were blind through it, so an edge claiming they
       were out is HA telling us about a gap we could not see. */
    const store = emptyStore();
    const T0 = Date.parse("2026-09-01T07:00:00Z");
    for (const id of ["greg_dee", "brett"]) {
      foldSample(store, [{ entity_id: `person.${id}`, state: "home" }], "2026-09-01", T0);
    }
    // ...19 minutes of blind rounds, HA down, nothing witnessed...
    for (let i = 0; i < 4; i++) foldSample(store, [], "2026-09-01", T0 + i * 300_000);
    // ...then HA restores both trackers at the same instant.
    for (const id of ["greg_dee", "brett"]) {
      foldTransition(
        store, { entityId: `person.${id}`, from: "not_home", to: "home" }, "2026-09-01", T0 + 19 * 60_000
      );
    }

    expect(store.days["2026-09-01"].people.greg_dee.arrivals).toBe(0);
    expect(store.days["2026-09-01"].people.brett.arrivals).toBe(0);
  });

  test("a spell shorter than MIN_SPELL_MS is a flap, not a journey", () => {
    /* iphonedetect produced 27 false arrivals in five days by flapping person
       entities away and back within seconds. arrival.js:44 guards the glass
       against it; this guards the count, with the same number. */
    const store = emptyStore();
    const T0 = Date.parse("2026-09-01T08:00:00Z");
    foldSample(store, [{ entity_id: "person.greg_dee", state: "not_home" }], "2026-09-01", T0);
    foldTransition(store, { entityId: "person.greg_dee", from: "not_home", to: "home" },
      "2026-09-01", T0 + MIN_SPELL_MS - 1);
    expect(store.days["2026-09-01"]?.people?.greg_dee?.arrivals ?? 0).toBe(0);

    // One millisecond later it is a journey.
    const ok = emptyStore();
    foldSample(ok, [{ entity_id: "person.greg_dee", state: "not_home" }], "2026-09-01", T0);
    foldTransition(ok, { entityId: "person.greg_dee", from: "not_home", to: "home" },
      "2026-09-01", T0 + MIN_SPELL_MS);
    expect(ok.days["2026-09-01"].people.greg_dee.arrivals).toBe(1);
  });

  test("🔑 the witness survives a restart, so a redeploy does not eat a real arrival", async () => {
    /* The in-memory version of this guard would have been worse than the bug:
       this box redeploys ~7.6 times a day, and a witness that reset on boot
       would refuse every genuine arrival that happened to follow one.

       ⚠ THIS GOES THROUGH loadStore() ON PURPOSE. The first version of this
       test round-tripped the store with JSON.stringify in the test body, and
       injecting the defect into loadStore left it GREEN — because it never
       reached loadStore, which is the function that actually enforces the rule. */
    const dir = await mkdtemp(path.join(tmpdir(), "occ-witness-"));
    const file = path.join(dir, "occupancy-days.json");
    __resetOccupancy({ file });
    try {
      const T0 = Date.parse("2026-09-01T08:00:00Z");
      const before = emptyStore();
      foldSample(before, [{ entity_id: "person.greg_dee", state: "not_home" }], "2026-09-01", T0);
      await writeFile(file, JSON.stringify(before), "utf8");

      // The deploy: a fresh process reads the store off disk.
      const after = await loadStore();
      expect(after.witness.greg_dee.state).toBe("not_home");
      expect(after.witness.greg_dee.at).toBe(T0);

      foldTransition(after, { entityId: "person.greg_dee", from: "not_home", to: "home" },
        "2026-09-01", T0 + 3600_000);
      expect(after.days["2026-09-01"].people.greg_dee.arrivals).toBe(1);
    } finally {
      __resetOccupancy();
    }
  });

  test("an unverifiable edge advances the witness rather than wedging the guard shut", () => {
    /* If a refused edge left the witness stale, the FIRST unverifiable edge
       would silently disable arrival counting for good. */
    const store = emptyStore();
    const T0 = Date.parse("2026-09-01T08:00:00Z");
    // Nothing witnessed yet: HA restores `home` out of nowhere. Refused...
    foldTransition(store, { entityId: "person.greg_dee", from: "not_home", to: "home" }, "2026-09-01", T0);
    expect(store.days["2026-09-01"]?.people?.greg_dee?.arrivals ?? 0).toBe(0);
    expect(store.witness.greg_dee.state).toBe("home");
    // ...but the house keeps working: a real departure and return still count.
    foldTransition(store, { entityId: "person.greg_dee", from: "home", to: "not_home" },
      "2026-09-01", T0 + 3600_000);
    foldTransition(store, { entityId: "person.greg_dee", from: "not_home", to: "home" },
      "2026-09-01", T0 + 7200_000);
    expect(store.days["2026-09-01"].people.greg_dee.departures).toBe(1);
    expect(store.days["2026-09-01"].people.greg_dee.arrivals).toBe(1);
  });

  test("⚠ an HA restart does not fill the house with arrivals", () => {
    /* Measured on the live box: after an HA restart all 698 entities carried
       the same fresh last_changed. If a recovery from unavailable counted as an
       arrival, every bounce would report everybody coming home. */
    const store = emptyStore();
    for (const id of ["person.greg_dee", "person.brett"]) {
      foldTransition(store, { entityId: id, from: undefined, to: "home" }, "2026-09-01");
      foldTransition(store, { entityId: id, from: "unavailable", to: "home" }, "2026-09-01");
    }
    expect(store.days["2026-09-01"]).toBeUndefined();
  });

  test("since is write-once and is never moved", () => {
    const store = emptyStore();
    foldSample(store, states("home", "home"), "2026-08-30");
    expect(store.since).toBe("2026-08-30");
    foldSample(store, states("home", "home"), "2026-08-01"); // a client with a bad clock
    expect(store.since).toBe("2026-08-30");
  });

  test("people are capped", () => {
    const store = emptyStore();
    const crowd = Array.from({ length: MAX_PEOPLE + 4 }, (_, i) => ({
      entity_id: `person.p${i}`,
      state: "home"
    }));
    foldSample(store, crowd, "2026-09-01");
    expect(Object.keys(store.days["2026-09-01"].people)).toHaveLength(MAX_PEOPLE);
  });

  test("the store round-trips through disk and prunes to MAX_DAYS", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "occ-"));
    const file = path.join(dir, "occupancy-days.json");
    __resetOccupancy({ file });
    try {
      const store = emptyStore();
      for (let i = 0; i < MAX_DAYS + 5; i++) {
        foldSample(store, states("home", "away"), `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`);
      }
      await writeFile(file, JSON.stringify(store), "utf8");
      const loaded = await loadStore();
      expect(Object.keys(loaded.days).length).toBe(MAX_DAYS + 5); // load does not prune
      expect(JSON.parse(await readFile(file, "utf8")).since).toBe(store.since);
    } finally {
      __resetOccupancy();
    }
  });

  test("an unreadable store is an empty one, not a throw", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "occ-"));
    __resetOccupancy({ file: path.join(dir, "nope.json") });
    try {
      expect(await loadStore()).toEqual(emptyStore());
    } finally {
      __resetOccupancy();
    }
  });

  test("inert without an HA manager — a box with no people writes nothing", () => {
    __resetOccupancy();
    expect(startOccupancyDays({ manager: null })).toBeNull();
  });

  test("🔑 END TO END: given a manager it samples on start and the file appears", async () => {
    /* The test the unit tests above cannot be a substitute for. Every piece of
       arithmetic here is proven pure, and a writer that is never actually
       CALLED produces exactly the same green suite — which is the failure this
       whole lane exists to catch (a feature live, green and dead at once).
       So: a fake manager, a real interval, a real file. */
    const dir = await mkdtemp(path.join(tmpdir(), "occ-live-"));
    const file = path.join(dir, "occupancy-days.json");
    __resetOccupancy({ file });

    const handlers = {};
    const manager = {
      getStates: () => [
        { entity_id: "person.greg_dee", state: "home" },
        { entity_id: "person.brett", state: "not_home" }
      ],
      on: (event, fn) => { handlers[event] = fn; }
    };

    try {
      expect(startOccupancyDays({ manager, sampleMs: 60_000 })).toBeTruthy();
      await expect.poll(async () => {
        try { return Object.keys(JSON.parse(await readFile(file, "utf8")).days).length; }
        catch { return 0; }
      }, { timeout: 5000 }).toBeGreaterThan(0);

      const written = JSON.parse(await readFile(file, "utf8"));
      const day = Object.keys(written.days)[0];
      expect(written.days[day].samples).toBeGreaterThanOrEqual(1);
      expect(written.days[day].people.greg_dee.home).toBeGreaterThanOrEqual(1);
      expect(written.days[day].people.brett.away).toBeGreaterThanOrEqual(1);
      expect(written.since).toBe(day);

      // And the transition lane is really subscribed, not just declared.
      expect(typeof handlers.event).toBe("function");
      handlers.event({
        eventType: "state_changed",
        data: {
          entity_id: "person.brett",
          old_state: { state: "not_home" },
          new_state: { entity_id: "person.brett", state: "home" }
        }
      });
      /* ⚠ ASSERTED ON THE WITNESS, NOT ON `arrivals` — and the difference is
         the point. This edge lands seconds after the boot sample witnessed
         brett as `not_home`, so foldTransition correctly REFUSES it as a flap
         (MIN_SPELL_MS). The witness advances either way, which is what proves
         the handler is genuinely wired to the manager; asserting arrivals: 1
         here would only pass by disabling the guard that exists because HA
         restoring state looked exactly like a homecoming on the live box. */
      await expect.poll(async () => {
        try { return JSON.parse(await readFile(file, "utf8")).witness?.brett?.state; }
        catch { return null; }
      }, { timeout: 5000 }).toBe("home");
      const settled = JSON.parse(await readFile(file, "utf8"));
      expect(settled.days[day].people.brett.arrivals).toBe(0);
    } finally {
      __resetOccupancy();
    }
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   OCCUPANCY — the reader.
─────────────────────────────────────────────────────────────────────────── */

test.describe("occupancyClaims", () => {
  const store = (days) => {
    const out = { days: {}, since: days[0] };
    for (const day of days) {
      out.days[day] = {
        samples: 288,
        people: { greg_dee: { home: 288, away: 0, arrivals: 0, departures: 0 } }
      };
    }
    return out;
  };

  test("silent below the floor", () => {
    const claims = occupancyClaims(store(daysEnding(TODAY, MIN_DAYS - 1)), { today: TODAY });
    expect(claims.ready).toBe(false);
    expect(claims.people).toEqual([]);
  });

  test("⚠ ON DAY ONE IT STILL KNOWS ABOUT TODAY — the floor governs the RECORD, not the room", () => {
    /* Measured live on the sampler's first day: `past` was empty, so the early
       return fired with `today: null` while the store held 22 real samples of
       both people home. The one thing it could honestly answer, discarded. */
    const s = { days: {}, since: TODAY };
    s.days[TODAY] = {
      samples: 22, blind: 9,
      people: {
        greg_dee: { home: 22, away: 0, arrivals: 0, departures: 0 },
        brett: { home: 22, away: 0, arrivals: 0, departures: 0 }
      }
    };
    const claims = occupancyClaims(s, { today: TODAY });

    expect(claims.ready).toBe(false);      // no record yet, and it says so
    expect(claims.observedDays).toBe(0);
    expect(claims.people).toEqual([]);
    expect(claims.today).not.toBeNull();   // ...but today is not the record
    expect(claims.today.samples).toBe(22);
    expect(claims.today.blind).toBe(9);
    expect(claims.today.people.greg_dee.home).toBe(22);
    expect(claims.today.people.brett.home).toBe(22);
  });

  test("counts days home and days out, and never today", () => {
    const s = store(daysEnding(TODAY, MIN_DAYS));
    const away = Object.keys(s.days)[0];
    s.days[away].people.greg_dee = { home: 0, away: 288, arrivals: 0, departures: 1 };
    s.days[TODAY] = { samples: 4, people: { greg_dee: { home: 4, away: 0 } } };

    const claims = occupancyClaims(s, { today: TODAY });
    expect(claims.ready).toBe(true);
    expect(claims.observedDays).toBe(MIN_DAYS);      // today excluded
    expect(claims.people[0].homeDays).toBe(MIN_DAYS - 1);
    expect(claims.people[0].awayDays).toBe(1);
    expect(claims.people[0].name).toBe("greg dee");
    expect(claims.today.samples).toBe(4);            // but still reported
  });

  test("a day with a single home sample is a day they were home", () => {
    /* Deliberate: samples cannot say how long, only whether. A rule that needed
       a majority of samples would call a late arrival an absence. */
    const s = store(daysEnding(TODAY, MIN_DAYS));
    const day = Object.keys(s.days)[0];
    s.days[day].people.greg_dee = { home: 1, away: 287, arrivals: 1, departures: 0 };
    expect(occupancyClaims(s, { today: TODAY }).people[0].homeDays).toBe(MIN_DAYS);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   COLD START — every input may be missing, and none of it may throw.
─────────────────────────────────────────────────────────────────────────── */

test.describe("cold start", () => {
  test("nothing at all is silence, not an error", () => {
    for (const input of [{}, { features: null, depth: null, occupancy: null }, undefined]) {
      const claims = buildHouseClaims(input, { today: TODAY });
      expect(claims.ready).toBe(false);
      expect(claims.groups).toEqual({});
      expect(houseLatelyContext(claims)).toBe("");
    }
  });

  test("an invalid today is silence", () => {
    expect(buildHouseClaims({ depth: depthOf(WEEK) }, { today: "not-a-day" }).ready).toBe(false);
    expect(buildHouseClaims({ depth: depthOf(WEEK) }, {}).ready).toBe(false);
  });

  test("MIN_DAYS matches lately.js and censusFeatures' DEFAULT_DEAD_DAYS", () => {
    expect(MIN_DAYS).toBe(7);
  });
});
