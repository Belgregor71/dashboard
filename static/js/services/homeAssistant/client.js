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
let reconnectTimer = null;
let reconnectAttempt = 0;
let preferredUrlIndex = 0;
let connectionStart = 0;

const HA_DEBUG = HA_CONFIG?.debug === true;
const PROXY_FAILURE_THRESHOLD = 2;

function logHaDebug(message, details = null) {
  if (!HA_DEBUG) return;
  if (details) {
    console.log(`[HA WS] ${message}`, details);
    return;
  }
  console.log(`[HA WS] ${message}`);
}

function buildSocketUrls() {
  const urls = [];

  if (typeof window !== "undefined" && window.location?.origin) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    urls.push(`${protocol}//${window.location.host}/api/websocket`);
  }

  if (HA_CONFIG?.url) {
    urls.push(`${HA_CONFIG.url.replace(/^http/, "ws")}/api/websocket`);
  }

  return [...new Set(urls)];
}

function clearReconnectTimer() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function getReconnectDelayMs() {
  const baseDelay = HA_CONFIG.reconnectInterval || 5000;
  const cappedStep = Math.min(reconnectAttempt, 5);
  return baseDelay * (cappedStep + 1);
}

function scheduleReconnect() {
  clearReconnectTimer();
  const delayMs = getReconnectDelayMs();
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(connectHA, delayMs);
  logHaDebug("Reconnecting after backoff", { reconnectAttempt, delayMs });
}

function attachSocketHandlers(ws, reconnectUrl) {
  ws.onopen = () => {
    connectionStart = Date.now();
    reconnectAttempt = 0;
    logHaDebug("Socket opened", { reconnectUrl });
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    emit("ha:message", { receivedAt: Date.now(), type: msg.type });

    if (msg.type === "auth_required") {
      logHaDebug("Sending auth", {
        reconnectUrl,
        tokenLength: HA_CONFIG?.token?.length || 0
      });
      ws.send(JSON.stringify({
        type: "auth",
        access_token: HA_CONFIG.token
      }));
      return;
    }

    if (msg.type === "auth_ok") {
      console.log("HA authenticated");
      reconnectAttempt = 0;
      subscribe("state_changed");
      subscribe("dashboard_command");
      getStatesRequestId = msgId++;
      ws.send(JSON.stringify({
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

  ws.onerror = (error) => {
    console.warn("HA socket error", reconnectUrl, error);
    logHaDebug("Socket error", {
      reconnectUrl,
      message: error?.message || "unknown"
    });
  };

  ws.onclose = (event) => {
    if (socket === ws) {
      const connectedMs = connectionStart ? Date.now() - connectionStart : 0;
      const disconnectedQuickly = connectedMs > 0 && connectedMs < 3000;
      if (disconnectedQuickly && preferredUrlIndex === 0) {
        reconnectAttempt += 1;
        if (reconnectAttempt >= PROXY_FAILURE_THRESHOLD) {
          preferredUrlIndex = 1;
        }
      }

      console.warn("HA disconnected — scheduling reconnect", reconnectUrl);
      logHaDebug("Socket closed", {
        reconnectUrl,
        code: event?.code,
        reason: event?.reason || "",
        wasClean: event?.wasClean,
        connectedMs,
        preferredUrlIndex
      });
      emit("ha:disconnected");
      scheduleReconnect();
    }
  };
}

export function connectHA() {
  if (!HA_CONFIG?.enabled) {
    console.warn("Home Assistant integration disabled");
    return;
  }

  if (!HA_CONFIG?.token) {
    console.warn("Home Assistant token missing; skipping HA connection");
    return;
  }

  const socketUrls = buildSocketUrls();
  const reconnectUrl = socketUrls[preferredUrlIndex] || socketUrls[0];

  if (!reconnectUrl) {
    console.warn("Home Assistant URL missing; skipping HA connection");
    return;
  }

  clearReconnectTimer();
  socket = new WebSocket(reconnectUrl);
  logHaDebug("Connecting", { reconnectUrl, socketUrls, preferredUrlIndex });
  attachSocketHandlers(socket, reconnectUrl);
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
