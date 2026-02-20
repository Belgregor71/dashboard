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
  const view = createStatusView();
  view.render();
  view.onEnter();
  return view;
}

export function createStatusView() {
  const root = document.getElementById("status-view");
  if (!root) {
    return {
      render: () => {},
      onEnter: () => {},
      onLeave: () => {}
    };
  }

  const headerHa = document.getElementById("status-header-ha");
  const headerMode = document.getElementById("status-header-mode");
  const headerHaIndicator = headerHa?.closest(".status-header-pill")?.querySelector(".status-indicator");

  const alertsPanel = document.getElementById("status-alerts");
  const alertsList = document.getElementById("status-alerts-list");
  const headerAlertBadge = document.getElementById("status-header-alert-badge");
  const headerAlertCount = document.getElementById("status-header-alert-count");

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
  const updateFrequencyValue = document.getElementById("status-update-frequency");
  const aiPanel = document.getElementById("status-ai-panel");
  const aiText = document.getElementById("status-ai-text");
  const aiAction = document.getElementById("status-ai-action");
  const aiRefreshButton = document.getElementById("status-ai-refresh");
  const explainTriggerButton = document.getElementById("status-explain-trigger");

  let haConnected = false;
  let haLastMessage = null;
  let calendarLastSuccess = null;
  let weatherLastSuccess = null;
  let highlightTimer;
  let connectivityInterval = null;
  let metricsInterval = null;
  let rendered = false;
  let latestAlertCount = 0;
  let aiLoading = false;
  const modeEntityId = CONFIG.systemStatus?.modeEntityId;

  function setIndicator(target, level) {
    if (!target) return;
    const indicator = target.querySelector(".status-indicator");
    if (!indicator) return;
    indicator.classList.remove(
      "status-indicator--ok",
      "status-indicator--warn",
      "status-indicator--error",
      "status-indicator--info"
    );
    indicator.classList.add(`status-indicator--${level}`);
    target.dataset.statusLevel = level;
  }

  function updateHaDisplay() {
    setText(haValue, haConnected ? "Connected" : "Disconnected");
    const lastMessage = haLastMessage
      ? `Last message ${formatTime(haLastMessage)}`
      : "Waiting for messages";
    setText(haMeta, lastMessage);
    setText(headerHa, haConnected ? "Connected" : "Disconnected");
    if (headerHaIndicator) {
      headerHaIndicator.classList.remove(
        "status-indicator--ok",
        "status-indicator--warn",
        "status-indicator--error"
      );
      headerHaIndicator.classList.add(haConnected ? "status-indicator--ok" : "status-indicator--error");
    }
  }

  function updateCalendarDisplay() {
    setText(calendarValue, calendarLastSuccess ? "OK" : "Waiting");
    setText(
      calendarMeta,
      calendarLastSuccess ? `Last success ${formatTime(calendarLastSuccess)}` : "No successful fetch yet"
    );
    setIndicator(
      root.querySelector('[data-status-item="calendar"]'),
      calendarLastSuccess ? "ok" : "warn"
    );
  }

  function updateWeatherDisplay() {
    setText(weatherValue, weatherLastSuccess ? "OK" : "Waiting");
    setText(
      weatherMeta,
      weatherLastSuccess ? `Last success ${formatTime(weatherLastSuccess)}` : "No successful fetch yet"
    );
    setIndicator(
      root.querySelector('[data-status-item="weather"]'),
      weatherLastSuccess ? "ok" : "warn"
    );
  }

  function updateModeDisplay() {
    if (modeEntityId) {
      const entity = getEntity(modeEntityId);
      setText(headerMode, entity?.state || "Unknown");
      return;
    }
    setText(headerMode, CONFIG.systemStatus?.modeLabel || "Normal");
  }

  function updateCameraDisplay({ total = 0, online = 0, offline = 0, unknown = 0 } = {}) {
    const statusItem = root.querySelector('[data-status-item="cameras"]');
    if (!total) {
      setText(camerasValue, "No cameras");
      setText(camerasMeta, "Camera status unavailable");
      setIndicator(statusItem, "warn");
      return;
    }
    setText(camerasValue, `${online} online / ${offline} offline`);
    setText(
      camerasMeta,
      unknown ? `${unknown} checking` : `Total ${total} cameras`
    );
    if (offline > 0) {
      setIndicator(statusItem, "warn");
    } else if (online === 0) {
      setIndicator(statusItem, "error");
    } else {
      setIndicator(statusItem, "ok");
    }
  }



  async function explainStatus() {
    if (!aiPanel || aiLoading || latestAlertCount <= 0) return;
    aiLoading = true;
    aiPanel.hidden = false;
    setText(aiText, "Analyzing system status…");
    setText(aiAction, "");

    try {
      const response = await fetch("/api/ai/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Explain current dashboard system status and suggest one action." })
      });
      if (!response.ok) throw new Error("ai route failed");
      const data = await response.json();
      setText(aiText, data?.response || "System needs attention.");
      setText(aiAction, data?.intent === "status_explain" ? "Suggested action: review highlighted warning rows." : "Suggested action: verify internet and Home Assistant connectivity.");
    } catch (error) {
      setText(aiText, "Unable to generate AI explanation right now.");
      setText(aiAction, "Suggested action: check network and retry.");
    } finally {
      aiLoading = false;
    }
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
    const statusItem = root.querySelector('[data-status-item="internet"]');
    try {
      const response = await fetch("/api/system/ping");
      const data = await response.json();
      if (response.ok && data?.ok) {
        setText(internetValue, `Online · ${Math.round(data.latencyMs)} ms`);
        setText(internetMeta, `Target: ${data.target}`);
        setIndicator(statusItem, "ok");
        updateAlerts();
        return;
      }
      setText(internetValue, "Offline");
      setText(internetMeta, `Target: ${data?.target ?? "unknown"}`);
      setIndicator(statusItem, "error");
      updateAlerts();
    } catch (error) {
      setText(internetValue, "Offline");
      setText(internetMeta, "Ping failed");
      setIndicator(statusItem, "error");
      updateAlerts();
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
      setIndicator(root.querySelector('[data-status-item="temp"]'), "info");
      setIndicator(root.querySelector('[data-status-item="cpu"]'), "info");
      setIndicator(root.querySelector('[data-status-item="memory"]'), "info");
      updateAlerts();
    } catch (error) {
      setText(tempValue, "—");
      setText(cpuValue, "—");
      setText(memoryValue, "—");
      setText(uptimeValue, "—");
      updateAlerts();
    }
  }

  function updateHaStatusIndicator() {
    const statusItem = root.querySelector('[data-status-item="ha"]');
    setIndicator(statusItem, haConnected ? "ok" : "error");
  }

  function updateAlerts() {
    if (!alertsPanel || !alertsList) return;
    const alertItems = [];
    root.querySelectorAll("[data-status-level]").forEach((item) => {
      const level = item.dataset.statusLevel;
      if (level !== "warn" && level !== "error") return;
      const label = item.querySelector(".status-item__label")?.textContent?.trim();
      const value = item.querySelector(".status-item__value")?.textContent?.trim();
      if (label && value) {
        alertItems.push(`${label}: ${value}`);
      }
    });

    latestAlertCount = alertItems.length;

    if (!alertItems.length) {
      alertsPanel.classList.remove("is-visible");
      alertsPanel.setAttribute("aria-hidden", "true");
      if (headerAlertBadge) headerAlertBadge.hidden = true;
      if (headerAlertCount) headerAlertCount.textContent = "0 issues";
      alertsList.textContent = "";
      if (aiPanel) aiPanel.hidden = true;
      return;
    }

    alertsPanel.classList.add("is-visible");
    alertsPanel.setAttribute("aria-hidden", "false");
    if (headerAlertBadge) headerAlertBadge.hidden = false;
    if (headerAlertCount) {
      const issueLabel = alertItems.length === 1 ? "issue" : "issues";
      headerAlertCount.textContent = `${alertItems.length} ${issueLabel}`;
    }
    alertsList.innerHTML = "";
    alertItems.forEach((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      alertsList.append(span);
    });
  }

  function startPolling() {
    if (!connectivityInterval) {
      connectivityInterval = setInterval(updateConnectivity, CONNECTION_REFRESH_MS);
    }
    if (!metricsInterval) {
      metricsInterval = setInterval(updateMetrics, METRICS_REFRESH_MS);
    }
  }

  function stopPolling() {
    if (connectivityInterval) {
      clearInterval(connectivityInterval);
      connectivityInterval = null;
    }
    if (metricsInterval) {
      clearInterval(metricsInterval);
      metricsInterval = null;
    }
    if (highlightTimer) {
      clearTimeout(highlightTimer);
      highlightTimer = null;
    }
  }

  function render() {
    if (rendered) return;
    rendered = true;

    setText(
      updateFrequencyValue,
      `Connections: ${CONNECTION_REFRESH_MS / 1000}s · Metrics: ${METRICS_REFRESH_MS / 1000}s`
    );

    updateHaDisplay();
    updateHaStatusIndicator();
    updateCalendarDisplay();
    updateWeatherDisplay();
    updateModeDisplay();
    updateCameraDisplay();
    updateAlerts();

    on("ha:connected", () => {
      haConnected = true;
      updateHaDisplay();
      updateHaStatusIndicator();
      updateAlerts();
    });

    on("ha:disconnected", () => {
      haConnected = false;
      updateHaDisplay();
      updateHaStatusIndicator();
      updateAlerts();
    });

    on("ha:message", ({ receivedAt } = {}) => {
      haLastMessage = receivedAt || Date.now();
      updateHaDisplay();
    });

    on("calendar:refreshed", ({ timestamp } = {}) => {
      calendarLastSuccess = timestamp || Date.now();
      updateCalendarDisplay();
      updateAlerts();
    });

    on("weather:refreshed", ({ timestamp } = {}) => {
      weatherLastSuccess = timestamp || Date.now();
      updateWeatherDisplay();
      updateAlerts();
    });

    on("cameras:status", (status) => {
      updateCameraDisplay(status);
      updateAlerts();
    });

    on("status:highlight", ({ target } = {}) => highlightItem(target));
    on("status:explain-requested", () => explainStatus());

    aiRefreshButton?.addEventListener("click", () => {
      explainStatus();
    });
    explainTriggerButton?.addEventListener("click", () => {
      explainStatus();
    });

    document.addEventListener("ha:state-updated", (event) => {
      if (!modeEntityId) return;
      if (event.detail?.entity_id !== modeEntityId) return;
      updateModeDisplay();
    });
  }

  function onEnter() {
    updateConnectivity();
    updateMetrics();
    startPolling();
  }

  function onLeave() {
    stopPolling();
  }

  return {
    render,
    onEnter,
    onLeave
  };
}
