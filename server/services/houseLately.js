/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE LATELY — what the house has been like, from the counting it already does.

   docs/AUGUST-IMPROVEMENTS.md §4, the half §4.6 calls "the larger half": who was
   home, what was asked, what surfaced, what fired. The doc predicted a second
   writer, because all four looked like browser facts.

   ── 🔑 THREE OF THE FOUR WERE ALREADY BEING COUNTED ─────────────────────────

   data/census/features.json has been recording all of this, day-granular, with
   a sticky per-key {first,last,total} held outside the 30-day window, since
   2026-08-29:

       what surfaced  →  attn:<source>:{offered,hero,shown}, subject:<id>:shown
       what was asked →  intent:<id>:matched
       what fired     →  alert:<prefix>:{routed,dropped}

   Its only reader was buildReport() in routes/censusFeatures.js, which asks an
   ENGINEERING question — which levers are dead. Nobody had ever asked it a
   HOUSE question. So this file is §1's thesis arriving a third time, on data
   that was already on disk: the counting exists and nothing reads it. Same as
   lately.js, which found weatherHistory.js writing a line a day into silence.

   This module is the harvest. It is pure — no clock, no disk. The route hands
   it the three files and today's day-key; it hands back what may honestly be
   said and withholds everything else.

   ── ⚠⚠⚠ THE TRAP THIS DATA HAS AND THE WEATHER RECORD DOES NOT ─────────────

   A SLEEPING WALL LOOKS EXACTLY LIKE A QUIET HOUSE.

   lately.js counts gaps because a day the box was off writes no row. Here it is
   worse than a missing row: the feature census writes NOTHING on a day the
   kiosk was down, the flag was off, or the screen never woke — and "no doorbell
   key today" is then indistinguishable from "nobody came to the door". The
   difference between those two is the entire value of the claim, and the file
   cannot tell them apart on its own.

   So nothing here is computed over the feature census alone. Every claim is
   computed over COVERED days, and coverage comes from the OTHER census:
   data/census/depth.json's dwellMs, which sums to wall-clock awake time per day
   (measured on the live G11: 86.4 M ms on 2026-08-24 — twenty-four hours to
   three significant figures). A day under MIN_AWAKE_MS is a GAP, not a quiet
   day, and it is excluded from every window, every record and every count.

   ⚠⚠ NEVER-FIRED IS NOT QUIET. A key absent from `seen` means the counter has
   never worked, which routes/censusFeatures.js names `notYetSeen`/`dead`. "The
   doorbell has not rung in thirty days" said about a broken counter is exactly
   the manufactured particular CHARACTER.md:105 calls the rule that "outranks
   everything else on this page". A base must be in the ROSTER and carry a
   non-null `seen.last` INSIDE the window before the house may say it has been
   quiet.

   ⚠ THE TWO CENSUSES HAVE DIFFERENT STARTING DAYS — depth from 2026-08-23,
   features from 2026-08-29 — so the window is their INTERSECTION. Without that,
   the house would say "nothing has come to the door in nine days" on the
   strength of a counter that had only existed for four.

   ── ⛔ ANSWERED, NEVER ANNOUNCED ────────────────────────────────────────────

   unresolved.js:36-45 draws the line and this file stays on the right side of
   it. Some of what is here — what was asked, who was home — is an inference
   about the RESIDENTS, which docs/vision/phase-8-learn.md:81 bans from ever
   being volunteered. Nothing in this module becomes an attention candidate or a
   glance line. It is read when somebody asks, and the route that serves it is
   loopback-gated for the same reason /api/house/unresolved is.
   ═══════════════════════════════════════════════════════════════════════════ */

import { daysBetween } from "./lately.js";

/* A week, and for the reason lately.js states: a superlative over four days is
   not a superlative. Matches MIN_DAYS there and DEFAULT_DEAD_DAYS in
   routes/censusFeatures.js — the instrument that reported "dead: 71" of a
   73-key roster on its first morning because it shipped without one. */
export const MIN_DAYS = 7;

/* A third of a day. Below this the wall was not up long enough to testify about
   anything that did or did not happen on it. Live reference: full days run
   54–86 M ms of summed dwell; a day that manages only a few hours is a deploy
   loop or an outage, and counting it as evidence of a quiet house is the exact
   error this constant exists to prevent. */
export const MIN_AWAKE_MS = 8 * 60 * 60 * 1000;

/* MARGIN_C's analogue for integers. Counts cannot differ by 0.1 the way two
   rounded temperatures can, so the tie test is a lead of at least one — but a
   "record" of two against one is still noise dressed as news, so the winning
   day must also clear MIN_EVENTS before the superlative is earned. */
