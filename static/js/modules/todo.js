import { getEntity } from "../services/homeAssistant/state.js";

const TODO_ENTITY_ID = "todo.jobs_to_be_done";
const SHOPPING_ENTITY_ID = "todo.shopping_list";
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function normalizeItems(entity) {
  const items = entity?.attributes?.items ?? entity?.attributes?.all_items ?? [];
  return Array.isArray(items) ? items : [];
}

function isCompleted(item) {
  return String(item?.status || "").toLowerCase() === "completed";
}

function resolveSummary(item) {
  return item?.summary || item?.name || item?.title || "Untitled";
}

function parseDueDate(item) {
  const dueValue = item?.due || item?.due_date || item?.dueDate;
  if (!dueValue) return null;
  const parsed = new Date(dueValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDaysLeft(item) {
  const dueDate = parseDueDate(item);
  if (!dueDate) return "—";

  const today = startOfDay(new Date());
  const dueDay = startOfDay(dueDate);
  const diffDays = Math.round((dueDay - today) / MS_PER_DAY);

  if (diffDays < 0) return "Overdue";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "1 day";
  return `${diffDays} days`;
}

function buildTodoRow(task, daysLeft, isEmpty = false) {
  const row = document.createElement("div");
  row.className = `todo-row${isEmpty ? " todo-row--empty" : ""}`;

  const taskSpan = document.createElement("span");
  taskSpan.textContent = task;

  const daysSpan = document.createElement("span");
  daysSpan.textContent = daysLeft;

  row.appendChild(taskSpan);
  row.appendChild(daysSpan);
  return row;
}

function renderTodoList() {
  const listEl = document.getElementById("reminders-list");
  if (!listEl) return;

  const entity = getEntity(TODO_ENTITY_ID);
  const items = normalizeItems(entity).filter(item => !isCompleted(item));

  listEl.innerHTML = "";

  if (!items.length) {
    listEl.appendChild(buildTodoRow("No tasks", "—", true));
    return;
  }

  const sorted = [...items].sort((a, b) => {
    const dueA = parseDueDate(a);
    const dueB = parseDueDate(b);

    if (dueA && dueB) return dueA - dueB;
    if (dueA) return -1;
    if (dueB) return 1;
    return resolveSummary(a).localeCompare(resolveSummary(b));
  });

  sorted.forEach(item => {
    listEl.appendChild(buildTodoRow(resolveSummary(item), formatDaysLeft(item)));
  });
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
  if (!entityId || entityId === TODO_ENTITY_ID) {
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
