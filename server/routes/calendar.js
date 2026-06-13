import express from "express";
import { readFile, stat, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import ical from "node-ical";
import { HOLIDAY_REGION_DEFAULT, HOLIDAY_COUNTRY } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOLIDAY_CACHE_DIR = path.join(__dirname, "..", "..", "data", "holiday-cache");
const HOLIDAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const router = express.Router();

// --- iCal parsing ---

function getRecurrenceWindow(referenceDate = new Date()) {
  const rangeStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  rangeStart.setDate(rangeStart.getDate() - 7);
  const rangeEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0);
  rangeEnd.setDate(rangeEnd.getDate() + 7);
  rangeEnd.setHours(23, 59, 59, 999);
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
    const merged = results.flat().filter((ev) => ev.start);
    merged.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    res.json(merged);
  } catch (err) {
    console.error("Calendar ALL proxy error:", err);
    res.status(500).json({ error: "Calendar all error" });
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
