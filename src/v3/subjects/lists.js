/* ═══════════════════════════════════════════════════════════════════════════
   THE LIST — depth 3. "show me the shopping list."

   The plan is explicit that this is a screen job: *never speak a list of more
   than three.* The fast lane already honours that by saying the first three and
   counting the rest, which until now pointed at nothing. This is the thing it
   was pointing at.

   ⚠ NOT LOADED IS NOT EMPTY, and this is the path where it did real damage.
   `openTodoSummaries()` returns [] for an entity that is absent, which is
   indistinguishable from a list that is genuinely empty — and with Home
   Assistant disconnected the house said "the shopping list is empty" with total
   confidence, on the one morning someone was relying on it. voiceSnapshot now
   returns null in that case, and null means we do not show a subject at all.
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, column } from "./dom.js";

/* Twelve at 96px is the panel's honest ceiling. A shopping list longer than
   that is a scroll, and a scroll is a thing you operate — this surface has no
   touch and no pointer, so there is nothing to operate it with. */
const MAX_ROWS = 12;

const LISTS = {
  shopping: { key: "shopping", heading: "Shopping", empty: "The shopping list is empty." },
  todo:     { key: "tasks",    heading: "To do",    empty: "Nothing on your list." }
};

/**
 * @param {object} snapshot   the voice snapshot
 * @param {string} which      "shopping" | "todo"
 * @returns {{node, teardown}|null}
 */
export function showList(snapshot, which = "shopping") {
  const spec = LISTS[which] ?? LISTS.shopping;
  const items = snapshot?.todos?.[spec.key];
  if (!Array.isArray(items)) return null;         // HA is down — say nothing

  const { node, teardown } = frame("list");
  // The deixis address is the list, not the generic "list": "shopping" and
  // "todo" are what localAnswers names in its refs.
  node.dataset.cell = which === "todo" ? "todo" : "shopping";
  node.appendChild(title(spec.heading));

  const rows = items.length === 0
    ? [{ text: spec.empty }]
    : items.slice(0, MAX_ROWS).map((item) => ({ text: String(item) }));

  if (items.length > MAX_ROWS) rows.push({ text: `and ${items.length - MAX_ROWS} more` });
  node.appendChild(column(rows));

  return { node, teardown };
}