export const MIN_EVENTS = 3;

/* One day without something happening is not a fact about the house, it is
   Tuesday. */
export const QUIET_MIN_DAYS = 2;

/* The prompt has to stay small and the roster is 77 bases and climbing. Ranked
   by total, so what survives the slice is what the house actually does. */
export const MAX_PER_GROUP = 6;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The five groups, each a namespace in the feature census paired with the ONE
 * outcome that means the thing really happened.
 *
 * ⚠ The outcome matters as much as the namespace. `alert:doorbell:dropped` is
 * the doorbell ringing and the house declining to route it — 122 of those on
 * the live box against zero `routed`. Counting dropped as "someone at the door"
 * would be true; counting it as "the house told you" would not.
 *
 * Derived from the roster the CLIENT declares, never from a hand-written list
 * of locations or intents here — that list would drift the day a location is
 * added, and drift silently, which is the failure this whole lane exists to end.
 */
export const GROUPS = [
  { group: "door", ns: "alert", outcome: "routed", label: "something at a door or gate" },
  { group: "asked", ns: "intent", outcome: "matched", label: "a question the house understood" },
  { group: "surfaced", ns: "attn", outcome: "shown", label: "a card that reached the glass" },
  { group: "opened", ns: "subject", outcome: "shown", label: "a screen the house opened" },
  { group: "spoke", ns: "spoke", outcome: "said", label: "the house speaking out loud" }
];

const isDay = (s) => typeof s === "string" && DAY_RE.test(s);
const count = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** `alert:side_gate` → `side gate`. The key travels too; this is only so the
 *  phrasing layer is not handed an identifier to read aloud. */
export function humanise(base) {
  const name = String(base ?? "").split(":").slice(1).join(":");
  return name.replace(/_/g, " ");
}

/**
 * Wall-awake milliseconds per day, from the depth census.
 *
 * 🔑 This is the denominator the feature census does not have. `dwellMs` is
 * four numbers — one per depth — and they sum to the time the page was alive
 * that day, because every millisecond the surface exists it is at some depth.
 *
 * ⚠ TODAY IS EXCLUDED BY THE CALLER, NOT HERE. Today is always partial, and a
 * partial day is neither a gap nor a full day — it is today. Folding it in
 * either direction is wrong: as a gap it breaks `continuous` every afternoon,
 * as a full day it under-counts every record it competes for.
 */
export function coverageOf(depth, { minAwakeMs = MIN_AWAKE_MS } = {}) {
  const days = depth?.days && typeof depth.days === "object" ? depth.days : {};
  return Object.keys(days)
    .filter(isDay)
    .sort()
    .map((day) => {
      const dwell = Array.isArray(days[day]?.dwellMs) ? days[day].dwellMs : [];
      const awakeMs = dwell.reduce((sum, ms) => sum + count(ms), 0);
      return { day, awakeMs, covered: awakeMs >= minAwakeMs };
    });
}

/** Every count in the feature census for one base, on one day, summed across
 *  the outcomes we care about — which is exactly one outcome per group. */
function countFor(features, day, base, outcome) {
  return count(features?.days?.[day]?.[`${base}:${outcome}`]);
}

/**
 * What the record supports today. Pure.
 *
 * @param {object} inputs
 * @param {object} inputs.features   data/census/features.json — {days, seen, roster, since}
 * @param {object} inputs.depth      data/census/depth.json — the coverage denominator
 * @param {object} inputs.occupancy  data/occupancy-days.json — who was home
 * @param {object} opts              { today: "YYYY-MM-DD", minDays, minAwakeMs, minEvents }
 */
