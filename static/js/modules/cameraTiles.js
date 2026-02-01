import { emit } from "../core/eventBus.js";

const DEFAULT_SNAPSHOT_REFRESH_MS = 20_000;
const DEFAULT_STREAM_TIMEOUT_MS = 90_000;
const MAX_BACKOFF_MS = 10_000;

const cameraStatuses = new Map();

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

function buildStreamUrl(camera, streamType) {
  const url = new URL(camera.streamUrl, window.location.origin);
  if (streamType) url.searchParams.set("type", streamType);
  return url.toString();
}

function buildSnapshotUrl(camera) {
  const url = new URL(camera.snapshotUrl, window.location.origin);
  url.searchParams.set("t", Date.now().toString());
  return url.toString();
}

function setStatus(card, message = "") {
  const statusEl = card.querySelector(".camera-card__status");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("is-hidden", !message);
}

function setLiveBadge(card, label) {
  const badge = card.querySelector(".camera-card__badge");
  if (!badge) return;
  badge.textContent = label;
  badge.classList.toggle("camera-card__badge--auto", label !== "Live");
}

function toggleActionButtons(card, { showStart, showStop }) {
  const startBtn = card.querySelector(".camera-card__action--start");
  const stopBtn = card.querySelector(".camera-card__action--stop");
  if (startBtn) startBtn.classList.toggle("is-hidden", !showStart);
  if (stopBtn) stopBtn.classList.toggle("is-hidden", !showStop);
}

function showVideo(card, videoEl, imageEl) {
  card.classList.add("is-streaming");
  if (videoEl) videoEl.classList.remove("is-hidden");
  if (imageEl) imageEl.classList.add("is-hidden");
}

function showSnapshot(card, videoEl, imageEl) {
  card.classList.remove("is-streaming");
  if (videoEl) {
    videoEl.pause();
    videoEl.removeAttribute("src");
    videoEl.load();
    videoEl.classList.add("is-hidden");
  }
  if (imageEl) imageEl.classList.remove("is-hidden");
}

function createBackoff() {
  let attempt = 0;
  return () => {
    attempt += 1;
    return Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, attempt - 1));
  };
}

