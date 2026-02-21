import { EventEmitter } from "events";
import WebSocket from "ws";
import { readHaConfig } from "./haConfig.js";
import { haGet } from "./haRest.js";

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

function toWsUrl(haHost) {
  // haHost examples: http://192.168.0.179:8123 or https://ha.local:8123
  const u = new URL(haHost);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/api/websocket";
  u.search = "";
  u.hash = "";
  return u.toString();
}

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
    this.reconnectTimer = null;
    if (this.socket) this.socket.close();
    this.socket = null;
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
      this.lastError = error?.message || String(error);
    }
  }

  scheduleReconnect(reason = "connection_lost") {
    if (!this.started || this.reconnectTimer) return;
    this.connected = false;
    this.lastError = reason;
    this.emit("status", this.getStatus());

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoffMs);

    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  connect() {
    if (!this.started) return;

    const { haHost, haToken } = readHaConfig();

    let wsUrl;
    try {
      wsUrl = toWsUrl(haHost);
    } catch (e) {
      throw new Error(`Invalid HA_HOST: ${haHost}`);
    }

    const ws = new WebSocket(wsUrl);
    this.socket = ws;

    ws.on("open", () => {
      this.lastError = null;
    });

    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
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
        this.lastError = null;
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
        const eventData = msg?.event?.data || {};
        if (eventType === "state_changed" && eventData?.new_state?.entity_id) {
          this.states.set(eventData.new_state.entity_id, eventData.new_state);
        }
        this.emit("event", { eventType, data: eventData });
      }
    });

    ws.on("close", (code, reasonBuf) => {
      if (this.socket !== ws) return;
      const reason = reasonBuf ? reasonBuf.toString() : "";
      this.lastError = reason || `socket_closed_${code}`;
      this.socket = null;
      this.scheduleReconnect(this.lastError);
    });

    ws.on("error", (err) => {
      if (this.socket !== ws) return;
      this.lastError = err?.message || "websocket_error";
      this.emit("status", this.getStatus());
      // close will trigger reconnect
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
