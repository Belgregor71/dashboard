import { emit } from "./eventBus.js";

let currentView = "home";
const viewOrder = ["home", "weather", "cameras", "calendar", "agenda", "status", "briefing"];
const viewHandlers = new Map();
let clickHandlerRegistered = false;

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

function registerClickCycle() {
  if (clickHandlerRegistered) return;
  clickHandlerRegistered = true;

  document.addEventListener("click", event => {
    if (event.defaultPrevented) return;
    const nextView = getNextView(currentView);
    switchView(nextView);
  });
}

export function initViews() {
  document.body.dataset.view = currentView;
  const initialView = getViewModule(currentView);
  initialView.render();
  initialView.onEnter();
  registerClickCycle();
}

export function registerView(viewId, module) {
  if (!viewId) return;
  viewHandlers.set(viewId, normalizeViewModule(module));
}

export function getCurrentView() {
  return currentView;
}

export function switchView(view) {
  if (!view || view === currentView) return;

  const previousView = currentView;
  const previousModule = getViewModule(previousView);
  const nextModule = getViewModule(view);

  previousModule.onLeave();

  currentView = view;
  document.body.dataset.view = view;
  nextModule.render();
  nextModule.onEnter();

  emit("view:changed", { view, previousView });
}
