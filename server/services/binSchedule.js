import { haGet } from "../ha/haRest.js";

// Bin schedule — two sources, ONE window rule.
//
// The council calendar (the `waste_collection_schedule` integration's
// `calendar.brisbane_city_council`) is authoritative. Measured 2026-08-06 over its
// full published horizon: a rolling ~26-week FORWARD window (no history at all),
// every entry exactly 7 days apart, always exactly two bins — weekly Rubbish plus
// Recycling/Garden alternating. It is also the only source that would carry a
// council schedule change.
//
// The env date-math is kept as the fallback for when HA is unreachable. It was
// verified against all 26 published collections on 2026-08-06 and agreed on every
// one, so degrading to it is safe rather than a guess.
//
// Both sources normalise to the same shape so the window rule runs exactly once:
//   { date: Date (local midnight), bins: [{ word: "Rubbish", colour: "red" }, …] }

const CACHE_MS = 6 * 60 * 60 * 1000; // the schedule is static; don't hammer HA
const LOOKAHEAD_DAYS = 21;
const DEFAULT_CALENDAR = "calendar.brisbane_city_council";

// The council's three words, and the colours the household actually says.
const COLOUR_BY_WORD = { rubbish: "red", recycling: "yellow", garden: "green" };
const WORD_BY_COLOUR = { red: "Rubbish", yellow: "Recycling", green: "Garden" };

// Presentation order, so "Red + Yellow" never comes out as "Yellow + Red".
const COLOUR_ORDER = ["red", "yellow", "green", "unknown"];

// The reminder windows. The truck comes early, so the collection-day reminder is a
// short last chance, not an all-day nag about something already impossible.
export const EVE_FROM_HOUR = 12; // day before, from midday
export const LAST_CHANCE_UNTIL_HOUR = 7; // collection morning, until 7am

// ── Pure helpers (unit-tested in plain node) ──────────────────────

/**
 * "2026-08-06" → local midnight.
 *
 * ⚠ NEVER `new Date(str)` for these. That parses as UTC midnight, which for any
 * timezone west of UTC lands on the previous calendar day — and the whole
 * day-before rule is then off by one, silently, for half the world.
 */
export function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Council word → bin colour. An unrecognised word is still a bin to put out. */
export function colourForWord(word) {
  return COLOUR_BY_WORD[String(word ?? "").trim().toLowerCase()] ?? null;
}

function sortBins(bins) {
  return bins.slice().sort(
    (a, b) => COLOUR_ORDER.indexOf(a.colour) - COLOUR_ORDER.indexOf(b.colour)
  );
}

/** Accept day as number (0–6) or full name ("Sunday" … "Saturday"). */
export function parseDayNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const lower = String(value).toLowerCase().trim();
  const byName = names.indexOf(lower);
  if (byName >= 0) return byName;
  const parsed = Number.parseInt(lower, 10);
  return parsed >= 0 && parsed <= 6 ? parsed : null;
}

/** HA calendar events → normalised collections, grouped by day and sorted. */
export function collectionsFromCalendar(events) {
  const byDate = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    // All-day events carry `start.date`; tolerate a timed shape just in case.
    const raw = event?.start?.date
      ?? (typeof event?.start?.dateTime === "string" ? event.start.dateTime.slice(0, 10) : null);
    const date = parseLocalDate(raw);
    const word = typeof event?.summary === "string" ? event.summary.trim() : "";
    if (!date || !word) continue;

    const key = date.getTime();
    if (!byDate.has(key)) byDate.set(key, { date, bins: [] });
    const entry = byDate.get(key);
    if (entry.bins.some((bin) => bin.word.toLowerCase() === word.toLowerCase())) continue;
    entry.bins.push({ word, colour: colourForWord(word) ?? "unknown" });
  }

  return [...byDate.values()]
    .map((entry) => ({ date: entry.date, bins: sortBins(entry.bins) }))
    .sort((a, b) => a.date - b.date);
}

/**
 * The fallback: generate the next few collections from the configured weekday and
 * a reference date on which yellow was collected. Weeks since reference —
 * even → yellow, odd → green. Lifted from the original route so both sources
 * produce identical shapes.
 */
