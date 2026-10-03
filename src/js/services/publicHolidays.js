/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by V3 (the wall). The incumbent that shared it was retired 2026-10-03.
   `src/js/` is not the old dashboard — it is V3's runtime library.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC HOLIDAYS — features.v3PublicHolidays (L3 of the incumbent retirement,
   docs/audit/INCUMBENT-RETIREMENT-2026-10-03.md §5).

   The incumbent merged QLD public holidays into its month view and put a warm
   edge on the wall on the day itself (calendar/holidays.js + background.js).
   V3 never fetched /api/calendar/holidays, so "is Monday a public holiday" had
   no answer anywhere once the incumbent went. This is the port.

   One merge point: voiceSnapshot() hands the merged list to every reader of
   `snapshot.calendar` — the day, the ahead list, and the local answers. The
   house cache is deliberately NOT merged: its only calendar readers are the
   next-event line (all-day events are skipped there) and tonight's menu.

   ⚠ ABSENT IS NOT EMPTY. A calendar cache that has never resolved stays null;
   holidays are added to a calendar we hold, never used to invent one.

   ⚠ A FAILED FETCH IS NOT "NO HOLIDAYS THIS YEAR". The incumbent cached [] for
   the life of the page on one failure, which on a wall that runs for weeks is
   a year without holidays. Here a failure is retried on the next refresh.
   ═══════════════════════════════════════════════════════════════════════════ */

const DAY_MS = 24 * 60 * 60 * 1000;

/** year -> { at, rows } — only successful reads are stored. */
const byYear = new Map();

/* Read per call, never at load (node specs have no window), and by literal
   property: tests/flag-surface.spec.js recognises read FORMS, so a
   `features?.[NAME]` here would make the flag look unread. */
function flag() {
  return Boolean(globalThis.window?.CONFIG?.features?.v3PublicHolidays);
}

/* The route answers "YYYY-MM-DD". Re-stated as LOCAL midnight in ISO, the shape
   /api/calendar/all gives an ICS all-day event, so every reader's day maths
   treats the two the same. */
function localMidnightIso(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ""));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString();
}

export function normalizeHoliday(row) {
  const start = localMidnightIso(row?.start ?? row?.date);
  const title = String(row?.title ?? row?.localName ?? row?.name ?? "").trim();
  if (!start || !title) return null;
  return { id: `holiday:${start}:${title}`, title, start, end: start, allDay: true, source: "holidays", isHoliday: true };
}

function yearsFor(now) {
  const years = [now.getFullYear()];
  // December looks ahead to New Year's Day; the ahead list spans the boundary.
  if (now.getMonth() === 11) years.push(now.getFullYear() + 1);
  return years;
}

/** Fetch any year not read in the last day. Never throws. */
export async function refreshHolidays(now = new Date(), fetchImpl = globalThis.fetch) {
  if (!flag() || typeof fetchImpl !== "function") return;
  await Promise.all(yearsFor(now).map(async (year) => {
    const held = byYear.get(year);
    if (held && now.getTime() - held.at < DAY_MS) return;
    try {
      const res = await fetchImpl(`/api/calendar/holidays?year=${year}`);
      if (!res?.ok) return;
      const body = await res.json();
      if (!Array.isArray(body)) return;
      byYear.set(year, { at: now.getTime(), rows: body.map(normalizeHoliday).filter(Boolean) });
    } catch { /* upstream down — retried next refresh */ }
  }));
}

function allHolidays() {
  return [...byYear.values()].flatMap((y) => y.rows);
}

function dayKey(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toDateString() : null;
}

/** The calendar with public holidays added. Flag off, or a cold calendar, is
 *  the input itself — the same reference, so flag-off is behaviour-identical.
 *  A holiday already on the calendar (same title, same day) is not doubled. */
export function withHolidays(events) {
  if (!flag() || !Array.isArray(events)) return events;
  const holidays = allHolidays();
  if (!holidays.length) return events;
  const seen = new Set(events.map((e) => `${String(e?.title ?? "").toLowerCase()}|${dayKey(e?.start)}`));
  const extra = holidays.filter((h) => !seen.has(`${h.title.toLowerCase()}|${dayKey(h.start)}`));
  if (!extra.length) return events;
  return [...events, ...extra].sort((a, b) => Date.parse(a?.start) - Date.parse(b?.start));
}

/** Today's holiday title, or null. Flag off is always null. */
export function holidayToday(now = new Date()) {
  if (!flag()) return null;
  const key = now.toDateString();
  return allHolidays().find((h) => dayKey(h.start) === key)?.title ?? null;
}

/** Test seam: forget every year read. */
export function resetHolidays() {
  byYear.clear();
}
