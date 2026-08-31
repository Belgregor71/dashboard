import { appendFile, mkdir, readFile, writeFile, rename } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

/* ═══════════════════════════════════════════════════════════════════════════
   WEATHER HISTORY — one line a day, so the house eventually has a past.

   Audited 2026-08-16: the dashboard retains NO weather reading of any age.
   weatherService is forward-only (no `past_days` on the Open-Meteo call, no
   cache dir), the BOM service reads current attributes plus a forward
   forecast, and Home Assistant's recorder is not queried anywhere. So every
   sentence of the form "the first thirty-degree morning of the season" or
   "colder than it's been in weeks" would have been INVENTED — the house
   asserting a comparison against data that does not exist.

   That is why this is a file rather than a feature. The house's most
   distinctive habit is keeping count (CHARACTER.md:61-64), and it has been
   counting against a window of exactly zero days.

   Deliberately NOT backfilled. Open-Meteo would serve historical days happily,
   but a house claiming to remember a morning it was not switched on for is
   exactly the kind of confident invention the rest of this codebase spends its
   comments guarding against. It remembers from the day it started remembering.

   ── ⚠⚠⚠ What was wrong with this file until 2026-08-31 ─────────────────────

   It recorded a FORECAST and called it the day. `day.high_c` is
   `daily.temperature_2m_max[0]` — today's *prediction* — and the old
   `lastWritten` guard wrote once per PROCESS LIFETIME, so the stored value was
   whatever the last service restart of that day happened to predict.

   Measured on the live kiosk: 122 lines over 16 days, and **12 of those 16
   days carried more than one distinct reading**:

       2026-08-20   8 distinct   high 20.2 → 21.4   low 11.7 → 12.4
       2026-08-23   5 distinct   high 21.5 → 22.2   low 10.7 → 11.5

   A 0.7–1.2 °C spread across a window whose nights span ~10.7–12.9 °C is large
   enough to FLIP A SUPERLATIVE. `now.temp_c` is a real observation, arrives on
   the same call, and was being thrown away.

   So this file now folds the observed temperature into per-day extremes
   (`obsHigh`/`obsLow`) and keeps the forecast alongside it under the original
   `high`/`low` keys — renaming them would silently reinterpret every row
   written before today. `condition` likewise stays a single sample, and the
   set of everything seen that day is added as `conditions`: 2026-08-20 was
   recorded as "Partly cloudy" when it had also been Clear, Mostly clear and
   Cloudy, which as a DAILY descriptor is close to meaningless.

   ⚠⚠ THE TRAP, AND IT IS THE ONE TO TEST: on restart the accumulator MUST be
   seeded from today's existing row. A process that starts from empty re-folds
   only the rest of the day and writes a NARROWER range — and parseHistory's
   last-wins rule then prefers that narrower line. The bug does not look like a
   bug; it looks like a genuinely milder day. See __seedFrom / the spec.
   ═══════════════════════════════════════════════════════════════════════════ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, "..", "..", "data", "weather-history.jsonl");

/* A test-only redirect, NOT an env var — the same seam and the same reasoning
   as services/unresolved.js. Playwright runs specs in parallel workers, so two
   of them appending to the real store would collide and present as an
   unreproducible flake rather than the shared-state bug it is. An env var
   would then have to be documented in .env.example as a knob nobody should
   ever turn (tests/env-example.spec.js correctly insists on that). */
let overrideFile = null;
function historyFile() {
  return overrideFile || DEFAULT_FILE;
}
export const HISTORY_FILE = DEFAULT_FILE;

/* Brisbane, not the server's locale — a UTC evening is already tomorrow here,
   and a day boundary ten hours out would file the afternoon's high under the
   wrong date for ten hours of every day. */
const TZ = "Australia/Brisbane";
export const houseDay = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: TZ });

/* Roughly three years. Long enough for "this time last year" to be a real
   claim, short enough that the file is never a problem.
   ⚠ Until compact() below, this was enforced on READ ONLY — nothing ever
   pruned the file. */
export const MAX_DAYS = 1100;

/* A day's extremes are monotone — the max only ratchets up, the min only down
   — so appends are self-limiting and this cap never binds in practice. It
   exists so a jittering upstream cannot write a megabyte to the SD card. */
export const MAX_APPENDS_PER_DAY = 200;

