import express from "express";
import { readFile, stat, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import ical from "node-ical";
import { HOLIDAY_REGION_DEFAULT, HOLIDAY_COUNTRY } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { reportFailure, reportSuccess } from "../services/healthService.js";
import { loopbackOnly } from "../middleware/security.js";
import { calendarWriteConfig, createCalendarWriter, readEventRequest } from "../services/calendarWrite.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOLIDAY_CACHE_DIR = path.join(__dirname, "..", "..", "data", "holiday-cache");
const HOLIDAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const router = express.Router();

// --- iCal parsing ---

/* How far past the month's own edge to keep expanding recurring events.
   Default 0 = the exact window this has always used, so an unset environment
   changes nothing.

   ⚠ THIS IS THE HORIZON OF EVERY CALENDAR ANSWER IN THE HOUSE, and it was
   shorter than anything downstream assumed. The window below is anchored to the
   CALENDAR MONTH, not to now: asked on the 16th it reaches 7 Sep, and asked on
   the 30th it reaches the same date — so "the next month" shrinks as the month
   runs out. One-off events pass through unfiltered at any distance, so this only
   ever bounds RECURRING ones, which is why the gap is invisible until someone
   asks about a birthday. Measured on the live G11 2026-08-16: the feed carried
   nothing at all between 27 Aug and 19 Nov.

   Read per call, not at module load — server/config.js's own note about a
   module-load process.env read frozen above dotenv is the M2 audit finding, and
   this file is imported early enough to hit it. */
function lookaheadDays() {
  const raw = Number(process.env.CALENDAR_LOOKAHEAD_DAYS ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  /* Bounded. Recurrence expansion is O(occurrences), and a daily event over a
     year is 365 objects per feed built on every uncached request — a typo of
     3650 would turn a calendar fetch into a stall. */
  return Math.min(raw, 400);
}

/* Exported for tests/calendar-window.spec.js. The env var cannot be varied
   per-request against the running test server, so the only honest place to pin
   this decision is here, where the reference date and the variable are both
   injectable. */
export function getRecurrenceWindow(referenceDate = new Date()) {
  const rangeStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  rangeStart.setDate(rangeStart.getDate() - 7);
  const rangeEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0);
  rangeEnd.setDate(rangeEnd.getDate() + 7);
  rangeEnd.setHours(23, 59, 59, 999);

  /* Extend, never shorten: whichever edge is further out wins, so setting this
     can only ever ADD events. That one-directional rule is what makes the
     change safe to ship on — a route that returned FEWER events than before
     would silently empty every consumer that filters by day. */
  const ahead = lookaheadDays();
  if (ahead > 0) {
    const floor = new Date(referenceDate);
    floor.setDate(floor.getDate() + ahead);
    floor.setHours(23, 59, 59, 999);
    if (floor > rangeEnd) return { rangeStart, rangeEnd: floor };
  }

  return { rangeStart, rangeEnd };
}

function isExcludedDate(date, ev) {
  if (!ev.exdate) return false;
  const time = date.getTime();
  return Object.values(ev.exdate).some((ex) => ex instanceof Date && ex.getTime() === time);
}

function getRecurrenceOverride(date, ev) {
  if (!ev.recurrences) return null;
  const iso = date.toISOString();
  if (ev.recurrences[iso]) return ev.recurrences[iso];
  const matchKey = Object.keys(ev.recurrences).find(
    (key) => new Date(key).getTime() === date.getTime()
  );
  return matchKey ? ev.recurrences[matchKey] : null;
}

function buildEvent(baseEvent, overrideEvent, start, end, sourceName) {
  const sourceEvent = overrideEvent || baseEvent;
  return {
    title: sourceEvent.summary || baseEvent.summary || "",
    start: start ? new Date(start).toISOString() : null,
    end: end ? new Date(end).toISOString() : null,
    location: sourceEvent.location || baseEvent.location || "",
    allDay: (sourceEvent.datetype || baseEvent.datetype) === "date",
    source: sourceName
  };
}

async function fetchCalendar(url, sourceName = "") {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Calendar fetch failed (${res.status}) for ${url}`);
    const text = await res.text();
    const data = ical.parseICS(text);
    const events = [];
    const { rangeStart, rangeEnd } = getRecurrenceWindow();

    for (const key in data) {
      const ev = data[key];
      if (ev.type !== "VEVENT") continue;

      if (ev.rrule) {
        const durationMs = ev.end && ev.start ? ev.end.getTime() - ev.start.getTime() : 0;
        const occurrences = ev.rrule.between(rangeStart, rangeEnd, true);
        const added = new Set();

        for (const occurrence of occurrences) {
          if (isExcludedDate(occurrence, ev)) continue;
          const overrideEvent = getRecurrenceOverride(occurrence, ev);
          const start = overrideEvent?.start || occurrence;
          let end = overrideEvent?.end;
          if (!end && durationMs) end = new Date(start.getTime() + durationMs);
          const keyTime = start ? start.getTime() : occurrence.getTime();
          if (added.has(keyTime)) continue;
          added.add(keyTime);
          events.push(buildEvent(ev, overrideEvent, start, end, sourceName));
        }

        if (ev.recurrences) {
          for (const recurrence of Object.values(ev.recurrences)) {
            if (!recurrence?.start) continue;
            if (recurrence.start < rangeStart || recurrence.start > rangeEnd) continue;
            const keyTime = recurrence.start.getTime();
            if (added.has(keyTime)) continue;
            added.add(keyTime);
            events.push(buildEvent(ev, recurrence, recurrence.start, recurrence.end, sourceName));
          }
        }
        continue;
      }

      events.push(buildEvent(ev, null, ev.start, ev.end, sourceName));
    }

    return events;
  } catch (err) {
    console.error("Calendar fetch error:", err);
    return [];
  }
}

// --- Holiday helpers ---

async function readHolidayFallback(region, year) {
  const fallbackPath = path.join(
    __dirname, "..", "..", "static", "data",
    `holidays_${String(region).toLowerCase()}_${year}.json`
  );
  try {
    const raw = await readFile(fallbackPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeHolidayRows(rows = [], region = HOLIDAY_REGION_DEFAULT) {
  return rows
    .map((row) => {
      const date = row.date || row.start;
      const title = row.localName || row.name || row.title;
      if (!date || !title) return null;
      return {
        id: `holiday:${region}:${date}:${title}`,
        title,
        start: date,
        end: date,
        allDay: true,
        source: "holidays",
        location: "Queensland, AU"
      };
    })
    .filter(Boolean);
}

function isHolidayForRegion(row, region) {
  if (!row || !region) return false;
  if (row.global === true) return true;
  if (!Array.isArray(row.counties)) return false;
  return row.counties.includes(`AU-${region}`);
}

async function readHolidayCache(region, year) {
  try {
    const filePath = path.join(HOLIDAY_CACHE_DIR, `${String(region).toLowerCase()}_${year}.json`);
    const fileStats = await stat(filePath);
    if (Date.now() - fileStats.mtimeMs > HOLIDAY_CACHE_TTL_MS) return null;
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeHolidayCache(region, year, rows) {
  try {
    await mkdir(HOLIDAY_CACHE_DIR, { recursive: true });
    const filePath = path.join(HOLIDAY_CACHE_DIR, `${String(region).toLowerCase()}_${year}.json`);
    await writeFile(filePath, JSON.stringify(rows), "utf8");
  } catch (error) {
    console.warn("Unable to write holiday cache", error.message);
  }
}

async function fetchPublicHolidays(region, year) {
  const cached = await readHolidayCache(region, year);
  if (cached) return normalizeHolidayRows(cached, region);

  try {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${HOLIDAY_COUNTRY}`;
    const response = await fetchWithTimeout(url, {}, 6000);
    if (!response.ok) throw new Error(`holiday api ${response.status}`);
    const rows = await response.json();
    const filtered = Array.isArray(rows) ? rows.filter((row) => isHolidayForRegion(row, region)) : [];
    await writeHolidayCache(region, year, filtered);
    return normalizeHolidayRows(filtered, region);
  } catch (error) {
    console.warn("Holiday API unavailable, using local fallback", error.message);
    const fallbackRows = await readHolidayFallback(region, year);
    return normalizeHolidayRows(fallbackRows, region);
  }
}

