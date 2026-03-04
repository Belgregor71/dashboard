import { CONFIG } from "../core/config.js";
import { on } from "../core/eventBus.js";
import { switchView } from "../core/viewManager.js";

const ENV = typeof window !== "undefined" ? window.__ENV__ ?? {} : {};

const GO2RTC_BASE_URL = ENV.GO2RTC_HOST || "http://192.168.0.179:1984";
const DEFAULT_DURATION_SECONDS = 30;
const DEFAULT_TRIGGER_STATES = ["on", "ringing", "detected", "motion"];

function toPositiveSeconds(value, fallback = DEFAULT_DURATION_SECONDS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function buildMseStreamUrl(cameraKey) {
  const url = new URL("/stream.html", GO2RTC_BASE_URL);
  url.searchParams.set("src", cameraKey);
  url.searchParams.set("mode", "mse");
  return url.toString();
}

function normalizeTriggerStates(config) {
  const states = config?.triggerStates;
  if (Array.isArray(states) && states.length) return states.map((state) => String(state).toLowerCase());
  return DEFAULT_TRIGGER_STATES;
}

function isTriggerActive(config, state) {
  if (!state) return false;
  const normalized = String(state).toLowerCase();
  return normalizeTriggerStates(config).includes(normalized);
}

function normalizeTriggerMap(config) {
  const entries = config?.triggerCameraMap;
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry) => {
      if (!entry || !entry.entityId || !entry.camera) return null;
      return {
        entityId: String(entry.entityId).trim(),
        camera: String(entry.camera).trim(),
        title: normalizeText(entry.title, String(entry.camera).trim()),
        detection: normalizeText(entry.detection, "Motion"),
        priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 0,
        duration: toPositiveSeconds(entry.duration, DEFAULT_DURATION_SECONDS)
      };
    })
    .filter(Boolean);
}

export function initCameraPopupOverlay() {
  const popupConfig = CONFIG.homeAssistant?.cameraPopupOverlay;
  if (popupConfig?.enabled === false) return;

  const overlayEl = document.getElementById("camera-popup-overlay");
  if (!overlayEl) return;

  const titleEl = document.getElementById("camera-popup-title");
  const badgeEl = document.getElementById("camera-popup-badge");
  const frameEl = document.getElementById("camera-popup-frame");
  const closeBtn = document.getElementById("camera-popup-close");

  if (!titleEl || !badgeEl || !frameEl) return;

  let autoCloseTimer = null;
  let activeCameraKey = "";
  let activePriority = Number.NEGATIVE_INFINITY;

  const triggerMap = normalizeTriggerMap(popupConfig);
  const triggerMapByEntity = new Map(triggerMap.map((entry) => [entry.entityId, entry]));

  function clearAutoCloseTimer() {
    if (!autoCloseTimer) return;
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }

  function hideCameraPopup() {
    clearAutoCloseTimer();
    activeCameraKey = "";
    activePriority = Number.NEGATIVE_INFINITY;
    overlayEl.classList.remove("is-active");
    overlayEl.setAttribute("aria-hidden", "true");
    // Important for Raspberry Pi performance: unload stream iframe when hidden.
    frameEl.src = "about:blank";
  }

  function showCameraPopup(payload = {}, options = {}) {
    const cameraKey = normalizeText(payload.camera, "");
    if (!cameraKey) return;

    const incomingPriority = Number.isFinite(Number(options.priority))
      ? Number(options.priority)
      : Number.NEGATIVE_INFINITY;

    if (overlayEl.classList.contains("is-active") && incomingPriority < activePriority) {
      return;
    }

    const title = normalizeText(payload.title, cameraKey);
    const detection = normalizeText(payload.detection, "Motion");
    const durationSeconds = toPositiveSeconds(payload.duration, DEFAULT_DURATION_SECONDS);

    switchView("home");

    titleEl.textContent = title;
    badgeEl.textContent = `${detection} detected`;

    const streamUrl = buildMseStreamUrl(cameraKey);
    // Use go2rtc MSE stream.html so this works even when HA camera_proxy returns 403 in Chromium kiosk.
    if (activeCameraKey !== cameraKey || frameEl.src !== streamUrl) {
      frameEl.src = streamUrl;
    }

    activeCameraKey = cameraKey;
    activePriority = incomingPriority;

    overlayEl.classList.add("is-active");
    overlayEl.setAttribute("aria-hidden", "false");

    clearAutoCloseTimer();
    autoCloseTimer = setTimeout(() => {
      hideCameraPopup();
    }, durationSeconds * 1000);
  }

  closeBtn?.addEventListener("click", hideCameraPopup);
  overlayEl.addEventListener("click", (event) => {
    if (event.target === overlayEl) hideCameraPopup();
  });

  document.addEventListener("ha:state-updated", (event) => {
    const entityId = event.detail?.entity_id;
    if (!entityId) return;

    const trigger = triggerMapByEntity.get(entityId);
    if (!trigger) return;

    if (!isTriggerActive(popupConfig, event.detail?.state)) return;

    showCameraPopup(
      {
        camera: trigger.camera,
        title: trigger.title,
        detection: trigger.detection,
        duration: trigger.duration
      },
      { priority: trigger.priority }
    );
  });

  on("dashboard_command", (data) => {
    if (data?.command !== "show_camera_popup") return;
    showCameraPopup(data, {
      priority: Number.POSITIVE_INFINITY
    });
  });

  // Also handle direct browser debug dispatches used in validation:
  // window.dispatchEvent(new CustomEvent("dashboard_command", { detail: {...} }))
  window.addEventListener("dashboard_command", (event) => {
    const detail = event?.detail;
    if (detail?.command !== "show_camera_popup") return;
    showCameraPopup(detail, {
      priority: Number.POSITIVE_INFINITY
    });
  });

  window.dashboardHideCameraPopup = hideCameraPopup;
}
