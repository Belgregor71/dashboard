import { emit, on } from "../core/eventBus.js";
import { getAllEntities, getEntity } from "../services/homeAssistant/state.js";
import {
  buildCameraConfig,
  buildMediaProxyUrl,
  getPinnedHeroId
} from "./cameras/cameraDiscovery.js";

const SNAPSHOT_REFRESH_MS = 60_000;
const MAX_BACKOFF_MS = 120_000;
const BUCKET_SIZE_MS = 5 * 60 * 1000;
const BUCKET_COUNT = 12;
const TIMELINE_WINDOW_MS = 2 * 60 * 60 * 1000;
const TIMELINE_MAX_EVENTS = 200;
const RECENT_WINDOW_MS = 15 * 60 * 1000;
const SPOTLIGHT_DURATION_MS = 30_000;
const SUMMARY_VISIBLE_MS = 9_000;
const PINNED_STORAGE_KEY = "dashboard:pinned-hero-camera";

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

let cameras = [];
let tileCameras = [];
let camerasById = new Map();
let eventEntityMap = new Map();
let viewActive = false;
let refreshTimer;
let discoveryTimer;
let pinnedCameraId = null;
let focusedCameraId = null;
let heroSpotlightId = null;
let spotlightTimer;
let summaryTimer;

const heroElements = {};
let tilesGrid;
let timelineBand;
let sectionTitle;
let haStatusEl;
let toastEl;
let summaryEl;

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
  haStatusEl.dataset.status = status.toLowerCase();
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

function setToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  setTimeout(() => toastEl.classList.remove("is-visible"), 4000);
}

function getHeroCameraId() {
  return heroSpotlightId || pinnedCameraId || cameras[0]?.id || null;
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
      failureCount: 0,
      nextRetryAt: 0,
      lastSuccessUrl: null,
      stale: false,
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
  cameras = nextCameras;
  camerasById = new Map(cameras.map((camera) => [camera.id, camera]));
  tileCameras = cameras.filter((camera) => camera.hidden === false).slice(0, 6);
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
      failureCount: prev?.failureCount ?? 0,
      nextRetryAt: prev?.nextRetryAt ?? 0,
      lastSuccessUrl: prev?.lastSuccessUrl ?? null,
      stale: prev?.stale ?? false,
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
    state.activityEl = card.querySelector("[data-activity]");
    state.heatEl = card.querySelector("[data-heat]");
    cameraRenderState.set(camera.id, state);
  });

  if (sectionTitle) {
    sectionTitle.textContent = `Camera Tiles (${tileCameras.length})`;
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

  focusedCameraId = targetId;
  const camera = camerasById.get(targetId);
  if (!camera) return;

  heroElements.container.dataset.cameraId = targetId;
  heroElements.nameEl.textContent = camera.name;
  const state = getCameraState(targetId);
  const activityLabel = state?.lastActivity ? formatActivityLabel(state.lastActivity) : "No recent activity";
  heroElements.activityEl.textContent = activityLabel;

  const statusLabel = getStatusLabel(camera, state);
  heroElements.statusEl.textContent = statusLabel;

  const heatData = ensureHeatData(targetId);
  ensureHeatStrip(heroElements.heatEl, heatData.buckets);

  heroElements.badgeEl.classList.toggle("is-hidden", !state?.stale);

  if (state?.lastSuccessUrl) {
    heroElements.imageEl.dataset.cameraId = targetId;
    heroElements.imageEl.src = state.lastSuccessUrl;
  } else {
    refreshCameraImage(camera, { force: true, target: "hero" });
  }
}

function attachImageHandlers(cameraId, state) {
  if (!state?.imageEl) return;

  state.imageEl.addEventListener("load", () => {
    handleImageLoad(cameraId, state.imageEl.src);
  });

  state.imageEl.addEventListener("error", () => {
    handleImageError(cameraId, state.imageEl);
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
    handleImageError(cameraId, heroElements.imageEl);
  });
}