async function fetchCameraConfig() {
  const response = await fetch("/api/cameras");
  if (!response.ok) {
    throw new Error(`Camera config load failed: ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.cameras) ? payload.cameras : [];
}

export async function initCameraTiles() {
  const cards = document.querySelectorAll("[data-camera-id]");
  if (!cards.length) return;

  cards.forEach((card) => {
    const cameraId = card.dataset.cameraId?.replace("camera.", "");
    if (cameraId) updateCameraStatus(cameraId, "unknown");
  });

  let cameras = [];
  try {
    cameras = await fetchCameraConfig();
  } catch (error) {
    console.warn("Camera config unavailable", error);
    cards.forEach((card) => {
      setStatus(card, "Camera config unavailable");
      const cameraId = card.dataset.cameraId?.replace("camera.", "");
      updateCameraStatus(cameraId, "offline");
    });
    return;
  }

  const camerasById = new Map(cameras.map((camera) => [camera.id, camera]));

  cards.forEach((card) => {
    const cameraId = card.dataset.cameraId?.replace("camera.", "");
    const camera = camerasById.get(cameraId);
    const statusKey = camera?.id || cameraId;
    if (!camera) {
      setStatus(card, "Camera not configured");
      updateCameraStatus(statusKey, "offline");
      return;
    }

    const imageEl = card.querySelector(".camera-card__image");
    const videoEl = card.querySelector(".camera-card__video");
    const labelEl = card.querySelector(".camera-card__name");
    if (labelEl) labelEl.textContent = camera.name;

    if (imageEl) {
      imageEl.addEventListener("load", () => updateCameraStatus(statusKey, "online"));
      imageEl.addEventListener("error", () => updateCameraStatus(statusKey, "offline"));
    }

    if (videoEl) {
      videoEl.addEventListener("playing", () => updateCameraStatus(statusKey, "online"));
      videoEl.addEventListener("error", () => updateCameraStatus(statusKey, "offline"));
      videoEl.addEventListener("stalled", () => updateCameraStatus(statusKey, "offline"));
    }

    let snapshotTimer;
    let streamTimer;
    let reconnectTimer;
    let backoff = createBackoff();
    let activeStreamType = camera.streamType;

    const streamTypes = [camera.streamType, ...(camera.streamFallbacks ?? [])].filter(Boolean);

    function clearTimers() {
      if (snapshotTimer) clearInterval(snapshotTimer);
      if (streamTimer) clearTimeout(streamTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      snapshotTimer = null;
      streamTimer = null;
      reconnectTimer = null;
    }

    function startSnapshotPolling() {
      if (!imageEl) return;
      updateCameraStatus(statusKey, "unknown");
      imageEl.src = buildSnapshotUrl(camera);
      if (snapshotTimer) clearInterval(snapshotTimer);
      snapshotTimer = setInterval(() => {
        imageEl.src = buildSnapshotUrl(camera);
      }, camera.snapshotRefreshMs ?? DEFAULT_SNAPSHOT_REFRESH_MS);
    }

    function stopStream() {
      clearTimers();
      showSnapshot(card, videoEl, imageEl);
      toggleActionButtons(card, { showStart: true, showStop: false });
      startSnapshotPolling();
    }

    function scheduleStop() {
      if (camera.mode !== "snapshot") return;
      if (streamTimer) clearTimeout(streamTimer);
      streamTimer = setTimeout(stopStream, camera.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS);
    }

    function handleStreamFailure(isPersistent) {
      setStatus(card, isPersistent ? "Reconnecting…" : "Stream unavailable");
      updateCameraStatus(statusKey, "offline");
      cycleStreamType();
      if (!isPersistent) {
        stopStream();
        return;
      }
      const delay = backoff();
      reconnectTimer = setTimeout(() => startStream(true), delay);
    }

    function attachStreamEvents(isPersistent) {
      if (!videoEl) return;
      const onFailure = () => handleStreamFailure(isPersistent);
      videoEl.onerror = onFailure;
      videoEl.onstalled = onFailure;
      videoEl.onended = onFailure;
    }

    function startStream(isPersistent = false) {
      if (!videoEl) return;
      clearTimers();
      setStatus(card, "Connecting…");
      updateCameraStatus(statusKey, "unknown");
      toggleActionButtons(card, { showStart: false, showStop: camera.mode === "snapshot" });

      const streamUrl = buildStreamUrl(camera, activeStreamType);
      videoEl.src = streamUrl;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;

      showVideo(card, videoEl, imageEl);

      videoEl
        .play()
        .then(() => {
          setStatus(card, "");
          backoff = createBackoff();
          updateCameraStatus(statusKey, "online");
          scheduleStop();
        })
        .catch(() => {
          handleStreamFailure(isPersistent);
        });

      attachStreamEvents(isPersistent);
    }

    function cycleStreamType() {
      if (streamTypes.length <= 1) return;
      const currentIndex = streamTypes.indexOf(activeStreamType);
      const nextIndex = (currentIndex + 1) % streamTypes.length;
      activeStreamType = streamTypes[nextIndex];
    }

    if (camera.mode === "live") {
      setLiveBadge(card, "Live");
      startStream(true);
      return;
    }

    setLiveBadge(card, "Snapshot");
    startSnapshotPolling();
    toggleActionButtons(card, { showStart: true, showStop: false });

    const startBtn = card.querySelector(".camera-card__action--start");
    const stopBtn = card.querySelector(".camera-card__action--stop");

    startBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      startStream(false);
    });

    stopBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      stopStream();
    });

    card.addEventListener("click", () => {
      if (card.classList.contains("is-streaming")) return;
      startStream(false);
    });

  });
}
