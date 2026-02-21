import { EventEmitter } from "events";
import { readHaConfig } from "./haConfig.js";
import { haGet } from "./haRest.js";

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

class HaWsManager extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.requestId = 1;
    this.connected = false;
    this.lastError = null;
    this.lastConnectedAt = null;
    this.backoffMs = BASE_BACKOFF_MS;
    this.reconnectTimer = null;
    this.states = new Map();
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  stop() {
    this.started = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) this.socket.close();
  }

  getStatus() {
    return {
      connected: this.connected,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt
    };
  }

  getStates() {
    return Array.from(this.states.values());
  }

  getState(entityId) {
    return this.states.get(entityId) || null;
  }

  async ensureInitialStates() {
    if (this.states.size) return;
    try {
      const states = await haGet("/api/states");
      if (Array.isArray(states)) {
        states.forEach((state) => {
          if (state?.entity_id) this.states.set(state.entity_id, state);
        });
      }
    } catch (error) {
      this.lastError = error.message;
    }
  }

  scheduleReconnect(reason = "connection_lost") {
    if (!this.started || this.reconnectTimer) return;
    this.connected = false;
    this.emit("status", this.getStatus());
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.lastError = reason;
  }

  connect() {
    if (!this.started) return;

    const { haHost, haToken } = readHaConfig();
    if (typeof WebSocket === "undefined") {
      throw new Error("Global WebSocket is unavailable in this Node runtime");
    }

    const wsUrl = haHost.replace(/^http/i, "ws") + "/api/websocket";
    const ws = new WebSocket(wsUrl);
    this.socket = ws;

    ws.addEventListener("open", () => {
      this.lastError = null;
    });

    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data.toString());
      } catch {
        return;
      }

      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: haToken }));
        return;
      }

      if (msg.type === "auth_ok") {
        this.connected = true;
        this.backoffMs = BASE_BACKOFF_MS;
        this.lastConnectedAt = new Date().toISOString();
        this.emit("status", this.getStatus());
        this.send({ id: this.requestId++, type: "subscribe_events", event_type: "state_changed" });
        this.send({ id: this.requestId++, type: "subscribe_events", event_type: "dashboard_command" });
        this.send({ id: this.requestId++, type: "get_states" });
        return;
      }

      if (msg.type === "result" && Array.isArray(msg.result)) {
        msg.result.forEach((state) => {
          if (state?.entity_id) this.states.set(state.entity_id, state);
        });
        this.emit("snapshot", this.getStates());
        return;
      }

      if (msg.type === "event") {
        const eventType = msg?.event?.event_type;
        const data = msg?.event?.data || {};
        if (eventType === "state_changed" && data?.new_state?.entity_id) {
          this.states.set(data.new_state.entity_id, data.new_state);
        }
        this.emit("event", { eventType, data });
      }
    });

    ws.addEventListener("close", (event) => {
      if (this.socket !== ws) return;
      this.lastError = event.reason || `socket_closed_${event.code}`;
      this.socket = null;
      this.scheduleReconnect(this.lastError);
    });

    ws.addEventListener("error", () => {
      this.lastError = "websocket_error";
      this.emit("status", this.getStatus());
    });
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }
}

let singleton;

export function getHaWsManager() {
  if (!singleton) singleton = new HaWsManager();
  return singleton;
}
