import { emit } from "./eventBus.js";

let currentView = "home";
const viewOrder = ["home", "weather", "cameras", "calendar", "agenda"];
let clickHandlerRegistered = false;

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
  registerClickCycle();
}

export function switchView(view) {
  if (view === currentView) return;

  currentView = view;
  document.body.dataset.view = view;

  emit("view:changed", { view });
}
