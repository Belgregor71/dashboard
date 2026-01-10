import express from "express";
import fetch from "node-fetch";
import ical from "node-ical";

const app = express();
const PORT = 5000;

// Your ICS URLs (replace with your real private links)
const CALENDAR_URLS = {
  google: "https://calendar.google.com/calendar/ical/gdee71%40gmail.com/private-df4b1b39a6d1229f7d38d2db53d09299/basic.ics",
  apple: "https://p109-caldav.icloud.com/published/2/MTA3OTc2NDk1MTA3OTc2NE6mIbLn4WuDJuvs1Iwj_UA-nxv8Fm-57kpX9w8wPtwK",
  tripit: "https://www.tripit.com/feed/ical/private/1E6AF450-A736DF29289A93225C40E84D378EA141/tripit.ics"
};

// Fetch + parse a single ICS feed
async function fetchCalendar(url) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    const data = ical.parseICS(text);

    const events = [];

    for (const key in data) {
      const ev = data[key];
      if (ev.type === "VEVENT") {
        events.push({
          title: ev.summary || "",
          start: ev.start,
          end: ev.end,
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

// Merge all calendars
async function getMergedEvents() {
  const all = await Promise.all(
    Object.values(CALENDAR_URLS).map(url => fetchCalendar(url))
  );
  return all.flat().sort((a, b) => a.start - b.start);
}

// Endpoints
app.get("/calendar/:source", async (req, res) => {
  const src = req.params.source;
  const url = CALENDAR_URLS[src];

  if (!url) return res.status(400).json({ error: "Unknown calendar source" });

  const events = await fetchCalendar(url);
  res.json(events);
});

app.get("/calendar/all", async (req, res) => {
  const events = await getMergedEvents();
  res.json(events);
});

app.listen(PORT, () => {
  console.log(`Calendar service running on http://localhost:${PORT}`);
});
