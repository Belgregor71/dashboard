import { emit, on } from "../core/eventBus.js";
import { getAllEntities, getEntity } from "../services/homeAssistant/state.js";
import {
  buildCameraConfig,
  getPinnedHeroId
} from "./cameras/cameraDiscovery.js";

const DEFAULT_SNAPSHOT_REFRESH_MS = 15_000;
const STATUS_REFRESH_MS = 60_000;
const BACKOFF_AFTER_FAILURE_MS = 60_000;
const STAGGER_MS = 250;
const BUCKET_SIZE_MS = 5 * 60 * 1000;
const BUCKET_COUNT = 12;
const TIMELINE_WINDOW_MS = 2 * 60 * 60 * 1000;
const TIMELINE_MAX_EVENTS = 200;
const RECENT_WINDOW_MS = 15 * 60 * 1000;
const SPOTLIGHT_DURATION_MS = 30_000;
const SUMMARY_VISIBLE_MS = 9_000;
const PINNED_STORAGE_KEY = "dashboard:pinned-hero-camera";
const DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "1";

const EVENT_WEIGHTS = {
  ringing: 3,
  person: 2,
  motion: 1,
  pet: 1,
  sound: 1,
  crying: 1
};

const ACTIVE_STATES = ["on", "ringing", "detected", "motion"];

const cameraStatuses = new Map();
let cameraRenderState = new Map();
const heatDataByCamera = new Map();
const timelineEvents = [];
const lastEntityStates = new Map();
let serverCameraConfig = new Map();

let cameras = [];
let tileCameras = [];
let camerasById = new Map();
let eventEntityMap = new Map();
let viewActive = false;
let discoveryTimer;
let pinnedCameraId = null;
let focusedCameraId = null;
let heroSpotlightId = null;
let spotlightTimer;
let summaryTimer;
let haHealthTimer;

const heroElements = {};
let tilesGrid;
let timelineBand;
let sectionTitle;
let haStatusEl;
let toastEl;
let summaryEl;
let lastTriggerPillEl;
let lastTriggered = null;

function emitCameraStatus() {
  const total = cameraStatuses.size;
  let online = 0;
  let offline = 0;
  let unknown = 0;
  cameraStatuses.forEach((status) => {
    if (status === "online") online += 1;
    if (status === "offline") offline += 1;
    if (status === "unknown") unknown += 1;
  });

  emit("cameras:status", {
    total,
    online,
    offline,
    unknown
  });
}

function updateCameraStatus(cameraId, status) {
  if (!cameraId) return;
  const prev = cameraStatuses.get(cameraId);
  if (prev === status) return;
  cameraStatuses.set(cameraId, status);
  emitCameraStatus();
}

function setHaStatus(status) {
  if (!haStatusEl) return;
  haStatusEl.textContent = status;
  haStatusEl.dataset.status = status.toLowerCase().replace(/\s+/g, "-");
}

async function loadServerCameraConfig() {
  try {
    const response = await fetch("/api/cameras");
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data?.cameras)) return;
    serverCameraConfig = new Map(
      data.cameras.map((camera) => [camera.id, camera])
    );
    buildCameraList();
    if (viewActive) {
      refreshVisibleSnapshots({ force: true });
    }
  } catch (err) {
    console.warn("Camera config fetch failed", err);
  }
}

async function fetchHaHealth() {
  try {
    const response = await fetch("/api/ha/health");
    if (!response.ok) {
      setHaStatus("Offline");
      return;
    }
    const data = await response.json();
    setHaStatus(data?.ok ? "Online" : "Offline");
  } catch (err) {
    setHaStatus("Offline");
  }
}

function scheduleHaHealth() {
  if (!viewActive) return;
  if (haHealthTimer) clearTimeout(haHealthTimer);
  fetchHaHealth();
  haHealthTimer = setTimeout(scheduleHaHealth, STATUS_REFRESH_MS);
}

function stopHaHealth() {
  if (haHealthTimer) clearTimeout(haHealthTimer);
  haHealthTimer = null;
}

function ensureHeatData(cameraId) {
  if (!heatDataByCamera.has(cameraId)) {
    heatDataByCamera.set(cameraId, {
      buckets: Array.from({ length: BUCKET_COUNT }, () => 0),
      lastBucketStart: getBucketStart(Date.now())
    });
  }
  return heatDataByCamera.get(cameraId);
}

