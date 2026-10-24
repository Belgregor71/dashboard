/* ═══════════════════════════════════════════════════════════════════════════
   CALENDAR WRITES — "add dentist to the calendar on Tuesday at 3".

   docs/research/FIELD-SCAN.md round 2, #8. The owner's decisions (2026-10-24):
   the event goes to the calendar the household sees on its PHONES, which is the
   shared iCloud "Home" calendar — the same one the wall already reads through
   CALENDAR_APPLE_URL. It is saved at once, read back, and said; "undo that"
   takes it off again. There is no "shall I?" step, because the voice agent
   cannot hear a "yes" without the wake word.

   ⚠⚠ THE SAME RULE AS services/listWrites.js: A WRITE THAT DID NOT THROW IS NOT
   A WRITE THAT HAPPENED. Every write here is PUT → GET the same resource →
   judge, and `confirmed` is reachable from a re-read that carries our UID alone.

   Measured against iCloud 2026-10-24 from the G11: PUT answers 201, the event
   is in the published feed and on the phones within seconds, DELETE answers
   204 and a GET afterwards 404. ⚠ An iCloud `calendar-query` with a UID
   prop-filter returns NOTHING, which is why the re-read is a GET of the exact
   href we wrote rather than a search.

   The credentials (ICLOUD_CALDAV_USER, ICLOUD_CALDAV_PASSWORD — an Apple
   app-specific password) live only in the box's .env. They never reach the
   browser: the route is loopback-only and answers with the event, never the
   account.
   ═══════════════════════════════════════════════════════════════════════════ */

const ICLOUD_ROOT = "https://caldav.icloud.com/";
const MAX_TITLE = 80;
const MAX_SPAN_MS = 12 * 3_600_000;
const DAY_MS = 86_400_000;
const HORIZON_DAYS = 400;

/** Read per call, never at module load (server.js imports run before dotenv). */
export function calendarWriteConfig() {
  return {
    armed: process.env.VOICE_CALENDAR_WRITES === "1",
    user: process.env.ICLOUD_CALDAV_USER || "",
    password: process.env.ICLOUD_CALDAV_PASSWORD || "",
    calendar: process.env.ICLOUD_CALDAV_CALENDAR || "Home"
  };
}

/* ── What the wall may ask for ──────────────────────────────────────────────
   The body is re-validated here even though the browser built it: a title
   with a newline in it would end the SUMMARY line and start a property of its
   own, so control characters are stripped before anything is escaped. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @returns {{title:string, allDay:true, date:string} |
 *           {title:string, allDay:false, start:Date, end:Date} | {error:string}}
 */
export function readEventRequest(body, now = new Date()) {
  const title = String(body?.title ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!title || title.length > MAX_TITLE) return { error: `title must be 1-${MAX_TITLE} characters` };

  const earliest = now.getTime() - DAY_MS;
  const latest = now.getTime() + HORIZON_DAYS * DAY_MS;

  if (typeof body?.date === "string") {
    if (!DATE_RE.test(body.date)) return { error: "date must be YYYY-MM-DD" };
    const t = Date.parse(`${body.date}T12:00:00Z`);
    if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== body.date) return { error: "date is not a real day" };
    if (t < earliest - DAY_MS || t > latest) return { error: "date is out of range" };
    return { title, allDay: true, date: body.date };
  }

  const start = new Date(Date.parse(body?.start));
  const end = new Date(Date.parse(body?.end));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return { error: "start and end must be ISO times" };
  if (end <= start || end - start > MAX_SPAN_MS) return { error: "end must be after start, by at most 12 hours" };
  if (start.getTime() < earliest || start.getTime() > latest) return { error: "start is out of range" };
  return { title, allDay: false, start, end };
}

/* ── The event itself ─────────────────────────────────────────────────────── */

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const compactDate = (iso) => iso.replace(/-/g, "");
const escapeText = (s) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");

function nextDate(iso) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/** RFC 5545, one VEVENT. Times are written in UTC: the phones show them local. */
export function buildEvent(event, uid, now = new Date()) {
  const when = event.allDay
    ? [`DTSTART;VALUE=DATE:${compactDate(event.date)}`, `DTEND;VALUE=DATE:${compactDate(nextDate(event.date))}`]
    : [`DTSTART:${stamp(event.start)}`, `DTEND:${stamp(event.end)}`];
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//kiosk dashboard//voice//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp(now)}`, ...when,
    `SUMMARY:${escapeText(event.title)}`, "DESCRIPTION:Added by voice from the wall.",
    "END:VEVENT", "END:VCALENDAR", ""
  ].join("\r\n");
}

/* ── What the re-read proved ──────────────────────────────────────────────── */

const unescapeText = (s) => s.replace(/\\([\\;,])/g, "$1").replace(/\\n/gi, " ");

