import { emit } from "./eventBus.js";

let currentView = "home";
const viewOrder = ["home", "weather", "cameras", "timeline"];
const AMBIENT_VIEW = "home";
const EXPLORE_RETURN_MS = 90_000;
let exploreReturnTimer = null;
const viewAliasMap = new Map([
  ["briefing-view", "briefing"],
  ["status-view", "status"],
  ["weather-view", "weather"],
  ["camera", "cameras"],
  ["calendar", "timeline"],
  ["agenda", "timeline"]
]);
const viewHandlers = new Map();
let clickHandlerRegistered = false;

// Phase 7 "Dissolve" (docs/vision/phase-7-dissolve.md): the rich legacy views
// are already user-unreachable (nav died in Phase 1) and their content now flows
// through the attention queue / event surfaces. When the substrate flag is on we
// gate *passive* navigation into them off, so the awake dashboard stays the
// ambient substrate instead of being taken over by a full-screen widget page.
// Event/voice callers pass { force: true } to bypass — doorbell + voice are
// untouched (see the callers). Views stay registered (reversible, not deleted).
const RETIRED_VIEWS = new Set(["weather", "cameras", "briefing"]);
let substrateEnabled = false;

function normalizeViewId(view) {
  if (typeof view !== "string") return "";
  const normalized = view.trim().toLowerCase();
  return viewAliasMap.get(normalized) || normalized;
}

function normalizeViewModule(module = {}) {
  return {
    render: typeof module.render === "function" ? module.render : () => {},
    onEnter: typeof module.onEnter === "function" ? module.onEnter : () => {},
    onLeave: typeof module.onLeave === "function" ? module.onLeave : () => {}
  };
}

function getViewModule(viewId) {
  return normalizeViewModule(viewHandlers.get(viewId));
}

function getNextView(view) {
  const index = viewOrder.indexOf(view);
  if (index === -1) return viewOrder[0];
  return viewOrder[(index + 1) % viewOrder.length];
}

function scheduleExploreReturn() {
  clearTimeout(exploreReturnTimer);
  if (currentView === AMBIENT_VIEW) return;
  exploreReturnTimer = setTimeout(() => switchView(AMBIENT_VIEW), EXPLORE_RETURN_MS);
}

function registerClickCycle() {
  if (clickHandlerRegistered) return;
  clickHandlerRegistered = true;

  document.addEventListener("click", event => {
    if (event.defaultPrevented) return;
    const nextView = getNextView(currentView);
    switchView(nextView);
  });
}

export function initViews({ presenceEnabled = false, substrateEnabled: substrate = false } = {}) {
  substrateEnabled = substrate;
  document.body.dataset.view = currentView;
  const initialView = getViewModule(currentView);
  initialView.render();
  initialView.onEnter();
  // Presence runtime (Phase 1): the display has no pointer, so the click-cycle
  // is dead navigation. When presence is on, don't register it — event-driven
  // switchView (doorbell, voice, briefing, screensaver-exit) is untouched.
  if (!presenceEnabled) registerClickCycle();
}

export function registerView(viewId, module) {
  if (!viewId) return;
  viewHandlers.set(viewId, normalizeViewModule(module));
}

export function getCurrentView() {
  return currentView;
}

export function switchView(view, { force = false } = {}) {
  const normalizedView = normalizeViewId(view);
  if (!normalizedView || normalizedView === currentView) return;
  // Phase 7: passive navigation into a retired view is gated off behind the
  // flag; event/voice paths pass force:true to reach them (doorbell, "show
  // cameras", the morning briefing). Flag off → this is inert.
  if (substrateEnabled && !force && RETIRED_VIEWS.has(normalizedView)) return;
  if (!viewHandlers.has(normalizedView)) {
    console.warn("Ignoring unknown view:", view);
    return;
  }

  const previousView = currentView;
  const previousModule = getViewModule(previousView);
  const nextModule = getViewModule(normalizedView);

  previousModule.onLeave();

  currentView = normalizedView;
  document.body.dataset.view = normalizedView;
  nextModule.render();
  nextModule.onEnter();

  emit("view:changed", { view: normalizedView, previousView });
  scheduleExploreReturn();
}
