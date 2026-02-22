import { CONFIG } from "../../core/config.js";
import { getAllEntities } from "./state.js";

const DEFAULT_TODO_ENTITY_IDS = ["todo.brett", "todo.greg", "todo.both"];
const SHOPPING_LIST_ENTITY_ID = CONFIG.homeAssistant?.shoppingListEntityId ?? "todo.shopping_list";

function normalizeEntityIds(entityIds) {
  if (!Array.isArray(entityIds)) return [];
  return entityIds.filter((entityId) => typeof entityId === "string" && entityId.trim());
}

export function getTodoEntityIds() {
  const configured = normalizeEntityIds(CONFIG.homeAssistant?.todoEntities);
  if (configured.length) return configured;

  const discovered = Object.values(getAllEntities())
    .map((entity) => entity?.entity_id)
    .filter(
      (entityId) =>
        typeof entityId === "string" &&
        entityId.startsWith("todo.") &&
        entityId !== SHOPPING_LIST_ENTITY_ID
    );

  if (discovered.length) {
    return [...new Set(discovered)].sort();
  }

  return DEFAULT_TODO_ENTITY_IDS;
}