function handleImageLoad(cameraId, src) {
  const state = getCameraState(cameraId);
  state.failureCount = 0;
  state.nextRetryAt = 0;
  state.lastSuccessUrl = src;
  state.stale = false;
  state.badgeEl?.classList.add("is-hidden");
  updateCameraStatus(cameraId, "online");
  if (cameraId === getHeroCameraId()) {
    heroElements.badgeEl?.classList.add("is-hidden");
    if (heroElements.imageEl && heroElements.imageEl.src !== src) {
      heroElements.imageEl.dataset.cameraId = cameraId;
      heroElements.imageEl.src = src;
    }
  }
}

function handleImageError(cameraId, imageEl) {
  const state = getCameraState(cameraId);
  state.failureCount += 1;
  state.stale = true;
  state.badgeEl?.classList.remove("is-hidden");
  updateCameraStatus(cameraId, "offline");
  const delay = Math.min(MAX_BACKOFF_MS, 2000 * Math.pow(2, state.failureCount - 1));
  state.nextRetryAt = Date.now() + delay;
  if (state.lastSuccessUrl && imageEl.src !== state.lastSuccessUrl) {
    imageEl.src = state.lastSuccessUrl;
  }
  if (cameraId === getHeroCameraId()) {
    heroElements.badgeEl?.classList.remove("is-hidden");
  }
}

function getStatusLabel(camera, state) {
  if (isCameraOffline(camera)) return "OFFLINE";
  if (isRecentActivity(state?.lastActivity)) return "RECENT";
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

  if (state.lastActivity && state.activityEl) {
    const label = formatActivityLabel(state.lastActivity);
    state.activityEl.textContent = label;
  }
}

function refreshCameraImage(camera, { force = false, target = "tile" } = {}) {
  if (!camera) return;
  const state = getCameraState(camera.id);
  const now = Date.now();
  if (!force && state.nextRetryAt && now < state.nextRetryAt) return;

  const sourceEntity = camera.eventImageEntity || camera.entityId;
  const url = buildMediaProxyUrl(sourceEntity, true);
  if (!url) return;

  if ((target === "tile" || target === "both") && state.imageEl) {
    state.imageEl.src = url;
  }
  if ((target === "hero" || target === "both") && heroElements.imageEl && getHeroCameraId() === camera.id) {
    heroElements.imageEl.dataset.cameraId = camera.id;
    heroElements.imageEl.src = url;
  }
}

function refreshAllImages({ force = false } = {}) {
  tileCameras.forEach((camera) => {
    refreshCameraImage(camera, { force, target: "tile" });
  });

  const heroId = getHeroCameraId();
  if (heroId) {
    const heroCamera = camerasById.get(heroId);
    if (heroCamera) {
      refreshCameraImage(heroCamera, { force, target: "hero" });
    }
  }
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
  if (state.activityEl) {
    state.activityEl.textContent = formatActivityLabel(activity);
  }
  ensureHeatStrip(state.heatEl, ensureHeatData(cameraId).buckets);

  updateCameraCard(cameraId);

  timelineEvents.unshift({ cameraId, type, timestamp, label: activityLabel });
  pruneTimeline(timestamp);
  renderTimeline();

  refreshCameraImage(camera, { force: true, target: "both" });

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
        refreshCameraImage(camera, { force: true, target: "both" });
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

function startRefreshLoop() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!viewActive) return;
    refreshAllImages({ force: false });
  }, SNAPSHOT_REFRESH_MS);
}

function stopRefreshLoop() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
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
}

export function initCameraTiles() {
  initElements();
  if (!tilesGrid) return;
  attachHeroImageHandlers();

  viewActive = document.body?.dataset?.view === "cameras";

  buildCameraList();
  refreshAllImages({ force: true });
  startRefreshLoop();

  document.addEventListener("ha:state-updated", handleStateUpdated);

  on("view:changed", ({ view }) => {
    viewActive = view === "cameras";
    if (viewActive) {
      refreshAllImages({ force: true });
      updateHero();
    }
  });

  on("ha:connected", () => setHaStatus("Online"));
  on("ha:disconnected", () => setHaStatus("Offline"));

  registerCommandHandlers();
  setHaStatus("Offline");
}
