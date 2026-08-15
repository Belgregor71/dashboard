import { appendFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

/* ═══════════════════════════════════════════════════════════════════════════
   WEATHER HISTORY — one line a day, so the house eventually has a past.

   ⚠ THIS DOES NOTHING TODAY. It is planted, not harvested.

   Audited 2026-08-16: the dashboard retains NO weather reading of any age.
   weatherService is forward-only (no `past_days` on the Open-Meteo call, no
   cache dir), the BOM service reads current attributes plus a forward
   forecast, and Home Assistant's recorder is not queried anywhere. So every
   sentence of the form "the first thirty-degree morning of the season" or
   "colder than it's been in weeks" would have been INVENTED — the house
   asserting a comparison against data that does not exist.

   That is why this is a file rather than a feature. The house's most
   distinctive habit is keeping count (CHARACTER.md), and it has been counting
   against a window of exactly zero days. One JSONL line per day, about 70
   bytes, ~25 KB a year, makes "coldest morning in six weeks" true in six
   weeks and "first thirty-degree day since September" true this summer.

   Deliberately NOT backfilled. Open-Meteo would serve historical days happily,
   but a house claiming to remember a morning it was not switched on for is
   exactly the kind of confident invention the rest of this codebase spends its
   comments guarding against. It remembers from the day it started remembering.
   ═══════════════════════════════════════════════════════════════════════════ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HISTORY_FILE = path.join(__dirname, "..", "..", "data", "weather-history.jsonl");

/* Brisbane, not the server's locale — a UTC evening is already tomorrow here,
   and a day boundary ten hours out would file the afternoon's high under the
   wrong date for ten hours of every day. */
const TZ = "Australia/Brisbane";
const houseDay = (now) => now.toLocaleDateString("en-CA", { timeZone: TZ });

/* Roughly three years. Long enough for "this time last year" to be a real
   claim, short enough that the file is never a problem. */
export const MAX_DAYS = 1100;

let lastWritten = null;   // in-process guard; the file is the real one

/**
 * Record today's reading, once. Called from the weather refresh path, which
 * runs many times a day — the day key is what makes that idempotent.
 *
 * ⚠ Never throws, and never awaited by anything a person is waiting on. A
 * weather history that cannot be written must not cost the wall its forecast.
 *
 * @returns {Promise<boolean>} true when a line was actually appended
 */
export async function recordDay(reading, now = new Date()) {
  const day = houseDay(now);
  if (lastWritten === day) return false;

  const high = numeric(reading?.day?.high_c);
  const low = numeric(reading?.day?.low_c);
  // A day with no high or low is not worth a line. Writing nulls would make
  // every later "coldest since" query filter them out anyway, and a sparse
  // file of real days beats a dense one of half-days.
  if (high == null && low == null) return false;

  const line = JSON.stringify({
    day,
    high,
    low,
    condition: typeof reading?.now?.condition?.label === "string"
      ? reading.now.condition.label
      : null
  });

  try {
    await mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    // Append-only: the last write for a day wins on read, and a duplicate line
    // from a restart costs one row rather than a rewrite of the whole file.
    await appendFile(HISTORY_FILE, `${line}\n`, "utf8");
    lastWritten = day;
    return true;
  } catch (err) {
    console.warn("[weather-history] could not record the day:", err.message);
    return false;
  }
}

function numeric(v) {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

/**
 * Read the history back, newest first, one entry per day.
 *
 * Later lines win: a restart can append a second row for the same day, and the
 * last one written is the most complete reading of it.
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
    return parseHistory(await readFile(HISTORY_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];      // nothing remembered yet
    console.warn("[weather-history] could not read:", err.message);
    return [];
  }
}
