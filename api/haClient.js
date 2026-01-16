import { HA_CONFIG } from "../config/ha.js";

export class HAClient {
  constructor() {
    this.ws = null;
    this.msgId = 1;
    this.handlers = {};
  }

  connect() {
    this.ws = new WebSocket(
      HA_CONFIG.host.replace("http", "ws") + "/api/websocket"
    );

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "auth_required") {
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
