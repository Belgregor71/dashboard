import { on } from "../../core/eventBus.js";
import { updateEntity } from "./state.js";
import { switchView } from "../../core/viewManager.js";

export function registerHAEvents() {
  on("ha:event:state_changed", (data) => {
    updateEntity(data.new_state);

    document.dispatchEvent(
      new CustomEvent("ha:state-updated", {
        detail: data.new_state
      })
    );
  });

  on("ha:event:dashboard_command", (data) => {
    if (data.command === "switch_view") {
      switchView(data.view);
    }
  });
}
