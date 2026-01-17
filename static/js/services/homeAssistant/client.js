import { CONFIG } from "../../core/config.js";
import { emit } from "../../core/eventBus.js";

const HA_CONFIG = CONFIG.homeAssistant;
const TODO_ENTITY_IDS = HA_CONFIG?.todoEntities ?? [
  "todo.jobs_to_be_done",
  "todo.shopping_list"
];

let socket;
let msgId = 1;
let getStatesRequestId;

export function connectHA() {
  if (!HA_CONFIG?.enabled) {
    console.warn("Home Assistant integration disabled");
    return;
  }

  const url = HA_CONFIG.url.replace(/^http/, "ws") + "/api/websocket";
  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log("HA socket opened");
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);

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
      emit("ha:connected");
      return;
    }

    if (msg.type === "result" && msg.id === getStatesRequestId) {
      emit("ha:states", msg.result);
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

export function requestTodoItems(entityId) {
  if (!entityId || !HA_CONFIG?.token) return;
  fetch(`${HA_CONFIG.url}/api/todo/items/${entityId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${HA_CONFIG.token}`,
      "Content-Type": "application/json"
    }
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch ${entityId} todo items`);
      }
      return response.json();
    })
    .then((items) => {
      emit("ha:todo-items", {
        entityId,
        items: Array.isArray(items) ? items : items?.items ?? []
      });
    })
    .catch((error) => {
      console.warn("HA todo items fetch failed", error);
    });
}
