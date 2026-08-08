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

/* Ingredients are a glance; the method is a read. Both are capped because the
   panel is fixed and the type floor is not negotiable — the honest failure is
   "the first six steps are on the wall", not eight lines of 20px nobody can
   see from the stove. */
const MAX_INGREDIENTS = 10;
const MAX_STEPS = 6;

/* Longer than dom.js's default. This one may be waking a cold cache entry, and
   the alternative to waiting is telling someone there is no recipe when there
   is. Still bounded: an unbounded await here would hold the voice turn open. */
const RECIPE_TIMEOUT_MS = 9000;

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

  const left = document.createElement("div");
  left.appendChild(title(recipe.servings ? `Ingredients · ${recipe.servings}` : "Ingredients"));
  left.appendChild(column(recipe.ingredients.slice(0, MAX_INGREDIENTS).map((t) => ({ text: String(t) }))));

  const right = document.createElement("div");
  right.appendChild(title("Method"));
  right.appendChild(column(
    recipe.steps.slice(0, MAX_STEPS).map((t, i) => ({ lead: String(i + 1), text: String(t) }))
  ));

  body.append(left, right);
  node.appendChild(body);

  return { node, teardown };
}
