import { HA_CONFIG } from "../config/ha.js";

export class HAClient {
  constructor() {
    this.ws = null;
    this.msgId = 1;
    this.handlers = {};
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.haDebug = process.env.HA_DEBUG === "1";
  }

  log(message, details = null) {
    if (!this.haDebug) return;
    if (details) {
      console.log(`[HAClient] ${message}`, details);
      return;
    }
    console.log(`[HAClient] ${message}`);
  }

  connect() {
    if (!HA_CONFIG.host || !HA_CONFIG.token) {
      this.log("Missing HA host or token; not connecting");
      return;
    }

    this.ws = new WebSocket(HA_CONFIG.host.replace("http", "ws") + "/api/websocket");

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.log("Socket open");
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "auth_required") {
        this.log("Auth required; sending token", { tokenLength: HA_CONFIG.token.length });
        this.ws.send(JSON.stringify({
          type: "auth",
          access_token: HA_CONFIG.token
        }));
      }

      if (msg.type === "auth_ok") {
        console.log("HA connected");
        this.subscribeStateChanges();
        this.subscribeDashboardEvents();
      }

      if (msg.type === "event") {
        this.handleEvent(msg.event);
      }
    };

    this.ws.onclose = (event) => {
      this.log("Socket closed", {
        code: event?.code,
        reason: event?.reason || "",
        wasClean: event?.wasClean
      });
      this.scheduleReconnect();
    };

    this.ws.onerror = (error) => {
      this.log("Socket error", { message: error?.message || "unknown" });
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delayMs = Math.min(30_000, 2000 * this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
    this.log("Scheduling reconnect", { delayMs, reconnectAttempts: this.reconnectAttempts });
  }

  send(type, payload = {}) {
    this.ws.send(JSON.stringify({
      id: this.msgId++,
      type,
      ...payload
    }));
  }

  on(eventType, callback) {
    this.handlers[eventType] = callback;
  }

  handleEvent(event) {
    if (this.handlers[event.event_type]) {
      this.handlers[event.event_type](event.data);
    }
  }

  subscribeStateChanges() {
    this.send("subscribe_events", {
      event_type: "state_changed"
    });
  }

  subscribeDashboardEvents() {
    this.send("subscribe_events", {
      event_type: "dashboard_command"
    });
  }
}
