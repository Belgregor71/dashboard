/* ═══════════════════════════════════════════════════════════════════════════
   THE MONTH AHEAD — depth 3. "what have I got on for the next month?"

   calendar.js answers what is left of TODAY, and is deliberately gated to today
   (localIntents DAY_INTENTS: `"show.day": (d) => d.offset === 0`). Nothing on
   the wall could answer a question about next week or next month: the
   incumbent's widest surface was a 9-day timeline on a page nobody sees, and V3
   had no calendar view beyond six rows of today.

   ── Grouped, not gridded ────────────────────────────────────────────────────

   A month grid is thirty-odd cells on one panel, which puts the text well under
   the 32px floor — it becomes a density map, not something readable from the
   kitchen. This lists only the days that carry something, under three headings,
   which is honest about a sparse calendar: this household has eight future days
   with anything on them and printing twenty-two empty boxes to say so is worse
   than saying nothing.

   ⚠⚠ THE HORIZON IS A SERVER FACT, AND IT IS SHORTER THAN IT LOOKS.
   getRecurrenceWindow() in server/routes/calendar.js expands recurring events
   only from first-of-month −7d to last-of-month +7d. One-off events pass through
   unbounded; recurring ones simply are not in the feed past that edge. Measured
   on the live G11 on 2026-08-16: nothing at all between 27 Aug and 19 Nov.
   CALENDAR_LOOKAHEAD_DAYS widens it server-side. Without that env var this
   subject renders an honestly short month — which is a true picture of the feed,
   not a bug in the drawing.

   ⚠ ABSENT IS NOT EMPTY, for the fifth time in this codebase. A calendar that
   has never resolved returns null and the turn falls through; an empty one earns
   a sentence, because the person asked.
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, column } from "./dom.js";
import { displayTitleOf } from "./calendar.js";

const TZ = "Australia/Brisbane";

/* How far "the month" reaches. Thirty-one days rather than a calendar month so
   the answer does not shrink as the month runs out — asked on the 28th, "the
   next month" still means the next month. */
const HORIZON_DAYS = 31;

/* Rows that fit above the type floor, headings included. The seventeenth is
   spoken about rather than shrunk — the same rule showDay's MAX_ROWS follows. */
const MAX_ROWS = 16;

function clock(d) {
  return d
    .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ })
    .replace(":00", "")
    .replace(" ", "");
}

const midnightOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Future events inside the horizon, in order, one entry per event.
 *
 * Today is EXCLUDED. "What have I got on for the next month" asked at 4pm is not
 * a question about this morning, and showDay already owns today — two subjects
 * both answering it would make "show me the day" and "show me the month"
 * disagree about the same afternoon.
 *
 * Exported for the spec: the windowing and the grouping are the only decisions
 * in this file and neither needs a browser.
 */
export function eventsAhead(events, now = new Date()) {
  if (!Array.isArray(events)) return null;

  const from = midnightOf(now).getTime() + 86_400_000;              // tomorrow 00:00
  const to = midnightOf(now).getTime() + (HORIZON_DAYS + 1) * 86_400_000;

  return events
    .map((e) => ({ ...e, at: new Date(e?.start) }))
    .filter((e) => Number.isFinite(e.at.getTime()))
    .filter((e) => e.at.getTime() >= from && e.at.getTime() < to)
    .sort((a, b) => a.at - b.at);
}

/**
 * Split into THIS WEEK / NEXT WEEK / LATER.
 *
 * The boundaries are "within 7 days" and "within 14", not real week starts. A
 * Sunday-anchored week would put a Saturday event asked about on Friday into
 * "this week" and an event two days later into "next week", which is true of the
 * calendar and useless to the person asking — the groups are meant to read as
 * "soon", "after that" and "eventually".
 */
export function groupAhead(events, now = new Date()) {
  const base = midnightOf(now).getTime();
  const week = base + 8 * 86_400_000;
  const fortnight = base + 15 * 86_400_000;

  const groups = [
    { label: "This week", rows: [] },
    { label: "Next week", rows: [] },
    { label: "Later", rows: [] }
  ];

  for (const e of events) {
    const t = e.at.getTime();
    const bucket = t < week ? 0 : t < fortnight ? 1 : 2;
    groups[bucket].rows.push(e);
  }

  return groups.filter((g) => g.rows.length > 0);
}

/* The lead half of a row: the date, and the time when there is one. All-day
   events carry a midnight start that means nothing, so printing "12am" beside a
   birthday would be actively wrong. */
function leadFor(e) {
  const date = e.at.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", timeZone: TZ });
  return e.allDay ? date : `${date} · ${clock(e.at)}`;
}

/**
 * @param {object} snapshot  the voice snapshot; `calendar` is the cache
 * @returns {{node, teardown}|null}
 */
export function showAhead(snapshot, { now = new Date() } = {}) {
  const events = eventsAhead(snapshot?.calendar, now);
  if (!events) return null;                       // not loaded — fall through

  const { node, teardown } = frame("ahead");
  node.dataset.cell = "calendar";
  node.appendChild(title("The month ahead"));

  if (events.length === 0) {
    node.appendChild(column([{ text: "Nothing on for the next month." }]));
    return { node, teardown };
  }

  const stack = document.createElement("div");
  stack.className = "subject__ahead";

  /* Budget spent top-down across the groups, headings included, so a busy first
     week cannot push "Later" off the panel silently — whatever is cut is
     counted and said. */
  let budget = MAX_ROWS;
  let shown = 0;

  for (const group of groupAhead(events, now)) {
    if (budget <= 1) break;                       // no room for a heading AND a row
    budget -= 1;                                  // the heading costs one

    const take = group.rows.slice(0, budget);
    budget -= take.length;
    shown += take.length;

    const block = document.createElement("div");
    block.className = "subject__aheadgroup";
    block.appendChild(title(group.label));
    block.appendChild(column(take.map((e) => ({
      /* displayTitleOf strips the `Meal:` routing prefix. It was seen raw on
         the wall on 2026-08-08 and must never come back — and this subject is
         the one most likely to show it, because a third of this feed's events
         are meal events. */
      lead: leadFor(e),
      text: displayTitleOf(e)
    }))));
    stack.appendChild(block);
  }

  node.appendChild(stack);

  if (shown < events.length) {
    node.appendChild(column([{ text: `and ${events.length - shown} more` }]));
  }

  return { node, teardown };
}