export function collectionsFromDateMath({ collectionDay, yellowRef, now = new Date(), count = 3 } = {}) {
  if (collectionDay === null || collectionDay === undefined) return [];

  const today = startOfLocalDay(now);
  const first = addDays(today, (collectionDay - today.getDay() + 7) % 7);
  const ref = yellowRef ? parseLocalDate(yellowRef) : null;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;

  const collections = [];
  for (let index = 0; index < count; index += 1) {
    const date = addDays(first, index * 7);
    const bins = [{ word: WORD_BY_COLOUR.red, colour: "red" }];
    if (ref) {
      const weeks = Math.round((date - ref) / msPerWeek);
      const colour = weeks % 2 === 0 ? "yellow" : "green";
      bins.push({ word: WORD_BY_COLOUR[colour], colour });
    }
    collections.push({ date, bins: sortBins(bins) });
  }
  return collections;
}

/**
 * Which reminder (if any) is live right now.
 *
 * Collection morning before 7am → last chance. Day before from midday → the real
 * reminder. Everything else is silence: after the truck has been, saying "bins out
 * this morning" asks for something no longer possible.
 */
export function binWindow(collections, now = new Date()) {
  const idle = { due: false, eve: false, lastChance: false, collection: null };
  const list = Array.isArray(collections) ? collections : [];

  const today = startOfLocalDay(now);
  const tomorrow = addDays(today, 1);
  const hour = now.getHours();

  const onDay = (day) => list.find((entry) => entry.date.getTime() === day.getTime()) ?? null;

  const todays = onDay(today);
  if (todays && hour < LAST_CHANCE_UNTIL_HOUR) {
    return { due: true, eve: false, lastChance: true, collection: todays };
  }

  const tomorrows = onDay(tomorrow);
  if (tomorrows && hour >= EVE_FROM_HOUR) {
    return { due: true, eve: true, lastChance: false, collection: tomorrows };
  }

  return idle;
}

// ── The impure edge ───────────────────────────────────────────────

let cache = { at: 0, collections: null };

/** Test seam — the cache is module state and would leak between specs. */
export function resetBinScheduleCache() {
  cache = { at: 0, collections: null };
}

/**
 * Collections from the council calendar, falling back to the env date-math.
 * Never throws: bins degrading to a stale-but-correct schedule beats a 500.
 */
export async function loadCollections({ now = new Date() } = {}) {
  // ⚠ Read env INSIDE the function. A module-level `process.env` read is hoisted
  // above server.js's `dotenv.config()` and freezes to its default — the exact
  // trap that made TTS_CACHE_MAX_BYTES silently unsettable (audit M2).
  const entity = process.env.BIN_CALENDAR_ENTITY || DEFAULT_CALENDAR;
  const collectionDay = parseDayNumber(process.env.BIN_COLLECTION_DAY);
  const yellowRef = process.env.BIN_YELLOW_REFERENCE ?? null;

  const fallback = () => ({
    collections: collectionsFromDateMath({ collectionDay, yellowRef, now }),
    source: "fallback"
  });

  if (cache.collections && Date.now() - cache.at < CACHE_MS) {
    return { collections: cache.collections, source: "calendar" };
  }

  try {
    const start = startOfLocalDay(now);
    const end = addDays(start, LOOKAHEAD_DAYS);
    const events = await haGet(
      `/api/calendars/${encodeURIComponent(entity)}`
        + `?start=${encodeURIComponent(start.toISOString())}`
        + `&end=${encodeURIComponent(end.toISOString())}`
    );
    const collections = collectionsFromCalendar(events);
    if (!collections.length) return fallback();

    cache = { at: Date.now(), collections };
    return { collections, source: "calendar" };
  } catch {
    return fallback();
  }
}

/** Whether bins are configured at all — no weekday and no calendar means no feature. */
export function binsConfigured() {
  return parseDayNumber(process.env.BIN_COLLECTION_DAY) !== null
    || Boolean(process.env.BIN_CALENDAR_ENTITY);
}
