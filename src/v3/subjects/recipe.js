/* ═══════════════════════════════════════════════════════════════════════════
   THE RECIPE — depth 3. "what's for dinner", "show me the recipe."

   Dinner is a "Meal:"-prefixed calendar event; the dish name comes from
   services/mealEvent.js via the voice snapshot, and the method comes from
   /api/recipe, which is a cache the household's own recipe portal writes into.

   ── Two reasons this fetches rather than reading a snapshot ─────────────────

   1. A recipe is long. It has no business in a snapshot that is rebuilt on
      every voice turn and must never await anything.
   2. The endpoint is already the incumbent's, and it is CACHE-FIRST. The dinner
      panel warms it an hour before the meal, so by the time anyone asks the
      answer is on disk.

   ⚠ /api/recipe is the one billable leg in this file: a dish with no cache
   entry costs one Claude web search. That is the same trade the incumbent's
   dinner panel has always made and the cache is shared, so asking out loud
   cannot cost more than the panel was going to spend anyway. It is worth
   knowing about rather than discovering on a bill.
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, column, getJson } from "./dom.js";

/* Ingredients are a glance; the method is a read.

   ⚠⚠ THE METHOD IS NO LONGER CAPPED, and the reason the cap was wrong is worth
   keeping. `MAX_STEPS = 6` was written for a FIXED panel: with nowhere for the
   seventh step to go, showing six at a legible size beat showing ten at a size
   nobody can read from the stove. That reasoning was sound and its premise was
   false — the incumbent's dinner panel had solved this in July by scrolling the
   method column, and half this household's recipes are longer than six steps
   (tonight's chorizo traybake is ten). So the wall was quietly truncating the
   end of the cooking, which is the half you need when your hands are busy.

   The method now scrolls, gently, and every step is on it. The ingredients stay
   capped: they are a glance before you start, not a thing you follow, and ten is
   already more than any of these recipes carry. */
const MAX_INGREDIENTS = 10;

/* Auto-scroll, ported unchanged from modules/recipePanel.js. Slow enough to
   read at, with a dwell at each end so the top of the method is legible when
   the panel first lands and the bottom does not snap away. */
const SCROLL_SPEED_PX_S = 14;
const SCROLL_DWELL_MS = 4000;

/* Longer than dom.js's default. This one may be waking a cold cache entry, and
   the alternative to waiting is telling someone there is no recipe when there
   is. Still bounded: an unbounded await here would hold the voice turn open. */
const RECIPE_TIMEOUT_MS = 9000;

/**
 * Ping-pong a scroller that overflows, and hand back the stopper.
 *
 * ⚠ THE STOPPER IS NOT OPTIONAL. `frame()`'s teardown clears image srcs and
 * detaches the node — it knows nothing about rAF. A loop left running holds a
 * reference to a detached element for the life of the page, and depth 3 is the
 * one genuinely per-event path in V3: this is the exact shape that produced 709
 * zombie lottie wrappers and 230k detached nodes. The caller chains this into
 * the subject's teardown, and the spec asserts it.
 *
 * Returns a no-op stopper when the content fits, so the call site never has to
 * ask which case it got.
 */
