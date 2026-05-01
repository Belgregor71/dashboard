import fetch from 'node-fetch';
import ical from 'node-ical';
const CALENDAR_URLS = { google: process.env.CALENDAR_GOOGLE_URL, apple: process.env.CALENDAR_APPLE_URL, tripit: process.env.CALENDAR_TRIPIT_URL };
const getConfiguredCalendarUrls = () => Object.entries(CALENDAR_URLS).filter(([, url]) => Boolean(url)).map(([name, url]) => ({ name, url }));
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) { const c = new AbortController(); const t = setTimeout(() => c.abort(), timeoutMs); try { return await fetch(url, { ...options, signal: c.signal }); } finally { clearTimeout(t); } }
const buildEvent = (ev, source) => ({ title: ev.summary || '', start: ev.start ? new Date(ev.start).toISOString() : null, end: ev.end ? new Date(ev.end).toISOString() : null, location: ev.location || '', source });
export class CalendarService {
  constructor({ eventBus }) { this.eventBus = eventBus; }
  async fetchCalendar(url, sourceName) { const res = await fetchWithTimeout(url); if (!res.ok) throw new Error(`Calendar fetch failed (${res.status})`); const text = await res.text(); const data = ical.parseICS(text); return Object.values(data).filter((ev) => ev?.type === 'VEVENT').map((ev) => buildEvent(ev, sourceName)).filter((ev) => ev.start); }
  async getMergedEvents() { const urls = getConfiguredCalendarUrls(); const results = await Promise.all(urls.map(({ name, url }) => this.fetchCalendar(url, name))); const merged = results.flat().sort((a, b) => Date.parse(a.start) - Date.parse(b.start)); this.eventBus.publish({ type: 'CALENDAR_UPDATED', source: 'calendar-service', payload: { events: merged, count: merged.length } }); return merged; }
}