// --- Routes ---

router.get("/api/calendar/holidays", async (req, res) => {
  const region = String(req.query.region || HOLIDAY_REGION_DEFAULT).toUpperCase();
  const year = Number.parseInt(String(req.query.year || new Date().getFullYear()), 10);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    res.status(400).json({ error: "Invalid year" });
    return;
  }
  try {
    const holidays = await fetchPublicHolidays(region, year);
    res.json(holidays);
  } catch (error) {
    console.error("Holiday endpoint failed", error);
    res.json([]);
  }
});

/* Whose feed is whose, for "am I free" once the voice knows who asked
   (docs/design/HANDOVER-SPEAKER-ID.md). CALENDAR_OWNERS="google:Greg" tags
   every event from that feed with `owner: "Greg"`; a feed not listed is
   shared and carries no owner. Unset = no event has the key, which is the
   payload exactly as it was. Read per request: server.js's static imports
   evaluate before dotenv.config(). Lives in .env, never in config.js, which
   ships in the public bundle. */
export function calendarOwners(raw = process.env.CALENDAR_OWNERS) {
  const owners = {};
  for (const pair of String(raw ?? "").split(",")) {
    const [src, name] = pair.split(":").map((s) => s?.trim());
    if (src && name) owners[src] = name;
  }
  return owners;
}

