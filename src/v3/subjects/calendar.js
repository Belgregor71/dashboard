/* ═══════════════════════════════════════════════════════════════════════════
   THE DAY — depth 3. "show me my day."

   The incumbent has a timeline view, a next-event panel and a temporal spine,
   which between them answer three different questions. This answers one: what
   is left of today, in order, at a size that reads from the far side of the
   kitchen.

   ⚠ ABSENT IS NOT EMPTY, for the fourth time in this codebase. A calendar cache
   that has never resolved and a day with nothing on it are different facts and
   only one of them is ours to state. A non-array returns null and the turn
   falls through; an empty array earns "nothing on today" and the screen says so
   in the house's own voice, because the person ASKED and silence would read as
   a broken subject.
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, column } from "./dom.js";

/* Six rows at 96px inside the safe area. The fix for a seventh is not a smaller
   row — nothing below the 32px floor is received at 3m, and a shrunken list is
   a list nobody reads. The seventh is spoken about instead. */
const MAX_ROWS = 6;

const TZ = "Australia/Brisbane";

function at(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function clock(d) {
  return d
    .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ })
    .replace(":00", "")
    .replace(" ", "");
}

/** Today's events in order, from `now` onwards, plus the ones already running.
 *  Exported for the spec: the windowing is the only decision in this file and
 *  it should be testable without a browser. */
export function eventsForDay(events, now = new Date()) {
  if (!Array.isArray(events)) return null;
  const key = now.toDateString();
  return events
    .map((e) => ({ ...e, at: at(e?.start) }))
    .filter((e) => e.at && e.at.toDateString() === key)
    .sort((a, b) => a.at - b.at);
}

/**
 * @param {object} snapshot  the voice snapshot; `calendar` is the cache, and
 *                           may be undefined when the upstream has never
 *                           answered — which is not the same as an empty day.
 * @returns {{node: HTMLElement, teardown: Function}|null}  null means "nothing
 *          to show", and the caller must not deepen on it.
 */
export function showDay(snapshot, { now = new Date() } = {}) {
  const events = eventsForDay(snapshot?.calendar, now);
  if (!events) return null;                       // not loaded — fall through

  const { node, teardown } = frame("calendar");
  node.appendChild(title(now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })));

  if (events.length === 0) {
    node.appendChild(column([{ text: "Nothing on today." }]));
  } else {
    const rows = events.slice(0, MAX_ROWS).map((e) => ({
      lead: e.allDay ? "all day" : clock(e.at),
      text: e.displayTitle || e.title || "Something"
    }));
    if (events.length > MAX_ROWS) {
      rows.push({ text: `and ${events.length - MAX_ROWS} more` });
    }
    node.appendChild(column(rows));
  }

  return { node, teardown };
}