/**
 * Judge a GET of the href just written. Our UID in a 200 is the only thing that
 * confirms; the title and times are read off the stored copy when it has them,
 * so the sentence the wall speaks is the calendar's, not the request's.
 */
export function judgeReadback(status, ics, uid, sent) {
  if (status !== 200 || typeof ics !== "string") return { state: "not-saved" };
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  if (!unfolded.split(/\r?\n/).some((l) => l.trim() === `UID:${uid}`)) return { state: "not-saved" };

  const summary = /^SUMMARY[^:]*:(.*)$/m.exec(unfolded)?.[1]?.trim();
  const timed = /^DTSTART:(\d{8}T\d{6}Z)$/m.exec(unfolded)?.[1];
  const timedEnd = /^DTEND:(\d{8}T\d{6}Z)$/m.exec(unfolded)?.[1];
  const day = /^DTSTART;VALUE=DATE:(\d{8})$/m.exec(unfolded)?.[1];
  const iso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;

  const event = { title: summary ? unescapeText(summary) : sent.title };
  if (day) Object.assign(event, { allDay: true, date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}` });
  else if (timed) Object.assign(event, { allDay: false, start: iso(timed), end: timedEnd ? iso(timedEnd) : null });
  else if (sent.allDay) Object.assign(event, { allDay: true, date: sent.date });
  else Object.assign(event, { allDay: false, start: sent.start.toISOString(), end: sent.end.toISOString() });
  return { state: "confirmed", ...event };
}

/* ── Talking to iCloud ────────────────────────────────────────────────────── */

const hrefAfter = (xml, name) => new RegExp(`${name}[^>]*>\\s*<[^>]*href[^>]*>([^<]+)<`).exec(xml)?.[1];

/** The calendar collections in a Depth 1 PROPFIND of the home set. */
export function parseCollections(xml, base) {
  const out = [];
  for (const resp of String(xml).split(/<[^>]*:?response[ >]/).slice(1)) {
    const href = /<[^>]*href[^>]*>([^<]+)</.exec(resp)?.[1];
    const type = resp.match(/resourcetype[\s\S]*?\/[^>]*resourcetype/)?.[0] ?? "";
    if (!href || !/calendar\b/.test(type)) continue;
    const name = /displayname[^>]*>([^<]*)</.exec(resp)?.[1]?.trim() ?? "";
    out.push({ href: new URL(href, base).href, name });
  }
  return out;
}

/**
 * @param {{user:string, password:string, calendar:string}} cfg
 * @param {typeof fetch} fetchImpl
 */
export function createCalendarWriter(cfg, fetchImpl = fetch) {
  const auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`;
  let collection = null;   // resolved once per process; the calendar does not move

  const call = (method, url, { depth, body, type, extra } = {}) =>
    fetchImpl(url, {
      method,
      headers: {
        Authorization: auth,
        ...(depth === undefined ? {} : { Depth: String(depth) }),
        ...(type ? { "Content-Type": type } : {}),
        ...(extra ?? {})
      },
      body,
      signal: AbortSignal.timeout(10_000)
    });

  async function propfind(url, depth, prop) {
    const res = await call("PROPFIND", url, {
      depth, type: "application/xml; charset=utf-8",
      body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>${prop}</d:prop></d:propfind>`
    });
    if (res.status !== 207) throw new Error(`PROPFIND ${res.status}`);
    return { url: res.url || url, xml: await res.text() };
  }

  async function resolveCollection() {
    if (collection) return collection;
    const p1 = await propfind(ICLOUD_ROOT, 0, "<d:current-user-principal/>");
    const principal = new URL(hrefAfter(p1.xml, "current-user-principal"), p1.url).href;
    const p2 = await propfind(principal, 0, "<c:calendar-home-set/>");
    const home = new URL(hrefAfter(p2.xml, "calendar-home-set"), principal).href;
    const p3 = await propfind(home, 1, "<d:displayname/><d:resourcetype/>");
    const found = parseCollections(p3.xml, home).find((c) => c.name === cfg.calendar);
    if (!found) throw new Error(`no calendar named ${cfg.calendar}`);
    collection = found.href.endsWith("/") ? found.href : `${found.href}/`;
    return collection;
  }

  const hrefFor = async (uid) => new URL(`${encodeURIComponent(uid)}.ics`, await resolveCollection()).href;

  return {
    async add(event, uid, now = new Date()) {
      const href = await hrefFor(uid);
      await call("PUT", href, {
        type: "text/calendar; charset=utf-8",
        body: buildEvent(event, uid, now),
        extra: { "If-None-Match": "*" }
      });
      const back = await call("GET", href);
      return judgeReadback(back.status, await back.text(), uid, event);
    },
    async remove(uid) {
      const href = await hrefFor(uid);
      await call("DELETE", href);
      const back = await call("GET", href);
      await back.text();
      return back.status === 404 ? { state: "removed" } : { state: "still-there" };
    }
  };
}
