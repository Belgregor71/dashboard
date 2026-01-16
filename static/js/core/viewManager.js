import { emit } from "./eventBus.js";

let currentView = "home";

export function initViews() {
  document.body.dataset.view = currentView;
}

export function switchView(view) {
  if (view === currentView) return;

  currentView = view;
  document.body.dataset.view = view;

  emit("view:changed", { view });
}
