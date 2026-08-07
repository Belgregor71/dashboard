import { CONFIG } from "../../core/config.js";
import { getAllEntities, getEntitiesVersion, getEntity } from "./state.js";

const DEFAULT_TODO_ENTITY_IDS = ["todo.brett", "todo.greg", "todo.both"];
const SHOPPING_LIST_ENTITY_ID = CONFIG.homeAssistant?.shoppingListEntityId ?? "todo.shopping_list";

function normalizeEntityIds(entityIds) {
  if (!Array.isArray(entityIds)) return [];
  return entityIds.filter((entityId) => typeof entityId === "string" && entityId.trim());
}

let cachedIds = null;
let cachedVersion = -1;

export function getTodoEntityIds() {
  const configured = normalizeEntityIds(CONFIG.homeAssistant?.todoEntities);
  if (configured.length) return configured;

  // todo.js calls this once per ha:state-updated, so on a full snapshot the
  // scan below ran ~700 times over ~700 entities. The result can only change
  // when a new entity_id appears, so memoize on the store version.
  const version = getEntitiesVersion();
  if (cachedIds && cachedVersion === version) return cachedIds;

  const discovered = Object.values(getAllEntities())
    .map((entity) => entity?.entity_id)
    .filter(
      (entityId) =>
        typeof entityId === "string" &&
        entityId.startsWith("todo.") &&
        entityId !== SHOPPING_LIST_ENTITY_ID
    );

  cachedIds = discovered.length ? [...new Set(discovered)].sort() : DEFAULT_TODO_ENTITY_IDS;
  cachedVersion = version;
  return cachedIds;
}

/* ── Item shape ─────────────────────────────────────────────────────────────
   HA's todo integrations disagree about what a list item looks like: `items`
   or `all_items`, `complete: true` or `status: "completed"`, and the label is
   `summary`, `name` or `title` depending on which one is serving. These live
   here rather than in a panel module so that every reader — the shopping panel
   and the voice lane — agrees about what "an open item" means.
─────────────────────────────────────────────────────────────────────────── */

export function normalizeItems(entity) {
  const items = entity?.attributes?.items ?? entity?.attributes?.all_items ?? [];
  return Array.isArray(items) ? items : [];
}

export function isCompleted(item) {
  if (item?.complete === true) return true;
  return String(item?.status || "").toLowerCase() === "completed";
}

export function resolveSummary(item) {
  return item?.summary || item?.name || item?.title || "Untitled";
}

/** Open (not-completed) item labels for one todo entity. */
export function openTodoSummaries(entityId) {
  return normalizeItems(getEntity(entityId))
    .filter((item) => !isCompleted(item))
    .map(resolveSummary);
}

export function getShoppingEntityId() {
  return SHOPPING_LIST_ENTITY_ID;
}
