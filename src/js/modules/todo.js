import { CONFIG } from "../core/config.js";
import { emit } from "../core/eventBus.js";
import { getEntity } from "../services/homeAssistant/state.js";
import {
  getTodoEntityIds,
  normalizeItems,
  isCompleted,
  resolveSummary
} from "../services/homeAssistant/todoEntities.js";

// The item-shape helpers moved to todoEntities.js so the voice lane reads the
// same definition of "an open item" that this panel renders.
const SHOPPING_ENTITY_ID = CONFIG.homeAssistant?.shoppingListEntityId ?? "todo.shopping_list";

function parseDueDate(item) {
  const dueValue = item?.due || item?.due_date || item?.dueDate;
  if (!dueValue) return null;
  const parsed = new Date(dueValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTodoItems(todoEntityIds) {
  return todoEntityIds.flatMap((entityId) => {
    const entity = getEntity(entityId);
    return normalizeItems(entity).map((item) => ({
      ...item,
      __entityId: entityId
    }));
  });
}

function renderTodoList() {
  const todoEntityIds = getTodoEntityIds();
  const items = normalizeTodoItems(todoEntityIds).filter(item => !isCompleted(item));

  const dueEvents = items
    .map(item => ({ title: resolveSummary(item), start: parseDueDate(item) }))
    .filter(ev => ev.start)
    .map(ev => ({ ...ev, isAllDay: true }));

  emit("todos:updated", dueEvents);
}

function renderShoppingList() {
  const listEl = document.getElementById("shopping-list");
  if (!listEl) return;

  const entity = getEntity(SHOPPING_ENTITY_ID);
  const items = normalizeItems(entity).filter(item => !isCompleted(item));

  listEl.innerHTML = "";

  if (!items.length) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "No shopping items";
    emptyItem.classList.add("is-empty");
    listEl.appendChild(emptyItem);
    return;
  }

  items.forEach(item => {
    const li = document.createElement("li");
    li.textContent = resolveSummary(item);
    listEl.appendChild(li);
  });
}

function refresh(entityId) {
  const todoEntityIds = getTodoEntityIds();

  if (
    !entityId ||
    todoEntityIds.includes(entityId) ||
    (entityId.startsWith("todo.") && entityId !== SHOPPING_ENTITY_ID)
  ) {
    renderTodoList();
  }

  if (!entityId || entityId === SHOPPING_ENTITY_ID) {
    renderShoppingList();
  }
}

export function initTodoPanels() {
  refresh();

  document.addEventListener("ha:state-updated", (event) => {
    refresh(event.detail?.entity_id);
  });

  document.addEventListener("ha:connected", () => {
    refresh();
  });
}