export function buildHouseClaims(inputs, opts = {}) {
  const {
    today,
    minDays = MIN_DAYS,
    minAwakeMs = MIN_AWAKE_MS,
    minEvents = MIN_EVENTS,
    quietMinDays = QUIET_MIN_DAYS,
    maxPerGroup = MAX_PER_GROUP
  } = opts;

  const features = inputs?.features ?? null;
  const depth = inputs?.depth ?? null;

  const empty = {
    ready: false,
    since: null, until: null,
    observedDays: 0, spanDays: 0, gapDays: 0, continuous: false,
    scope: null,
    today: null,
    groups: {},
    occupancy: occupancyClaims(inputs?.occupancy, { today, minDays })
  };

  if (!isDay(today)) return empty;

  const coverage = coverageOf(depth, { minAwakeMs });
  const todayCoverage = coverage.find((c) => c.day === today) ?? null;

  /* ⚠ THE INTERSECTION, not the union. The depth census started 2026-08-23 and
     the feature census 2026-08-29; a claim about the doorbell over the depth
     window would be six days longer than the doorbell counter has existed.
     `since` is the sticky field routes/censusFeatures.js keeps for precisely
     this — it backfills honestly from the file's own oldest day rather than
     resetting to "today" and throwing away the counting already done. */
  const featuresSince = isDay(features?.since)
    ? features.since
    : Object.keys(features?.days ?? {}).filter(isDay).sort()[0] ?? null;

  const observed = coverage.filter(
    (c) => c.covered && c.day < today && (!featuresSince || c.day >= featuresSince)
  );

  const todayRow = todayCoverage
    ? {
        day: today,
        awakeMs: todayCoverage.awakeMs,
        partial: true,
        counts: Object.fromEntries(
          GROUPS.map(({ group, ns, outcome }) => [
            group,
            basesIn(features, ns).reduce((sum, base) => sum + countFor(features, today, base, outcome), 0)
          ])
        )
      }
    : null;

  if (!observed.length) return { ...empty, today: todayRow };

  const since = observed[0].day;
  const until = observed[observed.length - 1].day;
  // Inclusive, the way lately.js counts it: 08-29 → 08-31 is three days.
  const spanDays = daysBetween(since, until) + 1;
  const gapDays = Math.max(0, spanDays - observed.length);
  const continuous = gapDays === 0;

  const base = {
    ...empty,
    since, until,
    observedDays: observed.length,
    spanDays, gapDays, continuous,
    today: todayRow,
    occupancy: occupancyClaims(inputs?.occupancy, { today, minDays })
  };

  if (observed.length < minDays) return base;

  /* Identical rule and identical wording to lately.js: "since we started
     counting" is a claim about the WHOLE record and is only true when the
     record has no holes in it. */
  const scope = continuous ? "since we started counting" : `in ${observed.length} days on record`;

  const groups = {};
  for (const { group, ns, outcome, label } of GROUPS) {
    groups[group] = groupClaims(features, basesIn(features, ns), {
      observed, outcome, label, today, scope, minEvents, quietMinDays, maxPerGroup
    });
  }

  return { ...base, ready: true, scope, groups };
}

/** The bases the CLIENT declared for a namespace. Roster, not observed keys —
 *  a base missing from the roster is one this build cannot produce at all, and
 *  a base in the roster with nothing observed is `notYetSeen`, which is the
 *  census's verdict to make and not this file's. */
function basesIn(features, ns) {
  const roster = Array.isArray(features?.roster) ? features.roster : [];
  return roster.filter((b) => typeof b === "string" && b.startsWith(`${ns}:`)).sort();
}

function groupClaims(features, bases, o) {
  const { observed, outcome, label, today, scope, minEvents, quietMinDays, maxPerGroup } = o;
  const seen = features?.seen && typeof features.seen === "object" ? features.seen : {};
  const windowStart = observed[0].day;

  const perBase = bases.map((b) => {
    const perDay = observed.map((c) => ({ day: c.day, n: countFor(features, c.day, b, outcome) }));
    return {
      base: b,
      name: humanise(b),
      total: perDay.reduce((sum, d) => sum + d.n, 0),
      today: countFor(features, today, b, outcome),
      perDay,
      lastDay: isDay(seen[`${b}:${outcome}`]?.last) ? seen[`${b}:${outcome}`].last : null
    };
  });

  const total = perBase.reduce((sum, b) => sum + b.total, 0);

  /* The busiest single day for the group as a whole. Per-base records are
     mostly noise at these counts; "the day the most came to the door" is the
     one a person would actually ask about. */
  const byDay = observed.map((c) => ({
    day: c.day,
    n: perBase.reduce((sum, b) => sum + (b.perDay.find((d) => d.day === c.day)?.n ?? 0), 0)
  }));
  const busiest = recordDay(byDay, { minEvents, scope });

  /* ⚠⚠ QUIET IS THE CLAIM MOST LIKELY TO BE A LIE, so it carries three guards:
     the base is in the roster (it CAN fire), `seen.last` exists (it HAS fired,
     so this is silence rather than a dead counter), and that last firing is
     inside the window (otherwise the days in between were never observed and
     "in N days" is a number about a file, not about the house). */
  const quiet = perBase
    .filter((b) => b.lastDay && b.lastDay >= windowStart && b.lastDay < today)
    .map((b) => ({
      base: b.base,
      name: b.name,
      lastDay: b.lastDay,
      daysSince: daysBetween(b.lastDay, today),
      total: b.total
    }))
    .filter((b) => b.daysSince >= quietMinDays)
    .sort((a, b) => b.daysSince - a.daysSince)
    .slice(0, maxPerGroup);

  return {
    label,
    total,
    today: perBase.reduce((sum, b) => sum + b.today, 0),
    scope,
    busiest,
    quiet,
    top: perBase
      .filter((b) => b.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, maxPerGroup)
      .map(({ base, name, total, today: n }) => ({ base, name, total, today: n }))
  };
}

