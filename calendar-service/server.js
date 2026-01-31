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

/* ------------------------------------------------------------------
   FETCH + PARSE A SINGLE ICS FEED
-------------------------------------------------------------------*/
async function fetchCalendar(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      throw new Error(`Calendar fetch failed (${res.status}) for ${url}`);
    }
    const text = await res.text();
    const data = ical.parseICS(text);

    const events = [];

    for (const key in data) {
      const ev = data[key];
      if (ev.type === "VEVENT") {
        events.push({
          title: ev.summary || "",
          start: ev.start ? new Date(ev.start).toISOString() : null,
          end: ev.end ? new Date(ev.end).toISOString() : null,
          location: ev.location || "",
          allDay: ev.datetype === "date",
          source: url
        });
      }
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
        console.log(`Fetching ${name}:`, url);
        const events = await fetchCalendar(url);
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

  const events = await fetchCalendar(url);
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
