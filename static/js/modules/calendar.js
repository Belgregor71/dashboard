import { CALENDAR_SOURCES } from "../config/config.js";

export async function fetchAllEvents() {
  const all = [];

  for (const src of CALENDAR_SOURCES) {
    try {
      const res = await fetch(src.icsUrl);
      const text = await res.text();
      const events = parseICS(text, src);
      all.push(...events);
    } catch (err) {
      console.error("Calendar error:", src.name, err);
    }
  }

  return all;
}

export function parseICS(text, source) {
  const events = [];
  const lines = text.split(/\r?\n/);
  let evt = null;

  const flush = () => {
    if (evt && evt.start && evt.end && evt.summary) {
      events.push(evt);
    }
    evt = null;
  };

  for (let line of lines) {
    line = line.trim();

    if (line === "BEGIN:VEVENT") {
      evt = { source, summary: "" };
    } else if (line === "END:VEVENT") {
      flush();
    } else if (evt) {
      if (line.startsWith("DTSTART")) {
        evt.start = parseICSDate(line.split(":")[1]);
      } else if (line.startsWith("DTEND")) {
        evt.end = parseICSDate(line.split(":")[1]);
      } else if (line.startsWith("SUMMARY")) {
        evt.summary = line.split(":").slice(1).join(":");
      }
    }
  }

  return events;
}

export function parseICSDate(val) {
  if (!val) return null;

  if (/^\d{8}T\d{6}Z$/.test(val)) {
    const y = +val.slice(0, 4);
    const m = +val.slice(4, 6) - 1;
    const d = +val.slice(6, 8);
    const h = +val.slice(9, 11);
    const min = +val.slice(11, 13);
    const s = +val.slice(13, 15);
    return new Date(Date.UTC(y, m, d, h, min, s));
  }

  if (/^\d{8}$/.test(val)) {
    const y = +val.slice(0, 4);
    const m = +val.slice(4, 6) - 1;
    const d = +val.slice(6, 8);
    return new Date(y, m, d);
  }

  return new Date(val);
}
