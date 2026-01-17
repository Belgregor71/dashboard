import { on } from "../core/eventBus.js";

const STATUS_CLASSES = {
  connected: "ha-status--connected",
  disconnected: "ha-status--disconnected",
  disabled: "ha-status--disabled"
};

function setStatus(el, status, label) {
  if (!el) return;
  el.classList.remove(
    STATUS_CLASSES.connected,
    STATUS_CLASSES.disconnected,
    STATUS_CLASSES.disabled
  );
  el.classList.add(STATUS_CLASSES[status] ?? STATUS_CLASSES.disconnected);
  el.innerHTML = `<span class="ha-status__dot"></span>${label}`;
}

export function initHaStatus({ enabled } = {}) {
  const statusEl = document.getElementById("ha-status");
  if (!statusEl) return;

  if (!enabled) {
    setStatus(statusEl, "disabled", "HA: disabled");
    return;
  }

  setStatus(statusEl, "disconnected", "HA: connecting");

  on("ha:connected", () => {
    setStatus(statusEl, "connected", "HA: connected");
  });

  on("ha:disconnected", () => {
    setStatus(statusEl, "disconnected", "HA: disconnected");
  });
}
