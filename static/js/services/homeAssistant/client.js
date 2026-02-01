import { CONFIG } from "../../core/config.js";
import { emit } from "../../core/eventBus.js";

const HA_CONFIG = CONFIG.homeAssistant;
const TODO_ENTITY_IDS = HA_CONFIG?.todoEntities ?? [
  "todo.brett",
  "todo.greg",
  "todo.both"
];
const SHOPPING_LIST_ENTITY_ID = HA_CONFIG?.shoppingListEntityId ?? "todo.shopping_list";

let socket;
let msgId = 1;
let getStatesRequestId;
const pendingRequests = new Map();

export function connectHA() {
  if (!HA_CONFIG?.enabled) {
    console.warn("Home Assistant integration disabled");
    return;
  }

  if (!HA_CONFIG?.token) {
    console.warn("Home Assistant token missing; skipping HA connection");
    return;
  }

  const url = HA_CONFIG.url.replace(/^http/, "ws") + "/api/websocket";
  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log("HA socket opened");
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    emit("ha:message", { receivedAt: Date.now(), type: msg.type });

    if (msg.type === "auth_required") {
      socket.send(JSON.stringify({
        type: "auth",
        access_token: HA_CONFIG.token
      }));
      return;
    }

    if (msg.type === "auth_ok") {
      console.log("HA authenticated");
      subscribe("state_changed");
      subscribe("dashboard_command");
      getStatesRequestId = msgId++;
      socket.send(JSON.stringify({
        id: getStatesRequestId,
        type: "get_states"
      }));
      TODO_ENTITY_IDS.forEach((entityId) => requestTodoItems(entityId));
      requestShoppingList();
      emit("ha:connected");
      return;
    }

    if (msg.type === "result") {
      const pending = pendingRequests.get(msg.id);
      if (pending) {
        pendingRequests.delete(msg.id);
        if (msg.success === false) {
          pending.reject(new Error(msg.error?.message || "HA service call failed"));
        } else {
          pending.resolve(msg.result);
        }
        return;
      }

      if (msg.id === getStatesRequestId) {
        emit("ha:states", msg.result);
        return;
      }

      return;
    }

    if (msg.type === "event") {
      emit(`ha:event:${msg.event.event_type}`, msg.event.data);
    }
  };

  socket.onclose = () => {
    console.warn("HA disconnected — retrying in 5s");
    emit("ha:disconnected");
    setTimeout(connectHA, HA_CONFIG.reconnectInterval || 5000);
  };
}

function subscribe(eventType) {
  socket.send(JSON.stringify({
    id: msgId++,
    type: "subscribe_events",
    event_type: eventType
  }));
}

function extractTodoItems(result, entityId) {
  if (Array.isArray(result)) return result;

  const directItems = result?.items ?? result?.response?.items ?? result?.[0]?.items;
  if (Array.isArray(directItems)) return directItems;

  const keyedItems = result?.response?.[entityId]?.items ?? result?.[entityId]?.items;
  if (Array.isArray(keyedItems)) return keyedItems;

  return [];
}

export function requestTodoItems(entityId) {
  if (!entityId || !HA_CONFIG?.token) return;

  callHAService({
    domain: "todo",
    service: "get_items",
    serviceData: {
      entity_id: entityId
    }
  })
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
  if (!HA_CONFIG?.token) return;

  const url = `${HA_CONFIG.url}/api/shopping_list`;

  fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${HA_CONFIG.token}`,
      "Content-Type": "application/json"
    }
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Failed to fetch shopping list items");
      }
      return response.json();
    })
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

export function callHAService({ domain, service, serviceData = {}, target }) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("HA socket not connected"));
  }

  const id = msgId++;
  const payload = {
    id,
    type: "call_service",
    domain,
    service,
    service_data: serviceData,
    return_response: true
  };

  if (target) {
    payload.target = target;
  }

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    socket.send(JSON.stringify(payload));
  });
}
