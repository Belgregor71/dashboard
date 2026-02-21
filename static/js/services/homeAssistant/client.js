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
let authAttemptsByUrl = new Map();

const HA_DEBUG = HA_CONFIG?.debug === true;
const PROXY_FAILURE_THRESHOLD = 2;
const TOKEN_MISSING_RETRY_MS = 30000;

function getToken() {
  return typeof HA_CONFIG?.token === "string" ? HA_CONFIG.token.trim() : "";
}


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

function scheduleReconnect({ reason = "socket_closed", delayMs } = {}) {
  clearReconnectTimer();
  const resolvedDelayMs = Number.isFinite(delayMs) ? delayMs : getReconnectDelayMs();
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(connectHA, resolvedDelayMs);
  logHaDebug("Reconnecting after backoff", { reconnectAttempt, delayMs: resolvedDelayMs, reason });
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
      const token = getToken();
      logHaDebug("Auth required", { reconnectUrl, tokenLength: token.length });

      if (!token) {
        console.warn("Home Assistant token missing; skipping websocket auth");
        emit("ha:disconnected", { reason: "token_missing" });
        ws.close(1000, "token_missing");
        scheduleReconnect({ reason: "token_missing", delayMs: TOKEN_MISSING_RETRY_MS });
        return;
      }

      logHaDebug("Sending auth", { reconnectUrl, tokenLength: token.length });
      ws.send(JSON.stringify({
        type: "auth",
        access_token: token
      }));
      return;
    }

    if (msg.type === "auth_invalid") {
      const failures = (authAttemptsByUrl.get(reconnectUrl) || 0) + 1;
      authAttemptsByUrl.set(reconnectUrl, failures);

      if (preferredUrlIndex === 0 && failures >= PROXY_FAILURE_THRESHOLD) {
        preferredUrlIndex = 1;
      }

      console.warn("HA auth invalid; scheduling reconnect", reconnectUrl);
      emit("ha:disconnected", { reason: "auth_invalid" });
      ws.close(1000, "auth_invalid");
      scheduleReconnect({ reason: "auth_invalid" });
      return;
    }

    if (msg.type === "auth_ok") {
      authAttemptsByUrl.delete(reconnectUrl);
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
      const closeReason = event?.reason || "socket_closed";
      emit("ha:disconnected", { reason: closeReason });
      if (closeReason === "token_missing" || closeReason === "auth_invalid") {
        return;
      }
      scheduleReconnect({ reason: "socket_closed" });
    }
  };
}

export function connectHA() {
  if (!HA_CONFIG?.enabled) {
    console.warn("Home Assistant integration disabled");
    return;
  }

  const token = getToken();
  if (!token) {
    console.warn("Home Assistant token missing; skipping HA connection");
    emit("ha:disconnected", { reason: "token_missing" });
    scheduleReconnect({ reason: "token_missing", delayMs: TOKEN_MISSING_RETRY_MS });
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
  logHaDebug("Connecting", {
    reconnectUrl,
    socketUrls,
    preferredUrlIndex,
    tokenLength: token.length
  });
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
