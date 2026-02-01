import { CONFIG } from "../core/config.js";
import { on } from "../core/eventBus.js";
import { getEntity } from "../services/homeAssistant/state.js";

const CONNECTION_REFRESH_MS = 10_000;
const METRICS_REFRESH_MS = 60_000;

function formatTime(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatUptime(seconds = 0) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 GB";
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb.toFixed(1)} GB`;
}

function setText(el, value) {
  if (el) el.textContent = value;
}

export function initSystemStatus() {
  const root = document.getElementById("status-view");
  if (!root) return;

  const internetValue = document.getElementById("status-internet-value");
  const internetMeta = document.getElementById("status-internet-meta");
  const haValue = document.getElementById("status-ha-value");
  const haMeta = document.getElementById("status-ha-meta");
  const calendarValue = document.getElementById("status-calendar-value");
  const calendarMeta = document.getElementById("status-calendar-meta");
  const weatherValue = document.getElementById("status-weather-value");
  const weatherMeta = document.getElementById("status-weather-meta");
  const camerasValue = document.getElementById("status-cameras-value");
  const camerasMeta = document.getElementById("status-cameras-meta");
  const tempValue = document.getElementById("status-temp-value");
  const cpuValue = document.getElementById("status-cpu-value");
  const memoryValue = document.getElementById("status-memory-value");
  const uptimeValue = document.getElementById("status-uptime-value");
  const modeValue = document.getElementById("status-mode-value");
  const updateFrequencyValue = document.getElementById("status-update-frequency");

  let haConnected = false;
  let haLastMessage = null;
  let calendarLastSuccess = null;
  let weatherLastSuccess = null;
  let highlightTimer;
  const modeEntityId = CONFIG.systemStatus?.modeEntityId;

  function updateHaDisplay() {
    setText(haValue, haConnected ? "Connected" : "Disconnected");
    const lastMessage = haLastMessage
      ? `Last message ${formatTime(haLastMessage)}`
      : "Waiting for messages";
    setText(haMeta, lastMessage);
  }

  function updateCalendarDisplay() {
    setText(calendarValue, calendarLastSuccess ? "OK" : "Waiting");
    setText(
      calendarMeta,
      calendarLastSuccess ? `Last success ${formatTime(calendarLastSuccess)}` : "No successful fetch yet"
    );
  }

  function updateWeatherDisplay() {
    setText(weatherValue, weatherLastSuccess ? "OK" : "Waiting");
    setText(
      weatherMeta,
      weatherLastSuccess ? `Last success ${formatTime(weatherLastSuccess)}` : "No successful fetch yet"
    );
  }

  function updateModeDisplay() {
    if (modeEntityId) {
      const entity = getEntity(modeEntityId);
      setText(modeValue, entity?.state || "Unknown");
      return;
    }
    setText(modeValue, CONFIG.systemStatus?.modeLabel || "Normal");
  }

  function updateCameraDisplay({ total = 0, online = 0, offline = 0, unknown = 0 } = {}) {
    if (!total) {
      setText(camerasValue, "No cameras");
      setText(camerasMeta, "Camera status unavailable");
      return;
    }
    setText(camerasValue, `${online} online / ${offline} offline`);
    setText(
      camerasMeta,
      unknown ? `${unknown} checking` : `Total ${total} cameras`
    );
  }

  function highlightItem(target) {
    if (!target) return;
    const item = root.querySelector(`[data-status-item="${target}"]`);
    if (!item) return;
    item.classList.add("status-item--highlight");
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => item.classList.remove("status-item--highlight"), 4000);
  }

  async function updateConnectivity() {
    try {
      const response = await fetch("/api/system/ping");
      const data = await response.json();
      if (response.ok && data?.ok) {
        setText(internetValue, `Online · ${Math.round(data.latencyMs)} ms`);
        setText(internetMeta, `Target: ${data.target}`);
        return;
      }
      setText(internetValue, "Offline");
      setText(internetMeta, `Target: ${data?.target ?? "unknown"}`);
    } catch (error) {
      setText(internetValue, "Offline");
      setText(internetMeta, "Ping failed");
    }
  }

  async function updateMetrics() {
    try {
      const response = await fetch("/api/system/metrics");
      if (!response.ok) throw new Error("metrics failed");
      const data = await response.json();
      if (data?.tempC != null) {
        setText(tempValue, `${data.tempC.toFixed(1)}°C`);
      } else {
        setText(tempValue, "—");
      }
      if (data?.cpuLoadPercent != null) {
        setText(cpuValue, `${data.cpuLoadPercent}% load`);
      } else {
        setText(cpuValue, "—");
      }
      if (data?.memory) {
        setText(
          memoryValue,
          `${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`
        );
      } else {
        setText(memoryValue, "—");
      }
      if (data?.uptimeSeconds != null) {
        setText(uptimeValue, formatUptime(data.uptimeSeconds));
      }
    } catch (error) {
      setText(tempValue, "—");
      setText(cpuValue, "—");
      setText(memoryValue, "—");
      setText(uptimeValue, "—");
    }
  }

  setText(
    updateFrequencyValue,
    `Connections: ${CONNECTION_REFRESH_MS / 1000}s · Metrics: ${METRICS_REFRESH_MS / 1000}s`
  );

  updateHaDisplay();
  updateCalendarDisplay();
  updateWeatherDisplay();
  updateModeDisplay();
  updateCameraDisplay();
  updateConnectivity();
  updateMetrics();

  setInterval(updateConnectivity, CONNECTION_REFRESH_MS);
  setInterval(updateMetrics, METRICS_REFRESH_MS);

  on("ha:connected", () => {
    haConnected = true;
    updateHaDisplay();
  });

  on("ha:disconnected", () => {
    haConnected = false;
    updateHaDisplay();
  });

  on("ha:message", ({ receivedAt } = {}) => {
    haLastMessage = receivedAt || Date.now();
    updateHaDisplay();
  });

  on("calendar:refreshed", ({ timestamp } = {}) => {
    calendarLastSuccess = timestamp || Date.now();
    updateCalendarDisplay();
  });

  on("weather:refreshed", ({ timestamp } = {}) => {
    weatherLastSuccess = timestamp || Date.now();
    updateWeatherDisplay();
  });

  on("cameras:status", (status) => updateCameraDisplay(status));

  on("status:highlight", ({ target } = {}) => highlightItem(target));

  document.addEventListener("ha:state-updated", (event) => {
    if (!modeEntityId) return;
    if (event.detail?.entity_id !== modeEntityId) return;
    updateModeDisplay();
  });
}
