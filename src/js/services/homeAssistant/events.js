import { emit, on } from "../../core/eventBus.js";
import { CONFIG } from "../../core/config.js";
import { getEntity, updateEntity } from "./state.js";
import { getTodoEntityIds } from "./todoEntities.js";
import { switchView } from "../../core/viewManager.js";
import { requestShoppingList, requestTodoItems } from "./client.js";
import { handleCalendarCommand } from "../calendar/commands.js";

const SHOPPING_LIST_ENTITY_ID = CONFIG.homeAssistant?.shoppingListEntityId ?? "todo.shopping_list";

let dashboardCommandBridgeRegistered = false;

function registerWindowDashboardCommandBridge() {
  if (dashboardCommandBridgeRegistered) return;
  dashboardCommandBridgeRegistered = true;

  window.addEventListener("dashboard_command", (event) => {
    const detail = event?.detail || {};
    emit("dashboard_command", detail);
  });
}


export function registerHAEvents() {
  registerWindowDashboardCommandBridge();
  on("ha:todo-items", ({ entityId, items }) => {
    if (!entityId || !Array.isArray(items)) return;

    const current = getEntity(entityId);
    const attributes = {
      ...(current?.attributes ?? {}),
      items,
      all_items: items
    };

    updateEntity({
      ...(current ?? {}),
      entity_id: entityId,
      attributes
    });

    document.dispatchEvent(
      new CustomEvent("ha:state-updated", {
        detail: { entity_id: entityId }
      })
    );
  });

  on("ha:states", (entities) => {
    if (!Array.isArray(entities)) return;

    entities.forEach((entity) => {
      updateEntity(entity);
      document.dispatchEvent(
        new CustomEvent("ha:state-updated", {
          detail: entity
        })
      );
    });

    getTodoEntityIds().forEach((entityId) => requestTodoItems(entityId));
    requestShoppingList();
  });

  on("ha:event:state_changed", (data) => {
    updateEntity(data.new_state);

    document.dispatchEvent(
      new CustomEvent("ha:state-updated", {
        detail: data.new_state
      })
    );

    const entityId = data?.new_state?.entity_id;
    if (getTodoEntityIds().includes(entityId)) {
      requestTodoItems(entityId);
    }
    if (entityId === SHOPPING_LIST_ENTITY_ID) {
      requestShoppingList();
    }
  });

  on("ha:event:dashboard_command", (data) => {
    const command = data.command || data.intent || data.action;
    emit("dashboard_command", data);

    if (!command) {
      emit("command:unknown", {
        command: "",
        ok: false,
        message: "Unknown command"
      });
      return;
    }

    if (command === "switch_view") {
      switchView(data.view, { force: true }); // remote/voice command — past the Phase 7 gate
      emit("command:executed", {
        command,
        ok: true,
        message: data.view ? `Switched to ${data.view}` : "View switched"
      });
      return;
    }

    if (["system_status", "status", "system_status_view"].includes(command)) {
      switchView("status");
      emit("status:highlight", { target: data.target });
      emit("command:executed", {
        command,
        ok: true,
        message: "Showing system status"
      });
      return;
    }

    if (["status_calendar", "calendar_status", "calendar_blank"].includes(command)) {
      switchView("status");
      emit("status:highlight", { target: "calendar" });
      emit("command:executed", {
        command,
        ok: true,
        message: "Showing calendar status"
      });
      return;
    }

    if (command === "agenda_plus" || command === "agenda_filter" || command === "agenda_date") {
      switchView("timeline");
      emit("command:executed", {
        command,
        ok: true,
        message: "Showing timeline"
      });
      return;
    }

    if (command === "agenda_tomorrow") {
      switchView("timeline");
      emit("timeline:scroll", { label: "Tomorrow" });
      emit("command:executed", {
        command,
        ok: true,
        message: "Showing tomorrow"
      });
      return;
    }

    if (command === "agenda_next") {
      emit("command:executed", {
        command,
        ok: true,
        message: "Showing timeline"
      });
      return;
    }

    if (handleCalendarCommand(command, data)) {
      emit("command:executed", {
        command,
        ok: true,
        message: "Calendar command executed"
      });
      return;
    }

    emit("command:unknown", {
      command,
      ok: false,
      message: "Unknown command"
    });
  });
}