function autoScroll(scroller) {
  if (!scroller) return () => {};

  let raf = null;
  let dir = 1;
  let last = null;
  let dwellUntil = 0;

  const overflows = () => scroller.scrollHeight - scroller.clientHeight > 4;

  const step = (t) => {
    if (last == null) last = t;
    const dt = t - last;
    last = t;
    if (t >= dwellUntil) {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop += dir * SCROLL_SPEED_PX_S * (dt / 1000);
      if (scroller.scrollTop <= 0) { scroller.scrollTop = 0; dir = 1; dwellUntil = t + SCROLL_DWELL_MS; }
      else if (scroller.scrollTop >= max) { scroller.scrollTop = max; dir = -1; dwellUntil = t + SCROLL_DWELL_MS; }
    }
    raf = requestAnimationFrame(step);
  };

  /* ⚠ A SUBJECT IS BUILT DETACHED AND MOUNTED BY SOMEBODY ELSE. subjects/index.js
     calls the builder, then `replaceChildren`s the result in — so at the moment
     this function runs, scrollHeight and clientHeight are both 0 and "does it
     overflow" cannot be answered yet. Measuring here is how you get a method
     column that never scrolls: the check silently says "it fits" for every
     recipe, which is the same wrong answer the old MAX_STEPS gave, arrived at
     by a different route.

     So the start is deferred until the node is actually in the document and has
     been laid out. Bounded, because a subject that never mounts must not leave a
     rAF chain walking forever. */
  let tries = 0;
  const waitForLayout = () => {
    if (!scroller.isConnected || scroller.clientHeight === 0) {
      if (++tries > 120) { raf = null; return; }   // ~2s at 60fps, then give up
      raf = requestAnimationFrame(waitForLayout);
      return;
    }
    if (!overflows()) { raf = null; return; }      // genuinely fits — nothing to do
    dwellUntil = performance.now() + SCROLL_DWELL_MS;
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(waitForLayout);

  return () => {
    if (raf != null) { cancelAnimationFrame(raf); raf = null; }
  };
}

function valid(recipe) {
  return Boolean(
    recipe &&
    typeof recipe.title === "string" &&
    Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0 &&
    Array.isArray(recipe.steps) && recipe.steps.length > 0
  );
}

/**
 * @param {object} snapshot  voice snapshot; `menu` is tonight's dish
 * @returns {Promise<{node, teardown}|null>}
 */
export async function showRecipe(snapshot) {
  /* No dish and no calendar are different answers. Without a calendar we know
     nothing and must not mount; with a calendar and no meal event we know there
     is no dinner planned, and saying so on the screen is a real answer. */
  if (!Array.isArray(snapshot?.calendar)) return null;

  const dish = snapshot?.menu ?? null;
  if (!dish) {
    const { node, teardown } = frame("recipe");
    node.dataset.cell = "menu";
    node.appendChild(title("Dinner"));
    node.appendChild(column([{ text: "Nothing's planned for tonight." }]));
    return { node, teardown };
  }

  const recipe = await getJson(`/api/recipe?dish=${encodeURIComponent(dish)}`, {
    timeoutMs: RECIPE_TIMEOUT_MS
  });

  const { node, teardown } = frame("recipe");
  node.dataset.cell = "menu";
  node.appendChild(title(dish));

  if (!valid(recipe)) {
    /* The dish is still the answer to "what's for dinner" even when the method
       is missing, so this is a subject rather than a fall-through. Saying which
       half is absent beats an empty rectangle. */
    node.appendChild(column([{ text: "No method saved for this one yet." }]));
    return { node, teardown };
  }

  const body = document.createElement("div");
  body.className = "subject__recipe";

  /* Each column is a heading over its own scroller, so the label stays put
     while the rows move under it. Nothing is cut: what does not fit vertically
     scrolls.

     ⚠ BOTH COLUMNS, and the second one was found the same way as the first —
     photographed on the wall. With only the method scrolling, tonight's traybake
     clipped its ingredients mid-word at "200g cherry tomatoes", because twelve
     ingredients capped to ten still do not fit a 723px column at this size. A
     half-shown ingredient list is worse than a half-shown method: the method you
     read a step at a time, the ingredients you check before you start.

     They share one speed and one dwell, so the two columns start together and
     turn together — which reads as one movement rather than two things fidgeting
     at each other. */
  /* The modifier is not for styling — both scrollers are identical — it is so a
     probe can name which column it means. Both share `.subject__scroll`, so a
     bare querySelector finds the INGREDIENTS one, and a spec meaning to count
     method steps would quietly count ingredients and pass at the wrong number. */
  const mkColumn = (kind, heading, rows) => {
    const col = document.createElement("div");
    col.appendChild(title(heading));
    const scroller = document.createElement("div");
    scroller.className = `subject__scroll subject__scroll--${kind}`;
    scroller.appendChild(column(rows));
    col.appendChild(scroller);
    return { col, scroller };
  };

  const left = mkColumn(
    "ingredients",
    recipe.servings ? `Ingredients · ${recipe.servings}` : "Ingredients",
    recipe.ingredients.slice(0, MAX_INGREDIENTS).map((t) => ({ text: String(t) }))
  );
  const right = mkColumn(
    "method",
    "Method",
    recipe.steps.map((t, i) => ({ lead: String(i + 1), text: String(t) }))
  );

  body.append(left.col, right.col);
  node.appendChild(body);

  const stopScrolls = [autoScroll(left.scroller), autoScroll(right.scroller)];

  return {
    node,
    /* Chained, not replaced: frame()'s teardown is what clears image srcs and
       detaches the node, and the scroll loops are ours to stop on top of it. */
    teardown: () => {
      for (const stop of stopScrolls) stop();
      teardown();
    }
  };
}
