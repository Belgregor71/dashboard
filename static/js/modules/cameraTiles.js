const DEFAULT_SNAPSHOT_REFRESH_MS = 20_000;
const DEFAULT_STREAM_TIMEOUT_MS = 90_000;
const MAX_BACKOFF_MS = 10_000;

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

  let cameras = [];
  try {
    cameras = await fetchCameraConfig();
  } catch (error) {
    console.warn("Camera config unavailable", error);
    cards.forEach((card) => setStatus(card, "Camera config unavailable"));
    return;
  }

  const camerasById = new Map(cameras.map((camera) => [camera.id, camera]));

  cards.forEach((card) => {
    const cameraId = card.dataset.cameraId?.replace("camera.", "");
    const camera = camerasById.get(cameraId);
    if (!camera) {
      setStatus(card, "Camera not configured");
      return;
    }

    const imageEl = card.querySelector(".camera-card__image");
    const videoEl = card.querySelector(".camera-card__video");
    const labelEl = card.querySelector(".camera-card__name");
    if (labelEl) labelEl.textContent = camera.name;

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
