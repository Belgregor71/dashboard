import { CONFIG } from "../../core/config.js";
import { emit } from "../../core/eventBus.js";

const HA_CONFIG = CONFIG.homeAssistant;

let socket;
let msgId = 1;

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
      emit("ha:connected");
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
