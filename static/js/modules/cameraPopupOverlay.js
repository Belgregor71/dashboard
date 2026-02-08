import { on } from "../core/eventBus.js";

const ENV = typeof window !== "undefined" ? window.__ENV__ ?? {} : {};

const GO2RTC_BASE_URL = ENV.GO2RTC_HOST || "http://192.168.0.144:1984";
const DEFAULT_DURATION_SECONDS = 30;

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

export function initCameraPopupOverlay() {
  const overlayEl = document.getElementById("camera-popup-overlay");
  if (!overlayEl) return;

  const titleEl = document.getElementById("camera-popup-title");
  const badgeEl = document.getElementById("camera-popup-badge");
  const frameEl = document.getElementById("camera-popup-frame");
  const closeBtn = document.getElementById("camera-popup-close");

  if (!titleEl || !badgeEl || !frameEl) return;

  let autoCloseTimer = null;
  let activeCameraKey = "";

  function clearAutoCloseTimer() {
    if (!autoCloseTimer) return;
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }

  function hideCameraPopup() {
    clearAutoCloseTimer();
    activeCameraKey = "";
    overlayEl.classList.remove("is-active");
    overlayEl.setAttribute("aria-hidden", "true");
    // Important for Raspberry Pi performance: unload stream iframe when hidden.
    frameEl.src = "about:blank";
  }

  function showCameraPopup(payload = {}) {
    const cameraKey = normalizeText(payload.camera, "");
    if (!cameraKey) return;

    const title = normalizeText(payload.title, cameraKey);
    const detection = normalizeText(payload.detection, "Motion");
    const durationSeconds = toPositiveSeconds(payload.duration, DEFAULT_DURATION_SECONDS);

    titleEl.textContent = title;
    badgeEl.textContent = `${detection} detected`;

    const streamUrl = buildMseStreamUrl(cameraKey);
    // Use go2rtc MSE stream.html so this works even when HA camera_proxy returns 403 in Chromium kiosk.
    if (activeCameraKey !== cameraKey || frameEl.src !== streamUrl) {
      frameEl.src = streamUrl;
    }
    activeCameraKey = cameraKey;

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

  on("dashboard_command", (data) => {
    if (data?.command !== "show_camera_popup") return;
    showCameraPopup(data);
  });

  // Also handle direct browser debug dispatches used in validation:
  // window.dispatchEvent(new CustomEvent("dashboard_command", { detail: {...} }))
  window.addEventListener("dashboard_command", (event) => {
    const detail = event?.detail;
    if (detail?.command !== "show_camera_popup") return;
    showCameraPopup(detail);
  });

  window.dashboardHideCameraPopup = hideCameraPopup;
}
