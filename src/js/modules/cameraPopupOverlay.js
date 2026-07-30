import { CONFIG } from "../core/config.js";
import { on } from "../core/eventBus.js";
import { switchView, getCurrentView } from "../core/viewManager.js";
import { wakeScreensaver, resetIdleTimer, isScreensaverActive } from "./screensaver.js";


const DEFAULT_DURATION_SECONDS = 30;
const DEFAULT_TRIGGER_STATES = ["on", "ringing", "detected", "motion"];
const SNAPSHOT_DEBOUNCE_MS = 700;
// Eufy's cloud upload of the event image can lag well behind the trigger
// (observed: over a minute) - this window must outlast that lag, or the
// dashboard discards the real image update and the popup is stuck on the
// stale starting frame.
const PENDING_TRIGGER_WINDOW_MS = 150000;
const EVENT_IMAGE_FALLBACK_MS = 2500;
const MOTION_REFRESH_DELAYS_MS = [700, 1500, 2500];
const LIVE_RETRY_DELAY_MS = 3000;
const LIVE_MAX_ATTEMPTS = 2;
// Battery cameras take ~15-20s to wake and start their P2P stream, so live
// often arrives near the end of the popup. Once it does connect, keep the
// popup open at least this long so the live feed actually gets watched
// instead of closing a few seconds later.
const LIVE_MIN_VIEW_MS = 15000;

// Which detections are worth waking a battery camera into a live P2P stream.
// Starting a P2P livestream flips a Eufy battery camera out of its low-power
// event-clip mode into continuous streaming — the single biggest battery
// drain — so plain motion/pet events (cars, shadows, a pet past the door)
// show the free cached event snapshot instead of auto-starting live. Explicit
// "show me the camera" requests still go live regardless (allowLive below).
// Tighten to just "doorbell" for ring-only auto-live.
const LIVE_WORTHY_DETECTIONS = new Set(["person", "doorbell"]);

function isLiveWorthy(detection) {
  return LIVE_WORTHY_DETECTIONS.has(String(detection || "").trim().toLowerCase());
}

function toPositiveSeconds(value, fallback = DEFAULT_DURATION_SECONDS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function buildSnapshotUrl(cameraKey) {
  return `/api/camera/${encodeURIComponent(cameraKey)}/snapshot?ts=${Date.now()}`;
}

function buildLiveUrl(cameraKey) {
  return `/api/camera/${encodeURIComponent(cameraKey)}/live?ts=${Date.now()}`;
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

function isImageEntity(entityId) {
  return String(entityId || "").trim().startsWith("image.");
}

function formatUpdatedLabel(snapshotTs) {
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - snapshotTs) / 1000));
  if (deltaSeconds <= 0) return "Updated just now";
  return `Updated ${deltaSeconds}s ago`;
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

