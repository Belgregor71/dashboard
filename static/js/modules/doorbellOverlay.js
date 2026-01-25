import { CONFIG } from "../core/config.js";
import { on } from "../core/eventBus.js";
import { getEntity } from "../services/homeAssistant/state.js";

const DEFAULT_TRIGGER_STATES = ["on", "ringing", "detected", "motion"];

function resolveUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `${CONFIG.homeAssistant?.url ?? ""}${url}`;
  return url;
}

function resolveStreamUrl(config, cameraEntity) {
  if (config?.streamUrl) return resolveUrl(config.streamUrl);
  if (config?.streamPath) return resolveUrl(config.streamPath);
  const entityPicture = cameraEntity?.attributes?.entity_picture;
  if (entityPicture) return resolveUrl(entityPicture);
  if (config?.cameraEntityId) {
    return resolveUrl(`/api/camera_proxy_stream/${config.cameraEntityId}`);
  }
  return "";
}

function normalizeTriggerStates(config) {
  const states = config?.triggerStates;
  if (Array.isArray(states) && states.length) return states.map(state => state.toLowerCase());
  return DEFAULT_TRIGGER_STATES;
}

function isTriggerActive(config, state) {
  if (!state) return false;
  const normalized = String(state).toLowerCase();
  return normalizeTriggerStates(config).includes(normalized);
}

export function initDoorbellOverlay() {
  const overlayConfig = CONFIG.homeAssistant?.doorbellOverlay;
  if (!overlayConfig?.enabled) return;

  const overlayEl = document.getElementById("doorbell-overlay");
  if (!overlayEl) return;

  const imageEl = overlayEl.querySelector(".doorbell-overlay__image");
  const emptyEl = overlayEl.querySelector(".doorbell-overlay__empty");
  const statusEl = overlayEl.querySelector(".doorbell-overlay__status");
  const closeBtn = overlayEl.querySelector(".doorbell-overlay__close");

  let autoCloseTimer;

  function setVisibility(isVisible) {
    overlayEl.classList.toggle("is-active", isVisible);
    overlayEl.setAttribute("aria-hidden", String(!isVisible));
    document.body.classList.toggle("is-overlay-active", isVisible);
    if (!isVisible && autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
  }

  function setMedia(url) {
    const resolvedUrl = resolveUrl(url);
    if (!imageEl || !emptyEl) return;
    imageEl.src = resolvedUrl;
    imageEl.classList.toggle("is-hidden", !resolvedUrl);
    emptyEl.classList.toggle("is-hidden", Boolean(resolvedUrl));
  }

  function showOverlay({ status, streamUrl } = {}) {
    setVisibility(true);
    if (statusEl && status) statusEl.textContent = status;
    if (streamUrl) {
      setMedia(streamUrl);
    } else {
      const cameraEntity = overlayConfig?.cameraEntityId
        ? getEntity(overlayConfig.cameraEntityId)
        : null;
      setMedia(resolveStreamUrl(overlayConfig, cameraEntity));
    }

    if (overlayConfig?.autoCloseMs) {
      if (autoCloseTimer) clearTimeout(autoCloseTimer);
      autoCloseTimer = setTimeout(() => setVisibility(false), overlayConfig.autoCloseMs);
    }
  }

  function hideOverlay() {
    setVisibility(false);
  }

  closeBtn?.addEventListener("click", hideOverlay);
  overlayEl.addEventListener("click", (event) => {
    if (event.target === overlayEl) hideOverlay();
  });

  document.addEventListener("ha:state-updated", (event) => {
    const entityId = event.detail?.entity_id;
    if (!entityId) return;

    if (entityId === overlayConfig?.triggerEntityId) {
      if (isTriggerActive(overlayConfig, event.detail?.state)) {
        showOverlay({
          status: overlayConfig?.activeLabel || "Doorbell activated"
        });
      }
      return;
    }

    if (entityId === overlayConfig?.cameraEntityId && overlayEl.classList.contains("is-active")) {
      setMedia(resolveStreamUrl(overlayConfig, event.detail));
    }
  });

  on("ha:event:dashboard_command", (data) => {
    if (data?.command !== "doorbell_overlay") return;
    if (data?.action === "hide") {
      hideOverlay();
      return;
    }
    showOverlay({
      status: data?.status || overlayConfig?.activeLabel || "Doorbell activated",
      streamUrl: data?.streamUrl
    });
  });
}
