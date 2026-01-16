import { on } from "./eventBus.js";

export function registerLifecycle() {
  on("view:changed", ({ view }) => {
    document.dispatchEvent(
      new CustomEvent("dashboard:view-changed", { detail: view })
    );
  });
}