function cameraTitleFromId(cameraId) {
  return String(cameraId || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeTriggerEntityId(entityId) {
  return String(entityId || "").trim().toLowerCase();
}

function normalizeCameraTriggerRegistry(config) {
  const popupConfig = config?.homeAssistant?.cameraPopupOverlay || {};
  const explicitEntries = normalizeTriggerMap(popupConfig);
  const cameraIds = (config?.homeAssistant?.cameraFeeds || [])
    .map((feed) => String(feed?.entityId || "").trim())
    .filter((entityId) => entityId.startsWith("camera."))
    .map((entityId) => entityId.slice("camera.".length));

  const triggerByEntity = new Map();
  const metaByCamera = new Map();

  explicitEntries.forEach((entry) => {
    const camera = String(entry.camera || "").trim();
    if (!camera) return;

    if (!metaByCamera.has(camera)) {
      metaByCamera.set(camera, {
        camera,
        title: entry.title,
        detection: entry.detection,
        priority: entry.priority,
        duration: entry.duration
      });
    }

    triggerByEntity.set(normalizeTriggerEntityId(entry.entityId), {
      camera,
      title: entry.title,
      detection: entry.detection,
      priority: entry.priority,
      duration: entry.duration,
      motionEntityId: normalizeTriggerEntityId(entry.entityId)
    });
  });

  const knownCameras = new Set([...cameraIds, ...metaByCamera.keys()]);
  knownCameras.forEach((camera) => {
    const meta = metaByCamera.get(camera) || {
      camera,
      title: cameraTitleFromId(camera),
      detection: "Motion",
      priority: 10,
      duration: DEFAULT_DURATION_SECONDS
    };

    const register = (entityId, detection = meta.detection) => {
      const normalizedId = normalizeTriggerEntityId(entityId);
      if (!normalizedId) return;
      const existing = triggerByEntity.get(normalizedId);
      triggerByEntity.set(normalizedId, {
        camera: existing?.camera || camera,
        title: existing?.title || meta.title,
        detection: existing?.detection || detection,
        priority: existing?.priority ?? meta.priority,
        duration: existing?.duration ?? meta.duration,
        motionEntityId: existing?.motionEntityId || normalizedId
      });
    };

    register(`binary_sensor.${camera}_motion_detected`, "Motion");
    register(`binary_sensor.${camera}_motion`, "Motion");
    register(`binary_sensor.${camera}_person_detected`, "Person");
    register(`binary_sensor.${camera}_pet_detected`, "Pet");
    register(`binary_sensor.${camera}_ringing`, "Doorbell");
    register(`image.${camera}_event_image`, "Event image");
  });

  return triggerByEntity;
}

function isEventImageEntityForCamera(entityId, cameraKey) {
  return normalizeTriggerEntityId(entityId) === `image.${cameraKey}_event_image`;
}

export function initCameraPopupOverlay() {
  const popupConfig = CONFIG.homeAssistant?.cameraPopupOverlay;
  if (popupConfig?.enabled === false) return;

  const overlayEl = document.getElementById("camera-popup-overlay");
  if (!overlayEl) return;

  const titleEl = document.getElementById("camera-popup-title");
  const badgeEl = document.getElementById("camera-popup-badge");
  const updatedEl = document.getElementById("camera-popup-updated");
  const frameEl = document.getElementById("camera-popup-frame");
  const liveEl = document.getElementById("camera-popup-live");
  const closeBtn = document.getElementById("camera-popup-close");

  if (!titleEl || !badgeEl || !updatedEl || !frameEl) return;

  let autoCloseTimer = null;
  let updatedInterval = null;
  let activeCameraKey = "";
  let liveCameraKey = "";
  let liveAttempts = 0;
  let liveConnecting = false;
  let liveRetryTimer = null;
  let autoCloseAt = 0;
  let activePriority = Number.NEGATIVE_INFINITY;
  let activeSnapshotTimestamp = 0;
  let lastRefreshAt = 0;
  const lastPopupSnapshotAt = {};
  const pendingTriggers = new Map();
  const perCameraTimers = new Map();
  const debugEnabled = popupConfig?.debug === true || CONFIG.homeAssistant?.debug === true;

  const triggerRegistry = normalizeCameraTriggerRegistry(CONFIG);

  function logDebug(message, details = undefined) {
    if (!debugEnabled) return;
    if (typeof details === "undefined") {
      console.debug(`[camera-popup] ${message}`);
      return;
    }
    console.debug(`[camera-popup] ${message}`, details);
  }

  function clearAutoCloseTimer() {
    if (!autoCloseTimer) return;
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }

  function clearPerCameraTimers(cameraKey) {
    const timers = perCameraTimers.get(cameraKey);
    if (!timers) return;
    timers.forEach((timer) => clearTimeout(timer));
    perCameraTimers.delete(cameraKey);
  }

  function clearAllPerCameraTimers() {
    perCameraTimers.forEach((timers) => timers.forEach((timer) => clearTimeout(timer)));
    perCameraTimers.clear();
  }

  function stopUpdatedTicker() {
    if (!updatedInterval) return;
    clearInterval(updatedInterval);
    updatedInterval = null;
  }

  function refreshSnapshot(cameraKey) {
    if (!cameraKey) return;
    if (activeCameraKey && activeCameraKey !== cameraKey) return;
    frameEl.src = buildSnapshotUrl(cameraKey);
    lastRefreshAt = Date.now();
    logDebug("snapshot refresh fired", { camera: cameraKey });
  }

  function updateUpdatedBadge() {
    if (overlayEl.classList.contains("is-live")) {
      updatedEl.textContent = "Live";
      return;
    }
    if (liveConnecting) {
      updatedEl.textContent = "Connecting live…";
      return;
    }
    if (!activeSnapshotTimestamp) {
      updatedEl.textContent = "";
      return;
    }
    updatedEl.textContent = formatUpdatedLabel(activeSnapshotTimestamp);
  }

  function stopLiveStream() {
    if (!liveEl) return;
    clearTimeout(liveRetryTimer);
    liveRetryTimer = null;
    liveCameraKey = "";
    liveAttempts = 0;
    liveConnecting = false;
    overlayEl.classList.remove("is-live");
    // Emptying src aborts the /live request, which lets the server stop the
    // P2P stream once no viewers remain.
    liveEl.src = "";
    liveEl.removeAttribute("src");
  }

  function startLiveStream(cameraKey) {
    if (!liveEl) return;
    if (liveCameraKey === cameraKey) return;
    stopLiveStream();
    liveCameraKey = cameraKey;
    liveAttempts = 1;
    liveConnecting = true;
    liveEl.src = buildLiveUrl(cameraKey);
    updateUpdatedBadge();
    logDebug("live stream requested", { camera: cameraKey });
  }

  function handleLiveFailure() {
    if (!liveCameraKey) return;
    const cameraKey = liveCameraKey;
    overlayEl.classList.remove("is-live");
    updateUpdatedBadge();
    if (liveAttempts >= LIVE_MAX_ATTEMPTS) {
      liveConnecting = false;
      updateUpdatedBadge();
      logDebug("live stream gave up, snapshot fallback", { camera: cameraKey });
      return;
    }
    clearTimeout(liveRetryTimer);
    liveRetryTimer = setTimeout(() => {
      if (activeCameraKey !== cameraKey || liveCameraKey !== cameraKey) return;
      liveAttempts += 1;
      liveEl.src = buildLiveUrl(cameraKey);
      logDebug("live stream retry", { camera: cameraKey, attempt: liveAttempts });
    }, LIVE_RETRY_DELAY_MS);
  }

  function hideCameraPopup() {
    clearAutoCloseTimer();
    stopUpdatedTicker();
    clearAllPerCameraTimers();
    stopLiveStream();
    pendingTriggers.clear();
    activeCameraKey = "";
    activePriority = Number.NEGATIVE_INFINITY;
    activeSnapshotTimestamp = 0;
    lastRefreshAt = 0;
    autoCloseAt = 0;
    overlayEl.classList.remove("is-active");
    overlayEl.setAttribute("aria-hidden", "true");
    frameEl.src = "";
    updatedEl.textContent = "";
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

    wakeScreensaver();
    resetIdleTimer();
    // Float the popup over the ambient home surface. The only view we leave alone is
    // the cameras view when someone deliberately opened it (voice "show cameras") —
    // the popup renders fine over it too. A doorbell/motion event no longer switches
    // to the old cameras grid; it lands here, over home.
    if (getCurrentView() !== "cameras") switchView("home");

    titleEl.textContent = title;
    badgeEl.textContent = `${detection} detected`;

    const now = Date.now();
    const isSameCamera = activeCameraKey === cameraKey;
    const shouldDebounce = isSameCamera && now - lastRefreshAt < SNAPSHOT_DEBOUNCE_MS;

    if (!shouldDebounce) {
      activeSnapshotTimestamp = now;
      lastPopupSnapshotAt[cameraKey] = now;
      refreshSnapshot(cameraKey);
    }

    if (!isSameCamera && !activeSnapshotTimestamp && lastPopupSnapshotAt[cameraKey]) {
      activeSnapshotTimestamp = lastPopupSnapshotAt[cameraKey];
    }
    updateUpdatedBadge();

    activeCameraKey = cameraKey;
    activePriority = incomingPriority;

    overlayEl.classList.add("is-active");
    overlayEl.setAttribute("aria-hidden", "false");

    // Only wake the camera into a live P2P stream for a live-worthy detection
    // (ring/person) or an explicit request; plain motion rides the snapshot.
    if (options.allowLive) startLiveStream(cameraKey);

    stopUpdatedTicker();
    updatedInterval = setInterval(updateUpdatedBadge, 1000);

    clearAutoCloseTimer();
    autoCloseAt = Date.now() + durationSeconds * 1000;
    autoCloseTimer = setTimeout(hideCameraPopup, durationSeconds * 1000);
  }

  // Once the live stream finally connects (~15-20s in for a battery camera),
  // keep the popup open long enough to actually watch it instead of closing
  // moments later.
  function ensureLiveViewingWindow() {
    const now = Date.now();
    if (autoCloseAt - now >= LIVE_MIN_VIEW_MS) return;
    clearAutoCloseTimer();
    autoCloseAt = now + LIVE_MIN_VIEW_MS;
    autoCloseTimer = setTimeout(hideCameraPopup, LIVE_MIN_VIEW_MS);
  }

  function schedulePendingTriggerRefreshes(cameraKey) {
    if (!cameraKey) return;

    clearPerCameraTimers(cameraKey);
    const timers = [];

    MOTION_REFRESH_DELAYS_MS.forEach((delayMs) => {
      timers.push(
        setTimeout(() => {
          if (activeCameraKey !== cameraKey) return;
          activeSnapshotTimestamp = Date.now();
          lastPopupSnapshotAt[cameraKey] = activeSnapshotTimestamp;
          refreshSnapshot(cameraKey);
          updateUpdatedBadge();
        }, delayMs)
      );
    });

    timers.push(
      setTimeout(() => {
        const pending = pendingTriggers.get(cameraKey);
        if (!pending || pending.fulfilled) return;
        if (Date.now() - pending.triggeredAt > PENDING_TRIGGER_WINDOW_MS) {
          pendingTriggers.delete(cameraKey);
          return;
        }

        if (activeCameraKey === cameraKey) {
          activeSnapshotTimestamp = Date.now();
          lastPopupSnapshotAt[cameraKey] = activeSnapshotTimestamp;
          refreshSnapshot(cameraKey);
          updateUpdatedBadge();
        }
        pending.fulfilled = true;
        logDebug("fallback refresh fired", { camera: cameraKey });
      }, EVENT_IMAGE_FALLBACK_MS)
    );

    perCameraTimers.set(cameraKey, timers);
  }

  function createPendingTrigger(cameraKey, trigger, entityId) {
    const pending = {
      triggeredAt: Date.now(),
      title: trigger.title,
      detection: trigger.detection,
      duration: trigger.duration,
      priority: trigger.priority,
      motionEntityId: normalizeTriggerEntityId(entityId),
      waitingForEventImage: true,
      fulfilled: false
    };
    pendingTriggers.set(cameraKey, pending);
    logDebug("pending trigger created", { camera: cameraKey, entityId });
  }

  function handleEventImageRefresh(entityId, trigger) {
    const cameraKey = trigger.camera;

    // If the popup is already showing this camera, refresh the snapshot immediately.
    // Event images can arrive from HA long after PENDING_TRIGGER_WINDOW_MS expires —
    // we still want to update the displayed image while the popup is visible.
    if (activeCameraKey === cameraKey && overlayEl.classList.contains("is-active")) {
      clearPerCameraTimers(cameraKey);
      pendingTriggers.delete(cameraKey);
      logDebug("event image updated while popup active", { camera: cameraKey, entityId });
      activeSnapshotTimestamp = Date.now();
      lastPopupSnapshotAt[cameraKey] = activeSnapshotTimestamp;
      refreshSnapshot(cameraKey);
      updateUpdatedBadge();
      return;
    }

    const pending = pendingTriggers.get(cameraKey);
    if (!pending) return;
    if (Date.now() - pending.triggeredAt > PENDING_TRIGGER_WINDOW_MS) {
      pendingTriggers.delete(cameraKey);
      return;
    }

    pending.fulfilled = true;
    pending.waitingForEventImage = false;
    clearPerCameraTimers(cameraKey);
    logDebug("event image update received", { camera: cameraKey, entityId });

    showCameraPopup(
      {
        camera: cameraKey,
        title: pending.title,
        detection: pending.detection,
        duration: pending.duration
      },
      { priority: pending.priority }
    );

    activeSnapshotTimestamp = Date.now();
    lastPopupSnapshotAt[cameraKey] = activeSnapshotTimestamp;
    refreshSnapshot(cameraKey);
    updateUpdatedBadge();
  }

  if (liveEl) {
    // "load" fires when the first MJPEG frame decodes; later frames just
    // replace the image without re-firing it.
    liveEl.addEventListener("load", () => {
      if (!liveCameraKey || liveCameraKey !== activeCameraKey) return;
      const wasLive = overlayEl.classList.contains("is-live");
      overlayEl.classList.add("is-live");
      liveConnecting = false;
      if (!wasLive) ensureLiveViewingWindow();
      updateUpdatedBadge();
      logDebug("live stream showing", { camera: liveCameraKey });
    });
    liveEl.addEventListener("error", handleLiveFailure);
  }

  closeBtn?.addEventListener("click", hideCameraPopup);
  overlayEl.addEventListener("click", (event) => {
    if (event.target === overlayEl) hideCameraPopup();
  });

  document.addEventListener("ha:state-updated", (event) => {
    const entityId = normalizeTriggerEntityId(event.detail?.entity_id);
    if (!entityId) return;
    logDebug("trigger received", { entityId, state: event.detail?.state });

    const trigger = triggerRegistry.get(entityId);
    if (!trigger) return;

    if (isImageEntity(entityId)) {
      if (!isEventImageEntityForCamera(entityId, trigger.camera)) return;
      handleEventImageRefresh(entityId, trigger);
      return;
    }

    if (!isTriggerActive(popupConfig, event.detail?.state)) return;

    // features.motionWakeGate (audit M5): while Mode 0 is up, plain motion no
    // longer lights the panel. Measured 61 camera-driven wakes in 24h, 49 of
    // them plain motion (driveway alone 33) — a 32" display waking for a car at
    // 3am is not a more useful glance. Same isLiveWorthy rule the battery gate
    // already applies to P2P: person/ring come through, motion waits for the
    // next real glance. Skipped ENTIRELY rather than shown-without-waking —
    // a popup drawn behind an active screensaver is invisible, so its snapshot
    // fetch and 1s ticker would be pure work for nobody. Flag off → unchanged.
    // Read off window.CONFIG, NOT the imported CONFIG — core/config.js has no
    // `features` key at all, so `CONFIG.features?.x` is silently always
    // undefined and any flag written that way is permanently off.
    if (window.CONFIG?.features?.motionWakeGate
        && isScreensaverActive()
        && !isLiveWorthy(trigger.detection)) {
      logDebug("plain motion suppressed while asleep", { entityId, camera: trigger.camera });
      return;
    }

    // features.displayWake (audit M11): between 21:00 and 05:00 the Pi's crontab
    // has the panel powered down via `xset dpms force off`, so a ring at 3am
    // speaks its TTS and draws this popup to a dark screen. Ask the server to
    // light the panel for a hold. Security events only — the same isLiveWorthy
    // set as the wake gate above, so kitchen presence deliberately never lands
    // here. Fire-and-forget: a failure must not cost the popup or the alert.
    if (window.CONFIG?.features?.displayWake && isLiveWorthy(trigger.detection)) {
      fetch("/api/display/wake", { method: "POST" }).catch(() => { /* non-fatal */ });
    }

    logDebug("resolved camera id", { entityId, camera: trigger.camera });
    createPendingTrigger(trigger.camera, trigger, entityId);

    showCameraPopup(
      {
        camera: trigger.camera,
        title: trigger.title,
        detection: trigger.detection,
        duration: trigger.duration
      },
      { priority: trigger.priority, allowLive: isLiveWorthy(trigger.detection) }
    );

    schedulePendingTriggerRefreshes(trigger.camera);
  });

  on("dashboard_command", (data) => {
    if (data?.command !== "show_camera_popup") return;
    showCameraPopup(data, {
      priority: Number.POSITIVE_INFINITY,
      allowLive: true
    });
  });

  // Also handle direct browser debug dispatches used in validation:
  // window.dispatchEvent(new CustomEvent("dashboard_command", { detail: {...} }))
  window.addEventListener("dashboard_command", (event) => {
    const detail = event?.detail;
    if (detail?.command !== "show_camera_popup") return;
    showCameraPopup(detail, {
      priority: Number.POSITIVE_INFINITY,
      allowLive: true
    });
  });

  window.dashboardHideCameraPopup = hideCameraPopup;
}
