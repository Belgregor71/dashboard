/* ═══════════════════════════════════════════════════════════════════════════
   THE MEAL EVENT — one answer to "what is for dinner tonight".

   Dinner is not an entity or a feed. It is a calendar event whose title starts
   "Meal: ", a convention the household types by hand. Four files already knew
   that independently — modules/calendar.js, modules/recipePanel.js,
   modules/tonightsMenu.js and services/houseSnapshot.js each carry their own
   copy of the same regex — and a fifth copy for V3 would have been the shape of
   drift this repo has already paid for once (nextEventPanel's window constants,
   duplicated into houseSnapshot, still owed).

   So this is the shared home. houseSnapshot and voiceSnapshot both read it,
   which is what lets the fast lane, the attention queue and V3's recipe subject
   agree about tonight's dinner without three parsers.

   Pure, DOM-free, no imports. That is deliberate: voiceSnapshot is on the
   answer path and is unit-tested in plain node, so anything it pulls in has to
   be safe to import with no window and no config.
   ═══════════════════════════════════════════════════════════════════════════ */

export const MEAL_PREFIX = /^Meal:\s*/;

const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Tonight's dish, or null.
 *
 * ⚠ NOT LOADED IS NOT EMPTY. A non-array (the calendar cache before its first
 * fetch, or after an upstream failure) returns null, exactly as a day with no
 * meal event does — but the CALLER is the one that has to tell those apart,
 * which is why every caller here checks `Array.isArray` itself before deciding
 * whether it is entitled to say "no dinner planned".
 *
 * @param {Array}  events  calendar events, as /api/calendar/all returns them
 * @param {Date}   now     injectable clock
 * @returns {string|null}  the dish name with the prefix stripped
 */
export function menuFrom(events, now = new Date()) {
  if (!Array.isArray(events)) return null;
  for (const ev of events) {
    const title = ev?.displayTitle || ev?.title || "";
    if (!MEAL_PREFIX.test(title)) continue;
    const start = toDate(ev?.start);
    if (!start || !isSameDay(start, now)) continue;
    const name = title.replace(MEAL_PREFIX, "").trim();
    if (name) return name;
  }
  return null;
}