/* A real day is Clear → Partly cloudy → Cloudy and back. Eight distinct labels
   is already more weather than Brisbane manages; the cap bounds a flapping
   condition code, not a real sky. */
export const MAX_CONDITIONS = 8;

/** @type {{day:string,high:number|null,low:number|null,condition:string|null,obsHigh:number|null,obsLow:number|null,conditions:string[],n:number,appends:number}|null} */
let state = null;
let lastMaterial = null;

/* Read-modify-write against one file from a route that runs on every weather
   refresh. The kiosk would never collide with itself, but the suite fires
   these from parallel workers and compact() rewrites the whole file — two
   interleaved operations would silently drop an append or truncate the
   history. Same idiom as routes/census.js. */
let queue = Promise.resolve();

function numeric(v) {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

function conditionLabel(reading) {
  const label = reading?.now?.condition?.label;
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

/**
 * Fold one reading into a day's accumulator. Pure — no clock, no disk — so the
 * merge rules test without a server, the same way mergeFeatureDelta does.
 *
 * @param {object|null} prior  the day's state so far, or null to start one
 * @param {object} reading     normalizeWeatherNow's whole `{ now, day }` object
 * @param {string} day         the house day this reading belongs to
 */
export function foldReading(prior, reading, day) {
  const base = prior && prior.day === day
    ? prior
    : { day, high: null, low: null, condition: null, obsHigh: null, obsLow: null, conditions: [], n: 0, appends: 0 };

  const forecastHigh = numeric(reading?.day?.high_c);
  const forecastLow = numeric(reading?.day?.low_c);
  const observed = numeric(reading?.now?.temp_c);
  const label = conditionLabel(reading);

  const conditions = base.conditions.slice();
  if (label && !conditions.includes(label) && conditions.length < MAX_CONDITIONS) conditions.push(label);

  return {
    day,
    // The forecast, kept under its original keys. Last one wins: a later
    // prediction is a better one.
    high: forecastHigh ?? base.high,
    low: forecastLow ?? base.low,
    condition: label ?? base.condition,
    // The observation. This is the half that can carry a superlative.
    obsHigh: observed == null ? base.obsHigh : (base.obsHigh == null ? observed : Math.max(base.obsHigh, observed)),
    obsLow: observed == null ? base.obsLow : (base.obsLow == null ? observed : Math.min(base.obsLow, observed)),
    conditions,
    n: base.n + (observed == null ? 0 : 1),
    appends: base.appends
  };
}

/** The fields a change in which is worth a new line. `n` is deliberately NOT
 *  among them: it moves on every single refresh, and including it would append
 *  a line per request and defeat the bound. */
export function materialOf(s) {
  return s == null ? null : JSON.stringify([s.high, s.low, s.condition, s.obsHigh, s.obsLow, s.conditions]);
}

/** The stored line for a day's state. `n` rides along as the count at the
 *  moment this line was written — how well-observed the day was. */
export function lineOf(s) {
  return JSON.stringify({
    day: s.day,
    high: s.high,
    low: s.low,
    condition: s.condition,
    obsHigh: s.obsHigh,
    obsLow: s.obsLow,
    conditions: s.conditions,
    n: s.n
  });
}

/**
 * Rebuild an accumulator from a row already on disk.
 *
 * ⚠ THIS IS THE WHOLE POINT OF THE RESTART PATH. A row written before the
 * observed fields existed seeds them as null — we cannot invent observations
 * we did not take — but its forecast and condition carry forward.
 */
export function __seedFrom(row, day) {
  if (!row || row.day !== day) return null;
  return {
    day,
    high: numeric(row.high),
    low: numeric(row.low),
    condition: typeof row.condition === "string" ? row.condition : null,
    obsHigh: numeric(row.obsHigh),
    obsLow: numeric(row.obsLow),
    conditions: Array.isArray(row.conditions)
      ? row.conditions.filter((c) => typeof c === "string").slice(0, MAX_CONDITIONS)
      : [],
    n: typeof row.n === "number" && Number.isFinite(row.n) && row.n >= 0 ? Math.round(row.n) : 0,
    appends: 0
  };
}

/**
 * Record a reading. Called from the weather refresh path, which runs many
 * times a day — that is the point now, since the day's extremes are folded
 * from those calls rather than sampled from one of them.
 *
 * ⚠ Never throws, and never awaited by anything a person is waiting on. A
 * weather history that cannot be written must not cost the wall its forecast.
 *
 * @returns {Promise<boolean>} true when a line was actually appended
 */
export async function recordDay(reading, now = new Date()) {
  const day = houseDay(now);

  const task = queue.then(async () => {
    // Day roll, or the first call of this process. Both need the file read
    // before anything is folded — see the ⚠⚠ trap in the header.
    if (state?.day !== day) {
      let seeded = null;
      try {
        const rows = parseHistory(await readFile(historyFile(), "utf8"));
        seeded = __seedFrom(rows.find((r) => r.day === day), day);
        // The day rolled, so yesterday is final and the file can be collapsed
        // to one line per day. Cheap, and it is the prune this file never had.
        await compactNow();
      } catch { /* no file yet, or unreadable — start the day from nothing */ }
      state = seeded;
      lastMaterial = materialOf(seeded);
    }

    const next = foldReading(state, reading, day);

    // A day with neither a forecast nor an observation is not worth a line.
    if (next.high == null && next.low == null && next.obsHigh == null) return false;

    const material = materialOf(next);
    if (material === lastMaterial) { state = next; return false; }
    if (next.appends >= MAX_APPENDS_PER_DAY) { state = next; return false; }

    try {
      await mkdir(path.dirname(historyFile()), { recursive: true });
      await appendFile(historyFile(), `${lineOf(next)}\n`, "utf8");
      state = { ...next, appends: next.appends + 1 };
      lastMaterial = material;
      return true;
    } catch (err) {
      console.warn("[weather-history] could not record the day:", err.message);
      state = next;
      return false;
    }
  });

  queue = task.then(() => {}, () => {});
  try {
    return await task;
  } catch {
    return false;
  }
}

/**
 * Read the history back, newest first, one entry per day.
 *
 * Later lines win: a restart, or a new extreme, appends another row for the
 * same day, and the last one written is the most complete reading of it.
 */
export function parseHistory(raw) {
  const byDay = new Map();
  for (const line of String(raw ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry.day === "string") byDay.set(entry.day, entry);
    } catch { /* a half-written line from a hard kill mid-append */ }
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, MAX_DAYS);
}

/** Every day the house has on record, newest first. Empty until it has some. */
export async function history() {
  try {
    return parseHistory(await readFile(historyFile(), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];      // nothing remembered yet
    console.warn("[weather-history] could not read:", err.message);
    return [];
  }
}

/* The unqueued half — only ever called from inside a queued task, or a caller
   would deadlock waiting on the queue it is already holding. */
async function compactNow() {
  let raw;
  try {
    raw = await readFile(historyFile(), "utf8");
  } catch {
    return 0;
  }

  const lines = raw.split("\n").filter((l) => l.trim()).length;
  const rows = parseHistory(raw);
  if (lines <= rows.length) return 0;         // already one line per day

  /* ⚠ The only rewrite in this file, so it is the only operation that can lose
     history — tmp+rename, because rename() within a directory is atomic and a
     kill mid-write must leave the old file intact rather than a truncated one.
     Same reasoning as routes/tts.js. */
  const body = `${rows.slice().reverse().map((r) => JSON.stringify(r)).join("\n")}\n`;
  const tmp = `${historyFile()}.tmp`;
  try {
    await mkdir(path.dirname(historyFile()), { recursive: true });
    await writeFile(tmp, body, "utf8");
    await rename(tmp, historyFile());
    return lines - rows.length;
  } catch (err) {
    console.warn("[weather-history] could not compact:", err.message);
    return 0;
  }
}

/** Collapse the file to one line per day, newest MAX_DAYS kept. Information-
 *  preserving: parseHistory already resolves a day to its last line, so this
 *  only reclaims the rows that reading was already discarding.
 *  @returns {Promise<number>} lines removed */
export async function compact() {
  const task = queue.then(() => compactNow());
  queue = task.then(() => {}, () => {});
  try { return await task; } catch { return 0; }
}

/** Test seam. Redirects the store and clears the in-process accumulator, so a
 *  spec can drive a restart without one worker's day leaking into another's. */
export function __resetHistory({ file = null } = {}) {
  overrideFile = file;
  state = null;
  lastMaterial = null;
  queue = Promise.resolve();
}
