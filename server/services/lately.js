/* ═══════════════════════════════════════════════════════════════════════════
   LATELY — turning the weather record into things the house may honestly say.

   docs/AUGUST-IMPROVEMENTS.md §4. weatherHistory.js has been writing a day a
   day since 2026-08-16 and NOTHING HAS EVER READ IT — `history()` had zero
   callers outside its own spec, and the file said so in its own banner:
   "⚠ THIS DOES NOTHING TODAY. It is planted, not harvested." This is the
   harvest.

   CHARACTER.md:61-64 calls keeping count the house's "most distinctive habit
   and the one that makes it worth having", and :91 gives the line it is meant
   to produce — "The bin went out at 8:41, which is the latest all month".
   Until there was a record to count against, every sentence of that shape
   would have been invented.

   ── ⚠⚠⚠ Everything here is about REFUSING to speak ──────────────────────────

   This module's job is not to find superlatives. It is to find the ones the
   data actually supports and withhold the rest, because CHARACTER.md:105 makes
   the manufactured particular the rule that "outranks everything else on this
   page" — and a wrong superlative is indistinguishable from a right one to
   everybody in the room.

   Three guards, each of which the repo has already paid for once:

   1. A FLOOR. A superlative over four days is not a superlative. Nothing is
      returned below MIN_DAYS. This is routes/censusFeatures.js's
      DEFAULT_DEAD_DAYS lesson — shipped without it, that instrument reported
      "dead: 71" of a 73-key roster on its first morning, and the only two
      outcomes of a report like that are panic or learning to ignore it.

   2. OBSERVATIONS ONLY. `high`/`low` in the record are a FORECAST sampled at
      an arbitrary moment (see weatherHistory.js's header — 12 of the first 16
      days carried more than one distinct reading, spreads up to 1.2 °C, which
      is enough to flip a superlative). Only `obsHigh`/`obsLow` may carry a
      claim. Rows written before those existed are skipped, not coerced.

   3. GAPS ARE COUNTED AND REPORTED. A day the box was off writes no row, and
      a missing day is indistinguishable from a quiet one. "Since we started
      counting" is only honest when the window is actually continuous, so
      `scope` degrades to a plain day count when it is not.
   ═══════════════════════════════════════════════════════════════════════════ */

/* A week. Long enough that "coldest in a week" means something, short enough
   that the house is not mute for a month after a fresh install. Matches
   DEFAULT_DEAD_DAYS in routes/censusFeatures.js, and for the same reason. */
export const MIN_DAYS = 7;

/* Below this the day is a tie, not a record. Open-Meteo reports to 0.1 °C and
   the record rounds to the same, so two days can differ by 0.1 °C on rounding
   alone — announcing that as "the coldest morning in three weeks" is true by
   arithmetic and false in the room. */
export const MARGIN_C = 0.5;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const numeric = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Whole days between two ISO day strings, floored at 0. Day strings sort and
 *  subtract without a timezone, which is why the record uses them. */
export function daysBetween(from, to) {
  const at = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.max(0, Math.round((at(to) - at(from)) / 86_400_000));
}

/** The rows that carry a real observation, oldest first. Anything without one
 *  is not evidence — it is a forecast that happened to be written down. */
export function observedRows(history) {
  return (Array.isArray(history) ? history : [])
    .filter((r) => r && typeof r.day === "string" && DAY_RE.test(r.day))
    .filter((r) => numeric(r.obsHigh) !== null || numeric(r.obsLow) !== null)
    .slice()
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/* The four records worth holding. Each names the field it reads and which way
   is "better", so adding a fifth is a row here and nothing else. */
const RECORDS = [
  { key: "warmestDay", field: "obsHigh", dir: 1, noun: "warmest day" },
  { key: "coolestDay", field: "obsHigh", dir: -1, noun: "coolest day" },
  { key: "warmestNight", field: "obsLow", dir: 1, noun: "warmest night" },
  { key: "coldestMorning", field: "obsLow", dir: -1, noun: "coldest morning" }
];

/**
 * What the record supports today. Pure — no clock, no disk.
 *
 * @param {Array} history  parseHistory() output (newest first; order is not relied on)
 * @param {object} opts    { today: "YYYY-MM-DD", minDays, margin }
 * @returns {{
 *   ready: boolean, since: string|null, until: string|null,
 *   observedDays: number, spanDays: number, gapDays: number, continuous: boolean,
 *   scope: string|null, today: object|null,
 *   records: object, todayHolds: string[]
 * }}
 */
export function buildClaims(history, { today, minDays = MIN_DAYS, margin = MARGIN_C } = {}) {
  const rows = observedRows(history);
  const empty = {
    ready: false, since: null, until: null,
    observedDays: rows.length, spanDays: 0, gapDays: 0, continuous: false,
    scope: null, today: null, records: {}, todayHolds: []
  };

  if (!rows.length || typeof today !== "string" || !DAY_RE.test(today)) return empty;

  const since = rows[0].day;
  const until = rows[rows.length - 1].day;
  // Inclusive: 08-16 → 08-31 is 16 days on the calendar, not 15.
  const spanDays = daysBetween(since, until) + 1;
  const gapDays = Math.max(0, spanDays - rows.length);
  const continuous = gapDays === 0;

  const todayRow = rows.find((r) => r.day === today) ?? null;

  if (rows.length < minDays) return { ...empty, since, until, spanDays, gapDays, continuous, today: todayRow };

  /* "Since we started counting" is a claim about the whole record and is only
     true when the record has no holes in it. Otherwise the honest phrase names
     the number of days actually observed and nothing more. */
  const scope = continuous ? "since we started counting" : `in ${rows.length} days on record`;

  const records = {};
  for (const { key, field, dir, noun } of RECORDS) {
    const withValue = rows.filter((r) => numeric(r[field]) !== null);
    if (withValue.length < minDays) continue;

    let best = withValue[0];
    for (const row of withValue) {
      if (dir * (row[field] - best[field]) > 0) best = row;
    }

    /* The runner-up decides whether this is a record or a coin toss. A day
       that beats the field by less than the margin is reported with
       `clear: false` so the phrasing layer can soften or skip it — the number
       is still true, it is the SUPERLATIVE that is not earned. */
    const rest = withValue.filter((r) => r.day !== best.day);
    const runnerUp = rest.length
      ? rest.reduce((acc, r) => (dir * (r[field] - acc[field]) > 0 ? r : acc))
      : null;
    const lead = runnerUp ? Math.abs(best[field] - runnerUp[field]) : null;

    records[key] = {
      noun,
      value: best[field],
      day: best.day,
      conditions: Array.isArray(best.conditions) ? best.conditions : [],
      clear: lead === null ? true : lead >= margin,
      lead,
      overDays: withValue.length,
      scope
    };
  }

  /* Which records TODAY currently holds — the only ones that are news. "The
     coldest morning was three weeks ago" is a fact about a file; "this is the
     coldest morning since we started counting" is a fact about the room. */
  const todayHolds = todayRow
    ? Object.entries(records).filter(([, r]) => r.day === today && r.clear).map(([key]) => key)
    : [];

  return {
    ready: true,
    since, until,
    observedDays: rows.length,
    spanDays, gapDays, continuous,
    scope,
    today: todayRow,
    records,
    todayHolds
  };
}