router.get("/api/calendar/all", async (_req, res) => {
  const calendarUrls = {
    google: process.env.CALENDAR_GOOGLE_URL,
    apple: process.env.CALENDAR_APPLE_URL,
    tripit: process.env.CALENDAR_TRIPIT_URL
  };
  try {
    const urls = Object.entries(calendarUrls).filter(([, value]) => Boolean(value));
    if (urls.length === 0) {
      res.status(500).json({ error: "Calendar URLs missing" });
      return;
    }
    const results = await Promise.all(
      urls.map(([sourceName, url]) => fetchCalendar(url, sourceName))
    );
    const owners = calendarOwners();
    const merged = results.flat().filter((ev) => ev.start)
      .map((ev) => (owners[ev.source] ? { ...ev, owner: owners[ev.source] } : ev));
    merged.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    reportSuccess("calendar");
    res.json(merged);
  } catch (err) {
    console.error("Calendar ALL proxy error:", err);
    reportFailure("calendar", err?.message);
    res.status(500).json({ error: "Calendar all error" });
  }
});

/* ── Voice writes to the shared iCloud calendar (services/calendarWrite.js) ──
   Loopback-only: the account behind it is the household's, and the only
   legitimate caller is the kiosk page on this box. Two keys, as with the lists:
   the wall's v3VoiceCalendarAdd decides whether the sentence is claimed, and
   VOICE_CALENDAR_WRITES=1 here decides whether anything can be written. */
const UNDO_WINDOW_MS = 10 * 60_000;
let lastAdd = null;           // { uid, title, at } — what "undo that" removes
let writer = null;
let writerKey = "";

function calendarWriter() {
  const cfg = calendarWriteConfig();
  if (!cfg.armed) return { status: 403, error: "calendar writes are not enabled" };
  if (!cfg.user || !cfg.password) return { status: 503, error: "calendar credentials are not configured" };
  const key = `${cfg.user}\n${cfg.password}\n${cfg.calendar}`;
  if (!writer || key !== writerKey) {
    writer = createCalendarWriter(cfg);
    writerKey = key;
  }
  return { writer, calendar: cfg.calendar };
}

router.post("/api/calendar/events", loopbackOnly("The calendar write lane"), async (req, res) => {
  const lane = calendarWriter();
  if (lane.error) return res.status(lane.status).json({ error: lane.error });
  const event = readEventRequest(req.body);
  if (event.error) return res.status(400).json({ error: event.error });

  const uid = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@dashboard`;
  try {
    const result = await lane.writer.add(event, uid);
    if (result.state === "confirmed") lastAdd = { uid, title: result.title, at: Date.now() };
    return res.json({ ...result, calendar: lane.calendar });
  } catch (err) {
    console.error("[Calendar] write error:", err.message);
    return res.json({ state: "unreachable", calendar: lane.calendar });
  }
});

router.post("/api/calendar/events/undo", loopbackOnly("The calendar write lane"), async (_req, res) => {
  const lane = calendarWriter();
  if (lane.error) return res.status(lane.status).json({ error: lane.error });
  if (!lastAdd || Date.now() - lastAdd.at > UNDO_WINDOW_MS) {
    lastAdd = null;
    return res.json({ state: "nothing-to-undo", calendar: lane.calendar });
  }
  const { uid, title } = lastAdd;
  try {
    const result = await lane.writer.remove(uid);
    if (result.state === "removed") lastAdd = null;
    return res.json({ ...result, title, calendar: lane.calendar });
  } catch (err) {
    console.error("[Calendar] undo error:", err.message);
    return res.json({ state: "unreachable", title, calendar: lane.calendar });
  }
});

// IMPORTANT: prevent ":source" from matching "all"
router.get("/api/calendar/:source(google|apple|tripit)", async (req, res) => {
  const src = req.params.source;
  const calendarUrls = {
    google: process.env.CALENDAR_GOOGLE_URL,
    apple: process.env.CALENDAR_APPLE_URL,
    tripit: process.env.CALENDAR_TRIPIT_URL
  };
  const calendarUrl = calendarUrls[src];
  if (!calendarUrl) {
    res.status(500).json({ error: "Calendar URL missing" });
    return;
  }
  try {
    const events = await fetchCalendar(calendarUrl, src);
    res.json(events);
  } catch (err) {
    console.error("Calendar proxy error:", err);
    res.status(500).json({ error: "Calendar error" });
  }
});

export default router;
