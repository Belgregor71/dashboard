import { on } from "../../core/eventBus.js";
import { CONFIG } from "../../core/config.js";
import { getEntity, updateEntity } from "./state.js";
import { switchView } from "../../core/viewManager.js";
import { requestTodoItems } from "./client.js";

const TODO_ENTITY_IDS = CONFIG.homeAssistant?.todoEntities ?? [
  "todo.jobs_to_be_done",
  "todo.shopping_list"
];

export function registerHAEvents() {
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

    TODO_ENTITY_IDS.forEach((entityId) => requestTodoItems(entityId));
  });

  on("ha:event:state_changed", (data) => {
    updateEntity(data.new_state);

    document.dispatchEvent(
      new CustomEvent("ha:state-updated", {
        detail: data.new_state
      })
    );

    const entityId = data?.new_state?.entity_id;
    if (TODO_ENTITY_IDS.includes(entityId)) {
      requestTodoItems(entityId);
    }
  });

  on("ha:event:dashboard_command", (data) => {
    if (data.command === "switch_view") {
      switchView(data.view);
    }
  });
}