/**
 * The record day out of a list, with the tie test.
 *
 * ⚠ A DAY THAT BEATS THE FIELD BY ONE IS NOT A RECORD, and neither is a day
 * that wins with two events. `clear:false` keeps the number and drops the
 * superlative — the same split lately.js makes for a 0.1 °C lead, because the
 * value is still true and it is the SUPERLATIVE that was not earned.
 */
export function recordDay(byDay, { minEvents = MIN_EVENTS, scope = null } = {}) {
  const rows = (byDay ?? []).filter((r) => r && isDay(r.day));
  if (!rows.length) return null;

  const best = rows.reduce((acc, r) => (r.n > acc.n ? r : acc));
  if (best.n <= 0) return null;

  const rest = rows.filter((r) => r.day !== best.day);
  const runnerUp = rest.length ? rest.reduce((acc, r) => (r.n > acc.n ? r : acc)) : null;
  const lead = runnerUp ? best.n - runnerUp.n : null;

  return {
    day: best.day,
    value: best.n,
    lead,
    clear: best.n >= minEvents && (lead === null || lead >= 1),
    overDays: rows.length,
    scope
  };
}

/**
 * Who was home, from services/occupancyDays.js.
 *
 * ⛔ THE ONE GROUP THAT IS PURELY AN INFERENCE ABOUT THE RESIDENTS, so it is
 * the one phase-8-learn.md:81 bans outright from being announced. It exists to
 * be ASKED. See this file's header.
 *
 * 🔑 Its window is its OWN, not the wall's. The sampler runs in the server and
 * keeps counting while the screen is asleep, so gating it on the kiosk's awake
 * hours would discard the half of the day it is best at.
 */
export function occupancyClaims(occupancy, { today, minDays = MIN_DAYS } = {}) {
  const days = occupancy?.days && typeof occupancy.days === "object" ? occupancy.days : {};
  const keys = Object.keys(days).filter(isDay).sort();
  const past = keys.filter((d) => d < today);

  const empty = { ready: false, since: null, until: null, observedDays: past.length, people: [], today: null };
  if (!past.length) return empty;

  const since = past[0];
  const until = past[past.length - 1];
  const names = new Set();
  for (const day of keys) for (const id of Object.keys(days[day]?.people ?? {})) names.add(id);

  const todayRow = isDay(today) && days[today] ? summariseDay(days[today]) : null;
  const shaped = { ...empty, since, until, observedDays: past.length, today: todayRow };
  if (past.length < minDays) return shaped;

  /* Samples, never durations — see occupancyDays.js's header. A day is "home"
     for someone when they were sampled at home at all that day, which survives
     a restart losing a sample and does not pretend to know minutes. */
  const people = [...names].sort().map((id) => {
    const seenDays = past.filter((d) => days[d]?.people?.[id]);
    const homeDays = seenDays.filter((d) => count(days[d].people[id].home) > 0).length;
    const awayDays = seenDays.filter(
      (d) => count(days[d].people[id].home) === 0 && count(days[d].people[id].away) > 0
    ).length;
    return {
      id,
      name: humanise(`person:${id}`),
      observedDays: seenDays.length,
      homeDays,
      awayDays,
      arrivals: seenDays.reduce((sum, d) => sum + count(days[d].people[id].arrivals), 0),
      departures: seenDays.reduce((sum, d) => sum + count(days[d].people[id].departures), 0)
    };
  });

  return { ...shaped, ready: true, people };
}

function summariseDay(row) {
  const people = row?.people && typeof row.people === "object" ? row.people : {};
  return {
    samples: count(row?.samples),
    people: Object.fromEntries(
      Object.keys(people).sort().map((id) => [
        id,
        {
          home: count(people[id].home),
          away: count(people[id].away),
          arrivals: count(people[id].arrivals),
          departures: count(people[id].departures)
        }
      ])
    )
  };
}
