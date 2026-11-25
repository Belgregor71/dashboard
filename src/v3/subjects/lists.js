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

import { frame, title, column, empty } from "./dom.js";

/* A ceiling on what is ever BUILT, not what fits. A shopping list longer than
   the glass is a scroll, and a scroll is a thing you operate — this surface has
   no touch and no pointer. What fits is MEASURED after mount (fitRows): rows
   pitch at ~120px, not the 96px this number once assumed, and the "twelve fit"
   count put a clipped 7th row and an "and 3 more" at y=1722, off the glass
   (critique 2026-11-25, P0). The household reads a clipped list as complete. */
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

  if (items.length === 0) {
    node.appendChild(empty(spec.empty));
    return { node, teardown };
  }

  let list = column(rowsFor(items, Math.min(items.length, MAX_ROWS)));
  node.appendChild(list);
  const render = (n) => {
    const next = column(rowsFor(items, n));
    list.replaceWith(next);
    list = next;
  };
  const stop = fitRows(() => list, render, Math.min(items.length, MAX_ROWS));

  return { node, teardown: () => { stop(); teardown(); } };
}

/** The first n items, then "and N more" for the rest — the count is part of the
 *  answer, so it must be ON the glass, never the row that gets clipped. */
function rowsFor(items, n) {
  const rows = items.slice(0, n).map((item) => ({ text: String(item) }));
  if (items.length > n) rows.push({ text: `and ${items.length - n} more` });
  return rows;
}

/** Step n down until the last row (the count included) ends inside the list's
 *  own box, which the frame's padding already holds off the safe edge. Measured
 *  only once mounted and laid out — a detached node measures 0 and "fits"
 *  (recipe.js's lesson) — and again when a late font face lands, which reflows
 *  the said voice (spread.js's lesson). Never below one item. */
function fitRows(getList, render, max) {
  let raf = null;
  let tries = 0;
  let live = true;
  const fits = () => {
    const list = getList();
    const last = list.lastElementChild;
    return !last || last.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 0.5;
  };
  /* Re-render only to step DOWN (or back up to max for a re-fit). A list that
     already fits keeps the nodes it mounted with: replacing them anyway handed
     every reader holding a row a detached node (the contrast sweep saw six
     rows "put NO pixel on the glass"). */
  let shown = max;
  const fit = () => {
    if (shown !== max) render((shown = max));
    while (shown > 1 && !fits()) render(--shown);
    getList().dataset.fit = String(shown);
  };
  const wait = () => {
    raf = null;
    const list = getList();
    if (!live) return;
    if (!list.isConnected || list.clientHeight === 0) {
      if (++tries <= 120) raf = requestAnimationFrame(wait);   // ~2s, then give up
      return;
    }
    fit();
    if (document.fonts?.status === "loading") document.fonts.ready.then(() => { if (live && getList().isConnected) fit(); });
  };
  raf = requestAnimationFrame(wait);
  return () => { live = false; if (raf != null) cancelAnimationFrame(raf); raf = null; };
}
