console.log(">>> RUNNING UPDATED CALENDAR SERVICE <<<");

import dotenv from "dotenv";
import express from "express";
import fetch from "node-fetch";
import ical from "node-ical";

dotenv.config();

const app = express();
const PORT = 5000;

/* ------------------------------------------------------------------
   ICS FEED URLS (YOUR PRIVATE LINKS)
-------------------------------------------------------------------*/
const CALENDAR_URLS = {
  google: process.env.CALENDAR_GOOGLE_URL,
  apple: process.env.CALENDAR_APPLE_URL,
  tripit: process.env.CALENDAR_TRIPIT_URL
};

function getConfiguredCalendarUrls() {
  return Object.entries(CALENDAR_URLS)
    .filter(([, url]) => Boolean(url))
    .map(([name, url]) => ({ name, url }));
}

for (const [name, url] of Object.entries(CALENDAR_URLS)) {
  if (!url) {
    console.warn(`Calendar URL missing for ${name}.`);
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
  return Object.values(ev.exdate).some(ex => ex instanceof Date && ex.getTime() === time);
}

function getRecurrenceOverride(date, ev) {
  if (!ev.recurrences) return null;
  const iso = date.toISOString();
  if (ev.recurrences[iso]) return ev.recurrences[iso];
  const matchKey = Object.keys(ev.recurrences).find(
    key => new Date(key).getTime() === date.getTime()
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

/* ------------------------------------------------------------------
   FETCH + PARSE A SINGLE ICS FEED
-------------------------------------------------------------------*/
async function fetchCalendar(url, sourceName = "") {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      throw new Error(`Calendar fetch failed (${res.status}) for ${url}`);
    }
    const text = await res.text();
    const data = ical.parseICS(text);

    const events = [];

    const { rangeStart, rangeEnd } = getRecurrenceWindow();

    for (const key in data) {
      const ev = data[key];
      if (ev.type !== "VEVENT") continue;

      if (ev.rrule) {
        const durationMs =
          ev.end && ev.start ? ev.end.getTime() - ev.start.getTime() : 0;
        const occurrences = ev.rrule.between(rangeStart, rangeEnd, true);
        const added = new Set();

        for (const occurrence of occurrences) {
          if (isExcludedDate(occurrence, ev)) continue;
          const overrideEvent = getRecurrenceOverride(occurrence, ev);
          const start = overrideEvent?.start || occurrence;
          let end = overrideEvent?.end;
          if (!end && durationMs) {
            end = new Date(start.getTime() + durationMs);
          }

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
    console.error("ICS fetch error:", err);
    return [];
  }
}

/* ------------------------------------------------------------------
   MERGE ALL CALENDARS
-------------------------------------------------------------------*/
async function getMergedEvents() {
  try {
    console.log("Fetching merged calendars...");

    const urls = getConfiguredCalendarUrls();

    if (urls.length === 0) {
      console.warn("No calendar URLs configured.");
      return [];
    }

    const results = await Promise.all(
      urls.map(async ({ name, url }) => {
        console.log(`Fetching ${name} calendar`);
        const events = await fetchCalendar(url, name);
        console.log("Fetched", events.length, "events from", name);
        return events;
      })
    );

    const merged = results.flat().filter(ev => ev.start);

    merged.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

    console.log("Merged total:", merged.length);

    return merged;
  } catch (err) {
    console.error("Merged calendar error:", err);
    return [];
  }
}

/* ------------------------------------------------------------------
   ENDPOINT: INDIVIDUAL CALENDAR
-------------------------------------------------------------------*/
app.get("/calendar/:source(google|apple|tripit)", async (req, res) => {

  const src = req.params.source;
  const url = CALENDAR_URLS[src];

  if (!url) {
    return res.status(400).json({ error: "Unknown or unconfigured calendar source" });
  }

  const events = await fetchCalendar(url, src);
  res.json(events);
});

/* ------------------------------------------------------------------
   ENDPOINT: MERGED CALENDAR
-------------------------------------------------------------------*/
app.get("/calendar/all", async (req, res) => {
  if (getConfiguredCalendarUrls().length === 0) {
    return res.status(500).json({ error: "No calendar URLs configured" });
  }
  const events = await getMergedEvents();
  res.json(events);
});

/* ------------------------------------------------------------------
   START SERVER
-------------------------------------------------------------------*/
app.listen(PORT, () => {
  console.log(`Calendar service running on http://localhost:${PORT}`);
});
