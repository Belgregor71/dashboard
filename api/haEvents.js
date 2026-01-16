import { updateEntity } from "./haState.js";
import { switchView } from "../ui/viewManager.js";

export function registerHAEvents(client) {
  client.on("state_changed", (data) => {
    updateEntity(data.new_state);
    document.dispatchEvent(
      new CustomEvent("ha-state-updated", { detail: data.new_state })
    );
  });

  client.on("dashboard_command", (data) => {
    if (data.command === "switch_view") {
      switchView(data.view);
    }
  });
}
