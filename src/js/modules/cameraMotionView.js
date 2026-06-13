import { CONFIG } from "../core/config.js";
import { switchView } from "../core/viewManager.js";

const DEFAULT_TRIGGER_STATES = ["on", "ringing", "detected", "motion"];

function normalizeTriggerStates(config) {
  const states = config?.triggerStates;
  if (Array.isArray(states) && states.length) return states.map(state => state.toLowerCase());
  return DEFAULT_TRIGGER_STATES;
}

function normalizeEntityIds(config) {
  const ids = config?.triggerEntityIds;
  if (Array.isArray(ids)) return ids.filter(Boolean);
  if (typeof ids === "string" && ids.trim()) return [ids.trim()];
  return [];
}

function isTriggerActive(config, state) {
  if (!state) return false;
  const normalized = String(state).toLowerCase();
  return normalizeTriggerStates(config).includes(normalized);
}

export function initCameraMotionView() {
  const viewConfig = CONFIG.homeAssistant?.cameraMotionView;
  if (!viewConfig?.enabled) return;

  const triggerEntityIds = normalizeEntityIds(viewConfig);
  if (!triggerEntityIds.length) return;

  const targetView = viewConfig?.view || "cameras";
  const returnView = viewConfig?.returnView || "home";
  const durationMs = viewConfig?.durationMs ?? 30000;

  let returnTimer;

  function scheduleReturn() {
    if (returnTimer) clearTimeout(returnTimer);
    returnTimer = setTimeout(() => switchView(returnView), durationMs);
  }

  function activateView() {
    switchView(targetView);
    scheduleReturn();
  }

  document.addEventListener("ha:state-updated", (event) => {
    const entityId = event.detail?.entity_id;
    if (!entityId || !triggerEntityIds.includes(entityId)) return;
    if (isTriggerActive(viewConfig, event.detail?.state)) {
      activateView();
    }
  });
}
