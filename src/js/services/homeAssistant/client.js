/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

import { CONFIG } from "../../core/config.js";
import { emit } from "../../core/eventBus.js";

const HA_CONFIG = CONFIG.homeAssistant;
const SHOPPING_LIST_ENTITY_ID = HA_CONFIG?.shoppingListEntityId ?? "todo.shopping_list";

let eventSource;
let reconnectTimer;
let reconnectAttempt = 0;
let connected = false;

export function isHAConnected() {
  return connected;
}

const HA_DEBUG = HA_CONFIG?.debug === true;

function logHaDebug(message, details = null) {
  if (!HA_DEBUG) return;
  if (details) {
    console.log(`[HA SSE] ${message}`, details);
    return;
  }
  console.log(`[HA SSE] ${message}`);
}

function clearReconnectTimer() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect() {
  clearReconnectTimer();
  reconnectAttempt += 1;
  const delay = Math.min(1000 * reconnectAttempt, 15000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectHA();
  }, delay);
}

/* ⚠⚠ THE SHAPE THIS ACTUALLY RECEIVES IS `service_response`, and it was the one
   spelling missing from the list below. Measured against the live house
   2026-08-30, `GET /api/ha/todo/todo.both/items` returns

     { "changed_states": [], "service_response": { "todo.both": { "items": [...] } } }

   which matched none of the four guesses, so every to-do read fell through to
   the `return []` — and `[]` is what `onTodoItems` writes into the entity
   cache. The wall has been saying "the shopping list is empty" and "nothing on
   your list" with total confidence, for every list, regardless of what was on
   them. `lists.js`'s own header warns about exactly this failure; the guard it
   describes was in place and the value reaching it was already flattened.

   ⚠ SO THE FALLBACK IS NOW `null`, NOT `[]`. A shape we cannot read is not a
   list with nothing on it, and the two must not arrive at the reader looking
   alike — the same distinction `23b789b` had to restore for the photo archive.
   `onTodoItems` ignores a non-array, which leaves the last known good list
   standing instead of blanking it. */
function extractTodoItems(result, entityId) {
  if (Array.isArray(result)) return result;
  const keyed = result?.service_response ?? result?.response ?? result;
  const keyedItems = keyed?.[entityId]?.items;
  if (Array.isArray(keyedItems)) return keyedItems;
  const directItems = keyed?.items ?? result?.items ?? result?.[0]?.items;
  if (Array.isArray(directItems)) return directItems;
  return null;
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed for ${path}`);
  }
  return response.json();
}

export function connectHA() {
  if (!HA_CONFIG?.enabled) {
    console.warn("Home Assistant integration disabled");
    return;
  }

  if (eventSource) {
    eventSource.close();
  }

  clearReconnectTimer();

  eventSource = new EventSource("/api/ha/stream");

  eventSource.onopen = () => {
    reconnectAttempt = 0;
    connected = true;
    emit("ha:connected");
    logHaDebug("Connected to /api/ha/stream");
  };

  eventSource.onerror = () => {
    connected = false;
    emit("ha:disconnected", { reason: "stream_error" });
    logHaDebug("Stream disconnected; scheduling reconnect");
    scheduleReconnect();
  };

  eventSource.addEventListener("ha_status", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload?.connected) {
        connected = true;
        emit("ha:connected");
      } else {
        connected = false;
        emit("ha:disconnected", { reason: payload?.lastError || "disconnected" });
      }
    } catch {
      // ignore
    }
  });

  eventSource.addEventListener("ha_snapshot", (event) => {
    try {
      emit("ha:states", JSON.parse(event.data));
    } catch {
      // ignore
    }
  });

  eventSource.addEventListener("state_changed", (event) => {
    try {
      const data = JSON.parse(event.data);
      emit("ha:event:state_changed", data);
    } catch {
      // ignore
    }
  });

  eventSource.addEventListener("dashboard_command", (event) => {
    try {
      emit("ha:event:dashboard_command", JSON.parse(event.data));
    } catch {
      // ignore
    }
  });
}

export function requestTodoItems(entityId) {
  if (!entityId) return;

  requestJson(`/api/ha/todo/${encodeURIComponent(entityId)}/items`)
    .then((result) => {
      const items = extractTodoItems(result, entityId);
      emit("ha:todo-items", {
        entityId,
        items
      });
    })
    .catch((error) => {
      console.warn("HA todo items fetch failed", error);
    });
}

export function requestShoppingList() {
  requestJson("/api/ha/shopping_list")
    .then((items) => {
      emit("ha:todo-items", {
        entityId: SHOPPING_LIST_ENTITY_ID,
        items: Array.isArray(items) ? items : items?.items ?? []
      });
    })
    .catch((error) => {
      console.warn("HA shopping list fetch failed", error);
    });
}

export async function callHAService({ domain, service, serviceData = {}, target }) {
  const payload = target ? { ...serviceData, target } : serviceData;
  return requestJson(`/api/ha/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

