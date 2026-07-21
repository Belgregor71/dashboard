import { on } from "../core/eventBus.js";

// One hour before a Meal:-prefixed dinner, slide a recipe panel in from the
// right; keep it up through cooking and auto-dismiss 45 min after the dinner
// time. Trigger loop borrowed from nextEventPanel.js; create-once slide overlay
// + tracked-timer teardown borrowed from arrivalGreeting.js. Dinner detection
// reuses the Meal: convention that tonightsMenu.js already reads.

const MEAL_PREFIX = /^Meal:\s*/;
const WINDOW_BEFORE_MS = 60 * 60 * 1000; // slide in 1h before dinner
const WINDOW_AFTER_MS = 45 * 60 * 1000;  // auto-dismiss 45 min after dinner
const TICK_MS = 30_000;
const RETRY_BACKOFF_MS = 5 * 60 * 1000;  // after a failed fetch, back off before retrying

// Auto-scroll: gently ping-pong the method column when it overflows.
const SCROLL_SPEED_PX_S = 14;
const SCROLL_DWELL_MS = 4000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ── Dinner detection ──────────────────────────────────────────

function activeMeal(events, now) {
  const t = now.getTime();
  const candidates = (Array.isArray(events) ? events : [])
    .filter((ev) => MEAL_PREFIX.test(ev.rawTitle || ev.title || ""))
    .filter((ev) => !(ev.allDay === true || ev.isAllDay === true))
    .map((ev) => {
      const start = new Date(ev.start);
      if (Number.isNaN(start.getTime())) return null;
      const showFrom = start.getTime() - WINDOW_BEFORE_MS;
      const hideAt = start.getTime() + WINDOW_AFTER_MS;
      if (t < showFrom || t >= hideAt) return null;
      const dish = (ev.rawTitle || ev.title || "").replace(MEAL_PREFIX, "").trim();
      if (!dish) return null;
      return { dish, start, hideAt: new Date(hideAt), mealKey: `${dish}|${start.toISOString()}` };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  return candidates[0] || null;
}

async function fetchRecipe(dish) {
  const res = await fetch(`/api/recipe?dish=${encodeURIComponent(dish)}`);
  const data = await res.json().catch(() => null);
  const ok =
    res.ok &&
    data &&
    typeof data.title === "string" &&
    Array.isArray(data.ingredients) && data.ingredients.length > 0 &&
    Array.isArray(data.steps) && data.steps.length > 0;
  if (!ok) throw new Error(`recipe unavailable (${res.status})`);
  return data;
}

// ── Overlay DOM ───────────────────────────────────────────────

let overlayEl = null;
let dismissTimer = null;
let scrollRaf = null;

function ensureOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement("div");
  overlayEl.id = "recipe-panel";
  overlayEl.className = "recipe-panel";
  overlayEl.setAttribute("aria-live", "polite");
  document.body.appendChild(overlayEl);
}

function recipeHtml(recipe) {
  const ingredients = recipe.ingredients.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  const steps = recipe.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const servings = recipe.servings
    ? `<div class="recipe-panel__servings">${escapeHtml(recipe.servings)}</div>`
    : "";
  return `
    <div class="recipe-panel__card">
      <header class="recipe-panel__head">
        <div class="recipe-panel__eyebrow">Tonight's dinner</div>
        <h2 class="recipe-panel__title">${escapeHtml(recipe.title)}</h2>
        ${servings}
      </header>
      <div class="recipe-panel__cols">
        <section class="recipe-panel__col">
          <h3 class="recipe-panel__label">Ingredients</h3>
          <div class="recipe-panel__ingredients"><ul>${ingredients}</ul></div>
        </section>
        <section class="recipe-panel__col">
          <h3 class="recipe-panel__label">Method</h3>
          <div class="recipe-panel__method"><ol>${steps}</ol></div>
        </section>
      </div>
    </div>`;
}

function stopAutoScroll() {
  if (scrollRaf != null) {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
  }
}

function startAutoScroll(scroller) {
  stopAutoScroll();
  if (!scroller || scroller.scrollHeight - scroller.clientHeight <= 4) return; // fits — no scroll
  let dir = 1;
  let last = null;
  let dwellUntil = performance.now() + SCROLL_DWELL_MS; // hold at the top through the slide-in
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
    scrollRaf = requestAnimationFrame(step);
  };
  scrollRaf = requestAnimationFrame(step);
}

function showPanel(recipe, hideAt) {
  ensureOverlay();
  clearTimeout(dismissTimer);
  stopAutoScroll();

  overlayEl.innerHTML = recipeHtml(recipe);
  requestAnimationFrame(() => overlayEl.classList.add("is-active"));

  dismissTimer = setTimeout(hidePanel, Math.max(0, hideAt.getTime() - Date.now()));
  startAutoScroll(overlayEl.querySelector(".recipe-panel__method"));
}

function hidePanel() {
  clearTimeout(dismissTimer);
  dismissTimer = null;
  stopAutoScroll();
  overlayEl?.classList.remove("is-active");
  shownKey = null;
}

// ── Trigger loop ──────────────────────────────────────────────

let shownKey = null;    // meal currently displayed
let inFlightKey = null; // meal whose recipe is being fetched
const nextRetryAt = new Map(); // mealKey → ts to retry after a failure

async function fetchAndShow(meal) {
  inFlightKey = meal.mealKey;
  try {
    const recipe = await fetchRecipe(meal.dish);
    if (Date.now() >= meal.hideAt.getTime()) return; // window closed during the await
    showPanel(recipe, meal.hideAt);
    shownKey = meal.mealKey;
  } catch (err) {
    console.warn("[recipe] fetch failed:", err.message);
    nextRetryAt.set(meal.mealKey, Date.now() + RETRY_BACKOFF_MS);
  } finally {
    inFlightKey = null;
  }
}

function tick() {
  const meal = activeMeal(window.__CAL_EVENTS__, new Date());
  if (!meal) {
    if (shownKey) hidePanel();
    return;
  }
  if (meal.mealKey === shownKey || meal.mealKey === inFlightKey) return;
  if (Date.now() < (nextRetryAt.get(meal.mealKey) || 0)) return;
  fetchAndShow(meal);
}

// ── Init ──────────────────────────────────────────────────────

export function initRecipePanel({ enabled = false } = {}) {
  if (!enabled) return;

  on("calendar:refreshed", tick);
  const timer = setInterval(tick, TICK_MS);
  tick();

  // On-Pi verify hooks: force a panel for any dish without waiting for dinner.
  window.__recipePanel = async (dish = "spaghetti bolognese") => {
    try {
      const recipe = await fetchRecipe(dish);
      showPanel(recipe, new Date(Date.now() + WINDOW_AFTER_MS));
      return { shown: true, title: recipe.title, ingredients: recipe.ingredients.length, steps: recipe.steps.length };
    } catch (err) {
      return { shown: false, error: String(err.message || err) };
    }
  };
  window.__recipePanelHide = () => hidePanel();

  return timer;
}