function getBucketStart(timestamp) {
  return Math.floor(timestamp / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
}

function advanceBuckets(heatData, timestamp) {
  const bucketStart = getBucketStart(timestamp);
  const diff = Math.floor((bucketStart - heatData.lastBucketStart) / BUCKET_SIZE_MS);
  if (diff <= 0) return;
  const zeros = Array.from({ length: diff }, () => 0);
  heatData.buckets = zeros.concat(heatData.buckets).slice(0, BUCKET_COUNT);
  heatData.lastBucketStart = bucketStart;
}

function addHeat(cameraId, weight, timestamp) {
  const heatData = ensureHeatData(cameraId);
  advanceBuckets(heatData, timestamp);
  heatData.buckets[0] += weight;
}

function bucketToLevel(weight) {
  if (!weight) return 0;
  if (weight >= 4) return 4;
  if (weight >= 3) return 3;
  if (weight >= 2) return 2;
  return 1;
}

function ensureHeatStrip(container, buckets) {
  if (!container) return;
  if (!container.children.length) {
    container.innerHTML = buckets.map(() => "<span class=\"heat-cell\"></span>").join("");
  }

  const cells = Array.from(container.children);
  buckets.forEach((value, index) => {
    const cell = cells[index];
    if (!cell) return;
    const level = bucketToLevel(value);
    if (cell.dataset.level !== String(level)) {
      cell.dataset.level = String(level);
    }
  });
}

function formatActivityLabel(activity) {
  if (!activity) return "No recent activity";
  const time = new Date(activity.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${activity.label} · ${time}`;
}


function formatTriggerTime(timestamp) {
  if (!timestamp) return "--";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function updateLastTriggerPill() {
  if (!lastTriggerPillEl) return;
  const isHomeView = document.body?.dataset?.view === "home";
  if (!isHomeView || !lastTriggered?.cameraName || !lastTriggered?.timestamp) {
    lastTriggerPillEl.classList.add("hidden");
    lastTriggerPillEl.textContent = "";
    return;
  }

  lastTriggerPillEl.textContent = `${lastTriggered.cameraName} · Last triggered ${formatTriggerTime(lastTriggered.timestamp)}`;
  lastTriggerPillEl.classList.remove("hidden");
}

function setToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  setTimeout(() => toastEl.classList.remove("is-visible"), 4000);
}

function isEntityActive(entity) {
  if (!entity) return false;
  const state = String(entity.state || "").toLowerCase();
  return !["off", "idle", "unavailable", "unknown"].includes(state);
}

function getActiveEventCameraId() {
  const priority = [
    { key: "ringingEntity", type: "ringing" },
    { key: "personEntity", type: "person" },
    { key: "motionEntity", type: "motion" }
  ];

  let best = null;
  let bestPriority = Infinity;
  let bestTimestamp = 0;

  cameras.forEach((camera) => {
    priority.forEach((entry, index) => {
      const entityId = camera?.[entry.key];
      if (!entityId) return;
      const entity = getEntity(entityId);
      if (!isEntityActive(entity)) return;
      const changedAt = Date.parse(entity?.last_changed || entity?.last_updated || "");
      const timestamp = Number.isNaN(changedAt) ? Date.now() : changedAt;
      if (index < bestPriority || (index === bestPriority && timestamp > bestTimestamp)) {
        best = camera.id;
        bestPriority = index;
        bestTimestamp = timestamp;
      }
    });
  });

  return best;
}

function getRecentActivityCameraId() {
  let best = null;
  let bestTimestamp = 0;
  cameras.forEach((camera) => {
    const state = getCameraState(camera.id);
    if (!isRecentActivity(state?.lastActivity)) return;
    if (state.lastActivity.timestamp > bestTimestamp) {
      bestTimestamp = state.lastActivity.timestamp;
      best = camera.id;
    }
  });
  return best;
}

function getHeroCameraId() {
  if (heroSpotlightId && camerasById.has(heroSpotlightId)) return heroSpotlightId;
  const activeId = getActiveEventCameraId();
  if (activeId) return activeId;
  const recentId = getRecentActivityCameraId();
  if (recentId) return recentId;
  return pinnedCameraId || cameras[0]?.id || null;
}

function isRecentActivity(activity) {
  if (!activity?.timestamp) return false;
  return Date.now() - activity.timestamp <= RECENT_WINDOW_MS;
}

function isCameraOffline(camera) {
  if (!camera) return false;
  const enabledEntity = camera.enabledEntity ? getEntity(camera.enabledEntity) : null;
  const debugDeviceEntity = camera.debugDeviceEntity ? getEntity(camera.debugDeviceEntity) : null;
  const enabled = enabledEntity ? enabledEntity.state !== "off" : true;
  const debugDevice = debugDeviceEntity ? debugDeviceEntity.state !== "off" : true;
  return !enabled || !debugDevice;
}

function getCameraState(cameraId) {
  if (!cameraRenderState.has(cameraId)) {
    cameraRenderState.set(cameraId, {
      card: null,
      imageEl: null,
      badgeEl: null,
      statusEl: null,
      activityEl: null,
      heatEl: null,
      debugEl: null,
      failureCount: 0,
      nextRetryAt: 0,
      lastSuccessUrl: null,
      lastObjectUrl: null,
      pendingObjectUrl: null,
      previousObjectUrl: null,
      pendingStale: false,
      stale: false,
      offlineReason: null,
      lastErrorCode: null,
      lastErrorMsg: null,
      refreshTimer: null,
      statusTimer: null,
      abortController: null,
      statusAbortController: null,
      lastActivity: null
    });
  }
  return cameraRenderState.get(cameraId);
}

function setSpotlight(cameraId, durationMs = SPOTLIGHT_DURATION_MS) {
  if (!cameraId || !camerasById.has(cameraId)) return;
  heroSpotlightId = cameraId;
  if (spotlightTimer) clearTimeout(spotlightTimer);
  spotlightTimer = setTimeout(() => {
    heroSpotlightId = null;
    updateHero();
  }, durationMs);
  updateHero();
}

function clearSpotlight() {
  heroSpotlightId = null;
  if (spotlightTimer) clearTimeout(spotlightTimer);
  spotlightTimer = null;
}

function setPinnedCamera(cameraId, { persist = true } = {}) {
  if (!cameraId || !camerasById.has(cameraId)) return;
  pinnedCameraId = cameraId;
  if (persist) {
    localStorage.setItem(PINNED_STORAGE_KEY, cameraId);
  }
  updateHero();
}

function resolvePinnedCamera(camerasList) {
  const stored = localStorage.getItem(PINNED_STORAGE_KEY);
  if (stored && camerasById.has(stored)) return stored;
  const defaultPinned = getPinnedHeroId(camerasList);
  if (camerasById.has(defaultPinned)) return defaultPinned;
  return camerasList[0]?.id || null;
}

function buildCameraList() {
  const statesMap = getAllEntities();
  const nextCameras = buildCameraConfig(statesMap);
  cameras = nextCameras.map((camera) => {
    const serverConfig = serverCameraConfig.get(camera.id);
    return {
      ...camera,
      snapshotRefreshMs: serverConfig?.snapshotRefreshMs ?? DEFAULT_SNAPSHOT_REFRESH_MS,
      preferredSnapshot: serverConfig?.preferredSnapshot || camera.preferredSnapshot || null,
      serverEventImageEntity: serverConfig?.eventImageEntity || null
    };
  });
  camerasById = new Map(cameras.map((camera) => [camera.id, camera]));
  const visibleCameras = cameras.filter((camera) => camera.hidden === false);
  const pinnedHero = cameras.find((camera) => camera.pinnedHero);
  const tileCandidates =
    pinnedHero && !visibleCameras.some((camera) => camera.id === pinnedHero.id)
      ? [pinnedHero, ...visibleCameras]
      : visibleCameras;
  tileCameras = tileCandidates.slice(0, 6);
  eventEntityMap = new Map();

  cameras.forEach((camera) => {
    const mappings = [
      [camera.motionEntity, "motion"],
      [camera.personEntity, "person"],
      [camera.ringingEntity, "ringing"],
      [camera.petEntity, "pet"],
      [camera.soundEntity, "sound"],
      [camera.cryingEntity, "crying"],
      [camera.eventImageEntity, "event_image"]
    ];

    mappings.forEach(([entityId, type]) => {
      if (entityId) {
        eventEntityMap.set(entityId, { cameraId: camera.id, type });
      }
    });
  });

  const nextState = new Map();
  cameras.forEach((camera) => {
    const prev = cameraRenderState.get(camera.id);
    nextState.set(camera.id, {
      card: null,
      imageEl: null,
      badgeEl: null,
      statusEl: null,
      activityEl: null,
      heatEl: null,
      debugEl: null,
      failureCount: prev?.failureCount ?? 0,
      nextRetryAt: prev?.nextRetryAt ?? 0,
      lastSuccessUrl: prev?.lastSuccessUrl ?? null,
      lastObjectUrl: prev?.lastObjectUrl ?? null,
      pendingObjectUrl: prev?.pendingObjectUrl ?? null,
      previousObjectUrl: prev?.previousObjectUrl ?? null,
      pendingStale: prev?.pendingStale ?? false,
      stale: prev?.stale ?? false,
      offlineReason: prev?.offlineReason ?? null,
      lastErrorCode: prev?.lastErrorCode ?? null,
      lastErrorMsg: prev?.lastErrorMsg ?? null,
      refreshTimer: prev?.refreshTimer ?? null,
      statusTimer: prev?.statusTimer ?? null,
      abortController: prev?.abortController ?? null,
      statusAbortController: prev?.statusAbortController ?? null,
      lastActivity: prev?.lastActivity ?? null
    });
  });
  cameraRenderState = nextState;

  pinnedCameraId = resolvePinnedCamera(cameras);
  if (heroSpotlightId && !camerasById.has(heroSpotlightId)) {
    clearSpotlight();
  }

  renderCameraGrid();
  updateHero();
}

function renderCameraGrid() {
  if (!tilesGrid) return;
  tilesGrid.innerHTML = "";
  tileCameras.forEach((camera) => {
    const card = document.createElement("article");
    card.className = "camera-card";
    card.dataset.cameraId = camera.id;

    card.innerHTML = `
      <div class="camera-card__preview">
        <img class="camera-card__image" alt="${camera.name} snapshot" />
        <span class="camera-card__badge camera-card__badge--stale is-hidden" data-badge>STALE</span>
        <div class="camera-card__pill" data-status></div>
        <div class="camera-card__debug is-hidden" data-debug></div>
      </div>
      <div class="camera-card__body">
        <div class="camera-card__name">${camera.name}</div>
        <div class="camera-card__meta" data-activity>No recent activity</div>
        <div class="camera-card__heat" data-heat></div>
      </div>
    `;

    card.addEventListener("click", () => focusCamera(camera.id));

    tilesGrid.appendChild(card);

    const state = getCameraState(camera.id);
    state.card = card;
    state.imageEl = card.querySelector(".camera-card__image");
    state.badgeEl = card.querySelector("[data-badge]");
    state.statusEl = card.querySelector("[data-status]");
    state.debugEl = card.querySelector("[data-debug]");
    state.activityEl = card.querySelector("[data-activity]");
    state.heatEl = card.querySelector("[data-heat]");
    cameraRenderState.set(camera.id, state);
  });

  if (sectionTitle) {
    sectionTitle.textContent = `Cameras (${tileCameras.length})`;
  }

  tileCameras.forEach((camera) => {
    const state = cameraRenderState.get(camera.id);
    if (!state) return;
    attachImageHandlers(camera.id, state);
    updateCameraCard(camera.id);
  });
}

function updateHero() {
  if (!heroElements.imageEl) return;
  const targetId = getHeroCameraId();
  if (!targetId) return;

  const previousId = heroElements.imageEl.dataset.cameraId;
  if (previousId && previousId !== targetId) {
    heroElements.imageEl.classList.add("is-fading");
    setTimeout(() => heroElements.imageEl.classList.remove("is-fading"), 220);
  }

  focusedCameraId = targetId;
  const camera = camerasById.get(targetId);
  if (!camera) return;

  heroElements.container.dataset.cameraId = targetId;
  heroElements.nameEl.textContent = camera.name;
  const state = getCameraState(targetId);
  const hasRecent = isRecentActivity(state?.lastActivity);
  const activityLabel = state?.offlineReason
    ? state.offlineReason
    : hasRecent
      ? formatActivityLabel(state.lastActivity)
      : "";
  heroElements.activityEl.textContent = activityLabel;
  heroElements.activityEl.classList.toggle(
    "is-hidden",
    !Boolean(state?.offlineReason || hasRecent)
  );
  heroElements.heatEl?.classList.toggle("is-hidden", !hasRecent);
  heroElements.container.classList.toggle(
    "is-idle",
    !Boolean(hasRecent || state?.offlineReason)
  );

  const statusLabel = getStatusLabel(camera, state);
  heroElements.statusEl.textContent = statusLabel;
  heroElements.statusEl.dataset.status = statusLabel.toLowerCase();

  const heatData = ensureHeatData(targetId);
  ensureHeatStrip(heroElements.heatEl, heatData.buckets);

  heroElements.badgeEl.classList.toggle("is-hidden", !state?.stale);

  if (state?.lastSuccessUrl) {
    heroElements.imageEl.dataset.cameraId = targetId;
    heroElements.imageEl.src = state.lastSuccessUrl;
  } else {
    scheduleSnapshot(camera, { force: true, target: "hero" });
  }
}

function attachImageHandlers(cameraId, state) {
  if (!state?.imageEl) return;
  state.imageEl.addEventListener("load", () => {
    handleImageLoad(cameraId, state.imageEl.src);
  });
  state.imageEl.addEventListener("error", () => {
    handleImageRenderError(cameraId);
  });
}

function attachHeroImageHandlers() {
  if (!heroElements.imageEl) return;
  heroElements.imageEl.addEventListener("load", () => {
    const cameraId = heroElements.imageEl.dataset.cameraId;
    if (!cameraId) return;
    handleImageLoad(cameraId, heroElements.imageEl.src);
  });
  heroElements.imageEl.addEventListener("error", () => {
    const cameraId = heroElements.imageEl.dataset.cameraId;
    if (!cameraId) return;
    handleImageRenderError(cameraId);
  });
}

function handleImageLoad(cameraId, src) {
  const state = getCameraState(cameraId);
  if (state.pendingObjectUrl && src !== state.pendingObjectUrl) {
    return;
  }
  if (state.previousObjectUrl && state.previousObjectUrl !== state.pendingObjectUrl) {
    revokeObjectUrl(state.previousObjectUrl);
  }
  state.lastObjectUrl = state.pendingObjectUrl || src;
  state.lastSuccessUrl = state.pendingObjectUrl || src;
  state.pendingObjectUrl = null;
  state.previousObjectUrl = null;
  state.stale = state.pendingStale;
  state.pendingStale = false;
  state.failureCount = 0;
  state.nextRetryAt = 0;
  state.offlineReason = null;
  state.lastErrorCode = null;
  state.lastErrorMsg = null;
  state.badgeEl?.classList.toggle("is-hidden", !state.stale);
  updateCameraStatus(cameraId, state.stale ? "offline" : "online");
  updateCameraCard(cameraId);
  if (cameraId === getHeroCameraId()) {
    heroElements.badgeEl?.classList.toggle("is-hidden", !state.stale);
  }
}

function handleImageRenderError(cameraId) {
  const state = getCameraState(cameraId);
  if (!state.lastSuccessUrl) return;
  if (state.pendingObjectUrl) {
    revokeObjectUrl(state.pendingObjectUrl);
    state.pendingObjectUrl = null;
    state.pendingStale = false;
    if (state.previousObjectUrl) {
      state.lastObjectUrl = state.previousObjectUrl;
      state.lastSuccessUrl = state.previousObjectUrl;
      state.previousObjectUrl = null;
    }
  }
  state.failureCount = Math.max(state.failureCount, 1);
  state.stale = true;
  state.badgeEl?.classList.remove("is-hidden");
  updateCameraStatus(cameraId, "offline");
  if (cameraId === getHeroCameraId()) {
    heroElements.badgeEl?.classList.remove("is-hidden");
  }
}

function getStatusLabel(camera, state) {
  if (state?.offlineReason) return "OFFLINE";
  if (isCameraOffline(camera)) return "OFFLINE";
  if (state?.stale) return "STALE";
  return "CLEAR";
}

function updateCameraCard(cameraId) {
  const camera = camerasById.get(cameraId);
  const state = getCameraState(cameraId);
  if (!camera || !state) return;

  const statusLabel = getStatusLabel(camera, state);
  if (state.statusEl) {
    state.statusEl.textContent = statusLabel;
    state.statusEl.dataset.status = statusLabel.toLowerCase();
  }

  const heatData = ensureHeatData(cameraId);
  ensureHeatStrip(state.heatEl, heatData.buckets);

  if (state.activityEl) {
    const hasRecent = isRecentActivity(state?.lastActivity);
    if (state.offlineReason) {
      state.activityEl.textContent = state.offlineReason;
    } else if (hasRecent) {
      const label = formatActivityLabel(state.lastActivity);
      state.activityEl.textContent = label;
    } else if (DEBUG_MODE) {
      state.activityEl.textContent = "No recent activity";
    } else {
      state.activityEl.textContent = "";
    }
    const showActivity = Boolean(state.offlineReason || hasRecent || DEBUG_MODE);
    state.activityEl.classList.toggle("is-hidden", !showActivity);
    state.heatEl?.classList.toggle("is-hidden", !hasRecent);
  }

  if (state.debugEl) {
    const debugMessage = state.lastErrorCode
      ? `${state.lastErrorCode}${state.lastErrorMsg ? `: ${state.lastErrorMsg}` : ""}`
      : "";
    state.debugEl.textContent = debugMessage;
    state.debugEl.classList.toggle("is-hidden", !DEBUG_MODE || !debugMessage);
  }
}

function revokeObjectUrl(url) {
  if (!url) return;
  URL.revokeObjectURL(url);
}

async function fetchCameraStatus(camera, { signal } = {}) {
  if (!camera) return;
  const state = getCameraState(camera.id);
  if (state.statusAbortController) {
    state.statusAbortController.abort();
  }
  const controller = new AbortController();
  state.statusAbortController = controller;

  try {
    const response = await fetch(`/api/camera/${camera.id}/status`, {
      signal: signal || controller.signal
    });
    if (!response.ok) return;
    const status = await response.json();
    state.lastErrorCode = status.lastErrorCode || null;
    state.lastErrorMsg = status.lastErrorMsg || null;
    if (status.ok) {
      state.offlineReason = null;
      updateCameraStatus(camera.id, "online");
    } else if (status.lastErrorMsg && state.failureCount >= 3) {
      state.offlineReason = status.lastErrorMsg;
      updateCameraStatus(camera.id, "offline");
    }
    updateCameraCard(camera.id);
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.warn("Camera status fetch failed", err);
    }
  }
}

function applySnapshotSuccess(cameraId, objectUrl, { stale = false, target = "tile" } = {}) {
  const state = getCameraState(cameraId);
  state.stale = stale;
  state.pendingStale = stale;
  state.badgeEl?.classList.toggle("is-hidden", !stale);
  state.previousObjectUrl = state.lastObjectUrl;
  state.pendingObjectUrl = objectUrl;

  if ((target === "tile" || target === "both") && state.imageEl) {
    state.imageEl.src = objectUrl;
  }
  if (heroElements.imageEl && getHeroCameraId() === cameraId) {
    heroElements.imageEl.dataset.cameraId = cameraId;
    heroElements.imageEl.src = objectUrl;
    heroElements.badgeEl?.classList.toggle("is-hidden", !stale);
  }
}

function applySnapshotFailure(cameraId, errorMessage, errorCode) {
  const state = getCameraState(cameraId);
  state.failureCount += 1;
  state.lastErrorMsg = errorMessage || "Snapshot failed";
  state.lastErrorCode = errorCode || "snapshot_failed";
  if (state.failureCount >= 3) {
    state.offlineReason = state.lastErrorMsg;
    state.nextRetryAt = Date.now() + BACKOFF_AFTER_FAILURE_MS;
  } else {
    state.nextRetryAt = Date.now() + DEFAULT_SNAPSHOT_REFRESH_MS;
  }
  state.stale = true;
  state.badgeEl?.classList.remove("is-hidden");
  updateCameraStatus(cameraId, "offline");
  updateCameraCard(cameraId);
  if (cameraId === getHeroCameraId()) {
    heroElements.badgeEl?.classList.remove("is-hidden");
  }
}

async function fetchCameraSnapshot(camera, { target = "tile" } = {}) {
  if (!camera) return;
  const state = getCameraState(camera.id);
  if (state.abortController) {
    state.abortController.abort();
  }
  const controller = new AbortController();
  state.abortController = controller;

  const url = `/api/camera/${camera.id}/snapshot?ts=${Date.now()}`;
  try {
    const response = await fetch(url, {
      signal: controller.signal
    });
    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      let payload = {};
      if (contentType.includes("application/json")) {
        payload = await response.json();
      }
      applySnapshotFailure(camera.id, payload.error, payload.code);
      return;
    }

    const stale = response.headers.get("x-dashboard-stale") === "1";
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    applySnapshotSuccess(camera.id, objectUrl, { stale, target });
    if (stale) {
      fetchCameraStatus(camera);
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    applySnapshotFailure(camera.id, err?.message, "network");
  }
}

function scheduleSnapshot(camera, { force = false, target = "tile", delayMs = 0 } = {}) {
  if (!camera) return;
  const state = getCameraState(camera.id);
  if (state.refreshTimer) clearTimeout(state.refreshTimer);

  state.refreshTimer = setTimeout(async () => {
    if (!viewActive) return;
    const now = Date.now();
    if (!force && state.nextRetryAt && now < state.nextRetryAt) {
      scheduleSnapshot(camera, {
        force: false,
        target,
        delayMs: state.nextRetryAt - now
      });
      return;
    }

    await fetchCameraSnapshot(camera, { target });
    const refreshMs = camera.snapshotRefreshMs ?? DEFAULT_SNAPSHOT_REFRESH_MS;
    const nextDelay = state.nextRetryAt && state.nextRetryAt > Date.now()
      ? state.nextRetryAt - Date.now()
      : refreshMs;
    scheduleSnapshot(camera, { force: false, target, delayMs: nextDelay });
  }, delayMs);
}

function scheduleStatus(camera, delayMs = STATUS_REFRESH_MS) {
  if (!camera) return;
  const state = getCameraState(camera.id);
  if (state.statusTimer) clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(async () => {
    if (!viewActive) return;
    await fetchCameraStatus(camera);
    scheduleStatus(camera, STATUS_REFRESH_MS);
  }, delayMs);
}

function refreshVisibleSnapshots({ force = false } = {}) {
  const heroId = getHeroCameraId();
  const hasHeroInTiles = tileCameras.some((camera) => camera.id === heroId);

  tileCameras.forEach((camera, index) => {
    scheduleSnapshot(camera, {
      force,
      target: heroId === camera.id ? "both" : "tile",
      delayMs: index * STAGGER_MS
    });
    scheduleStatus(camera, index * STAGGER_MS);
  });

  if (heroId && !hasHeroInTiles) {
    const heroCamera = camerasById.get(heroId);
    if (heroCamera) {
      scheduleSnapshot(heroCamera, {
        force,
        target: "hero",
        delayMs: tileCameras.length * STAGGER_MS
      });
      scheduleStatus(heroCamera, tileCameras.length * STAGGER_MS);
    }
  }
}

function stopAllCameraTimers() {
  cameras.forEach((camera) => {
    const state = getCameraState(camera.id);
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    if (state.statusTimer) clearTimeout(state.statusTimer);
    state.refreshTimer = null;
    state.statusTimer = null;
    state.abortController?.abort();
    state.statusAbortController?.abort();
    state.abortController = null;
    state.statusAbortController = null;
  });
}

function focusCamera(cameraId) {
  if (!cameraId || !camerasById.has(cameraId)) return;
  setSpotlight(cameraId);
}

function cycleCamera(direction) {
  if (!tileCameras.length) return;
  const activeId = getHeroCameraId() || tileCameras[0].id;
  const currentIndex = tileCameras.findIndex((camera) => camera.id === activeId);
  if (currentIndex === -1) return;
  const nextIndex = (currentIndex + direction + tileCameras.length) % tileCameras.length;
  setSpotlight(tileCameras[nextIndex].id);
}

function handleCameraEvent(cameraId, type, timestamp) {
  const camera = camerasById.get(cameraId);
  if (!camera) return;

  const weight = EVENT_WEIGHTS[type] ?? 1;
  addHeat(cameraId, weight, timestamp);

  const activityLabel = type === "person" ? resolvePersonLabel(camera) : titleizeEvent(type);
  const activity = { label: activityLabel, timestamp, type };

  const state = getCameraState(cameraId);
  state.lastActivity = activity;
  lastTriggered = {
    cameraId,
    cameraName: camera.name,
    timestamp,
    type
  };
  updateLastTriggerPill();
  if (state.activityEl) {
    state.activityEl.textContent = formatActivityLabel(activity);
  }
  ensureHeatStrip(state.heatEl, ensureHeatData(cameraId).buckets);

  updateCameraCard(cameraId);

  timelineEvents.unshift({ cameraId, type, timestamp, label: activityLabel });
  pruneTimeline(timestamp);
  renderTimeline();

  scheduleSnapshot(camera, { force: true, target: "both" });

  if (cameraId === getHeroCameraId()) {
    heroElements.activityEl.textContent = formatActivityLabel(activity);
    ensureHeatStrip(heroElements.heatEl, ensureHeatData(cameraId).buckets);
  } else {
    setSpotlight(cameraId);
  }
}

function resolvePersonLabel(camera) {
  if (!camera?.personNameEntity) return "Person";
  const personEntity = getEntity(camera.personNameEntity);
  const name = personEntity?.state && personEntity.state !== "unknown" ? personEntity.state : "Person";
  return `Person: ${name}`;
}

function titleizeEvent(type) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function pruneTimeline(now) {
  const cutoff = now - TIMELINE_WINDOW_MS;
  while (timelineEvents.length > TIMELINE_MAX_EVENTS) {
    timelineEvents.pop();
  }
  for (let i = timelineEvents.length - 1; i >= 0; i -= 1) {
    if (timelineEvents[i].timestamp < cutoff) {
      timelineEvents.splice(i, 1);
    }
  }
}

function renderTimeline() {
  if (!timelineBand) return;
  const now = Date.now();
  const cutoff = now - TIMELINE_WINDOW_MS;
  timelineBand.innerHTML = "";

  timelineEvents.forEach((event) => {
    if (event.timestamp < cutoff) return;
    const marker = document.createElement("span");
    marker.className = "camera-timeline__marker";
    const pct = ((event.timestamp - cutoff) / TIMELINE_WINDOW_MS) * 100;
    marker.style.left = `${Math.min(100, Math.max(0, pct))}%`;
    marker.title = `${event.label} (${new Date(event.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    })})`;
    timelineBand.appendChild(marker);
  });
}

function getSummaryActivityLabel(activity) {
  if (!activity) return "";
  if (["sound", "crying"].includes(activity.type)) {
    return "Activity";
  }
  return activity.label;
}

function buildSummary({ cameraId = null, expanded = false } = {}) {
  if (cameraId) {
    const camera = camerasById.get(cameraId);
    if (!camera) return null;
    const state = getCameraState(cameraId);
    const statusLabel = getStatusLabel(camera, state);
    const activityLabel = state?.lastActivity
      ? getSummaryActivityLabel(state.lastActivity)
      : "No recent activity";
    return {
      title: camera.name,
      status: statusLabel,
      body: activityLabel
    };
  }

  const activeCameras = cameras
    .map((camera) => {
      const state = getCameraState(camera.id);
      return { camera, state };
    })
    .filter(({ state }) => isRecentActivity(state?.lastActivity))
    .sort((a, b) => b.state.lastActivity.timestamp - a.state.lastActivity.timestamp);

  const visibleActive = expanded ? activeCameras : activeCameras.slice(0, 3);

  const offlineCameras = cameras.filter((camera) => isCameraOffline(camera));

  return {
    title: expanded ? "Camera Summary (Expanded)" : "Camera Summary",
    active: visibleActive,
    offline: offlineCameras,
    expanded
  };
}

function showSummaryOverlay(options = {}) {
  if (!summaryEl) return;
  const summary = buildSummary(options);
  if (!summary) return;

  if (summary.body) {
    summaryEl.innerHTML = `
      <div class="camera-summary__title">${summary.title}</div>
      <div class="camera-summary__status">${summary.status}</div>
      <div class="camera-summary__body">${summary.body}</div>
    `;
  } else {
    const activeItems = summary.active.length
      ? summary.active
          .map(({ camera, state }) => {
            const label = getSummaryActivityLabel(state?.lastActivity);
            return `<li>${camera.name}${label ? ` · ${label}` : ""}</li>`;
          })
          .join("")
      : "<li>No recent activity</li>";
    const offlineItems = summary.offline.length
      ? summary.offline.map((camera) => `<li>${camera.name}</li>`).join("")
      : "<li>All cameras online</li>";

    summaryEl.innerHTML = `
      <div class="camera-summary__title">${summary.title}</div>
      <div class="camera-summary__section">
        <div class="camera-summary__label">Recent</div>
        <ul>${activeItems}</ul>
      </div>
      <div class="camera-summary__section">
        <div class="camera-summary__label">Offline</div>
        <ul>${offlineItems}</ul>
      </div>
    `;
  }

  summaryEl.classList.add("is-visible");
  if (summaryTimer) clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => summaryEl.classList.remove("is-visible"), SUMMARY_VISIBLE_MS);
}

function scheduleDiscoveryRefresh() {
  if (discoveryTimer) return;
  discoveryTimer = setTimeout(() => {
    discoveryTimer = null;
    buildCameraList();
  }, 250);
}

function handleStateUpdated(event) {
  const entity = event.detail;
  if (!entity?.entity_id) return;

  const entityId = entity.entity_id;
  const prevState = lastEntityStates.get(entityId);
  lastEntityStates.set(entityId, entity.state);

  if (entityId.startsWith("camera.") || entityId.startsWith("image.")) {
    scheduleDiscoveryRefresh();
  }

  const mapping = eventEntityMap.get(entityId);
  if (mapping) {
    const normalized = String(entity.state).toLowerCase();
    const wasActive = prevState && ACTIVE_STATES.includes(String(prevState).toLowerCase());
    const isActive = ACTIVE_STATES.includes(normalized) || mapping.type === "event_image";

    if (isActive && (!wasActive || mapping.type === "event_image")) {
      if (mapping.type !== "event_image") {
        handleCameraEvent(mapping.cameraId, mapping.type, Date.now());
      } else {
        const camera = camerasById.get(mapping.cameraId);
        scheduleSnapshot(camera, { force: true, target: "both" });
      }
    }
  }

  cameras.forEach((camera) => {
    if (camera.enabledEntity === entityId || camera.debugDeviceEntity === entityId) {
      updateCameraCard(camera.id);
      if (camera.id === getHeroCameraId()) {
        updateHero();
      }
    }
    if (camera.personNameEntity === entityId) {
      const state = getCameraState(camera.id);
      if (state?.lastActivity?.label?.startsWith("Person")) {
        state.lastActivity = {
          ...state.lastActivity,
          label: resolvePersonLabel(camera)
        };
        if (state.activityEl) {
          state.activityEl.textContent = formatActivityLabel(state.lastActivity);
        }
        if (camera.id === getHeroCameraId()) {
          heroElements.activityEl.textContent = formatActivityLabel(state.lastActivity);
        }
      }
    }
  });
}

function registerCommandHandlers() {
  on("dashboard_command", (data) => {
    const command = data?.command || data?.intent || data?.action;
    if (!command) return;

    if (command === "camera_focus") {
      const cameraId = data.camera_id || data.cameraId || data.value;
      if (cameraId && camerasById.has(cameraId)) {
        setSpotlight(cameraId);
        setToast(`Focused ${cameraId}`);
      } else {
        setToast("Camera not found");
      }
      return;
    }

    if (command === "camera_cycle_next") {
      cycleCamera(1);
      setToast("Cycling to next camera");
      return;
    }

    if (command === "camera_cycle_prev") {
      cycleCamera(-1);
      setToast("Cycling to previous camera");
      return;
    }

    if (command === "camera_pin") {
      const cameraId = data.camera_id || data.cameraId || data.value;
      if (cameraId && camerasById.has(cameraId)) {
        setPinnedCamera(cameraId, { persist: true });
        clearSpotlight();
        setToast(`Pinned ${cameraId}`);
      }
      return;
    }

    if (command === "camera_unpin") {
      const defaultPinned = getPinnedHeroId(cameras);
      if (defaultPinned && camerasById.has(defaultPinned)) {
        setPinnedCamera(defaultPinned, { persist: true });
      }
      clearSpotlight();
      setToast("Camera unpinned");
      return;
    }

    if (command === "camera_summary") {
      const cameraId = data.camera_id || data.cameraId || data.value;
      const expanded = Boolean(data.expanded || data.mode === "expanded");
      if (cameraId && camerasById.has(cameraId)) {
        showSummaryOverlay({ cameraId, expanded });
      } else {
        showSummaryOverlay({ expanded });
      }
      return;
    }

    if (command === "camera_live_start" || command === "camera_live_stop") {
      setToast("Live view not configured");
    }
  });
}

function initElements() {
  heroElements.container = document.getElementById("camera-hero");
  heroElements.imageEl = document.querySelector(".camera-hero__image");
  heroElements.nameEl = document.getElementById("camera-hero-name");
  heroElements.statusEl = document.getElementById("camera-hero-status");
  heroElements.activityEl = document.getElementById("camera-hero-activity");
  heroElements.heatEl = document.getElementById("camera-hero-heat");
  heroElements.badgeEl = document.querySelector(".camera-hero__badge");

  tilesGrid = document.getElementById("camera-tiles-grid");
  timelineBand = document.getElementById("camera-timeline-band");
  sectionTitle = document.getElementById("camera-tiles-title");
  haStatusEl = document.getElementById("cameras-ha-status");
  toastEl = document.getElementById("camera-toast");
  summaryEl = document.getElementById("camera-summary");
  lastTriggerPillEl = document.getElementById("camera-last-trigger-pill");
}

export function initCameraTiles() {
  initElements();
  if (!tilesGrid) return;
  attachHeroImageHandlers();

  viewActive = document.body?.dataset?.view === "cameras";

  buildCameraList();
  loadServerCameraConfig();
  refreshVisibleSnapshots({ force: true });
  scheduleHaHealth();

  document.addEventListener("ha:state-updated", handleStateUpdated);

  on("view:changed", ({ view }) => {
    viewActive = view === "cameras";
    if (viewActive) {
      refreshVisibleSnapshots({ force: true });
      updateHero();
      scheduleHaHealth();
    } else {
      stopAllCameraTimers();
      stopHaHealth();
    }
    updateLastTriggerPill();
  });

  on("ha:connected", () => setHaStatus("Online"));
  on("ha:disconnected", ({ reason } = {}) => {
    if (reason === "token_missing") {
      setHaStatus("Token Missing");
      return;
    }
    setHaStatus("Offline");
  });

  registerCommandHandlers();
  updateLastTriggerPill();
  setHaStatus("Offline");
}
