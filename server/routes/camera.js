import express from "express";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { CAMERA_CONFIG } from "../../config/cameras.js";
import { normalizeBaseUrl } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";

const router = express.Router();

const SNAPSHOT_TIMEOUT_MS = 6000;
const SNAPSHOT_RETRY_DELAY_MS = 300;
const SNAPSHOT_MAX_RETRIES = 1;
const SNAPSHOT_STALE_WINDOW_MS = 10 * 60 * 1000;

const snapshotCache = new Map();
const cameraStatusCache = new Map();
const CAMERA_MAP = new Map(CAMERA_CONFIG.map((c) => [c.id, c]));

function resolveAbsoluteUrl(pathValue, baseUrl) {
  if (!pathValue) return null;
  if (/^https?:\/\//i.test(pathValue)) return pathValue;
  if (!baseUrl) return null;
  return new URL(pathValue, baseUrl).toString();
}

function getCameraConfig(id) { return CAMERA_MAP.get(id); }
function getCameraEntity(camera) { return camera?.cameraEntity || camera?.entity || null; }

function getCameraStatus(id) {
  const current = cameraStatusCache.get(id);
  if (current) return current;
  return {
    id,
    name: getCameraConfig(id)?.name || id,
    ok: false,
    sourceUsed: null,
    lastSuccessTs: null,
    lastErrorTs: null,
    lastErrorCode: null,
    lastErrorMsg: null
  };
}

function setCameraStatus(id, updates) {
  const next = { ...getCameraStatus(id), ...updates };
  cameraStatusCache.set(id, next);
  return next;
}

function buildGo2RtcUrl(pathValue) {
  return resolveAbsoluteUrl(pathValue, normalizeBaseUrl(process.env.GO2RTC_HOST));
}

function buildHaUrl(pathValue) {
  return resolveAbsoluteUrl(pathValue, normalizeBaseUrl(process.env.HA_HOST || process.env.HA_URL));
}

function resolveEventImageSource(camera) {
  if (camera.eventImagePath) return { type: "eventImage", url: buildHaUrl(camera.eventImagePath) };
  if (camera.eventImageEntity) {
    return {
      type: "eventImage",
      url: buildHaUrl(`/api/image_proxy/${encodeURIComponent(camera.eventImageEntity)}`)
    };
  }
  return null;
}

function resolveCameraProxySource(camera) {
  const entity = getCameraEntity(camera);
  if (!entity) return null;
  return {
    type: "cameraProxy",
    url: buildHaUrl(`/api/camera_proxy/${encodeURIComponent(entity)}`)
  };
}

function resolveLegacySnapshotSource(camera) {
  if (!camera.snapshotPath) return null;
  return { type: "legacySnapshot", url: buildHaUrl(camera.snapshotPath) };
}

function buildSnapshotSources(camera) {
  const sources = [];
  const eventSource = resolveEventImageSource(camera);
  const cameraSource = resolveCameraProxySource(camera);
  const legacySource = resolveLegacySnapshotSource(camera);

  if (camera.preferredSnapshot === "cameraProxy") {
    if (cameraSource) sources.push(cameraSource);
    if (eventSource) sources.push(eventSource);
  } else {
    if (eventSource) sources.push(eventSource);
    if (cameraSource) sources.push(cameraSource);
  }

  if (legacySource && !sources.some((s) => s.url === legacySource.url)) {
    sources.push(legacySource);
  }
  return sources;
}

function resolveStreamUrl(camera, streamType) {
  if (!camera) return null;
  const type = streamType || camera.streamType;
  const pathValue = camera.streamPaths?.[type] || camera.go2rtcPath;
  return buildGo2RtcUrl(pathValue);
}

function isAllowedUpstreamUrl(urlValue, allowedHost) {
  if (!urlValue || !allowedHost) return false;
  try {
    const url = new URL(urlValue);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    return url.host === allowedHost;
  } catch { return false; }
}

function rewriteHlsPlaylist(playlist, cameraId, upstreamUrl) {
  const baseUrl = new URL(upstreamUrl);
  return playlist.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const absolute = new URL(trimmed, baseUrl).toString();
    return `/api/camera/${cameraId}/stream?url=${encodeURIComponent(absolute)}`;
  }).join("\n");
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function shouldRetryStatus(status) {
  if (!status) return true;
  if (status >= 500) return true;
  if (status === 408) return true;
  return false;
}

function mapHaError(status, error) {
  if (status === 401 || status === 403) {
    return { status, code: "auth", message: "Home Assistant authentication failed" };
  }
  if (status === 404) return { status, code: "missing_entity", message: "Camera entity not found" };
  if (status >= 500) return { status, code: "ha_error", message: "Home Assistant error" };
  if (status === 408) return { status: 504, code: "timeout", message: "Home Assistant timeout" };
  if (error?.name === "AbortError") return { status: 504, code: "timeout", message: "Home Assistant timeout" };
  return {
    status: status || 502,
    code: "network",
    message: error?.message || "Home Assistant unreachable"
  };
}

async function fetchHaWithRetry(url, options = {}, { timeoutMs, retries, retryDelayMs } = {}) {
  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (response.ok || !shouldRetryStatus(response.status) || attempt === retries) {
        return response;
      }
      lastError = new Error(`HA returned ${response.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    }
    attempt += 1;
    await sleep(retryDelayMs);
  }
  throw lastError;
}

async function fetchHaImage(url, { timeoutMs = SNAPSHOT_TIMEOUT_MS } = {}) {
  const token = process.env.HA_TOKEN;
  if (!token) {
    throw Object.assign(new Error("Home Assistant token missing"), { status: 500, code: "auth" });
  }
  return fetchHaWithRetry(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    },
    { timeoutMs, retries: SNAPSHOT_MAX_RETRIES, retryDelayMs: SNAPSHOT_RETRY_DELAY_MS }
  );
}

async function fetchCameraSnapshot(camera) {
  const sources = buildSnapshotSources(camera);
  if (!sources.length) {
    throw Object.assign(new Error("Snapshot source not configured"), {
      status: 500,
      code: "missing_config"
    });
  }

  let lastFailure = null;
  for (const source of sources) {
    try {
      const response = await fetchHaImage(source.url);
      if (!response.ok) {
        const mapped = mapHaError(response.status);
        lastFailure = { ...mapped, sourceUsed: source.type };
        if (source.type === "eventImage" && [401, 403, 404, 408].includes(response.status)) continue;
        if (!shouldRetryStatus(response.status) && response.status !== 404) break;
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "image/jpeg";
      return { buffer, contentType, sourceUsed: source.type };
    } catch (err) {
      const mapped = mapHaError(err?.status, err);
      lastFailure = { ...mapped, sourceUsed: source.type };
      if (source.type === "eventImage" && ["auth", "timeout", "network"].includes(mapped.code)) continue;
      if (mapped.code === "auth") break;
    }
  }
  throw Object.assign(
    new Error(lastFailure?.message || "Camera snapshot failed"),
    lastFailure || {}
  );
}

async function proxyFetchToResponse(upstream, res, options = {}) {
  res.status(upstream.status);
  const contentType = upstream.headers.get("content-type");
  if (contentType) res.set("Content-Type", contentType);
  if (options.cacheControl) res.set("Cache-Control", options.cacheControl);
  if (!upstream.ok) { res.send(await upstream.text()); return; }
  if (!upstream.body) { res.send(Buffer.from(await upstream.arrayBuffer())); return; }
  const stream = Readable.fromWeb(upstream.body);
  await pipeline(stream, res);
}

function setNoCacheHeaders(res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

// --- Routes ---

router.get("/api/cameras", (_req, res) => {
  const cameras = CAMERA_CONFIG.map((camera) => ({
    id: camera.id,
    name: camera.name,
    entity: camera.entity,
    cameraEntity: camera.cameraEntity,
    eventImageEntity: camera.eventImageEntity,
    eventImagePath: camera.eventImagePath,
    preferredSnapshot: camera.preferredSnapshot,
    snapshotRefreshMs: camera.snapshotRefreshMs,
    mode: camera.mode,
    streamType: camera.streamType,
    streamFallbacks: camera.streamFallbacks ?? [],
    snapshotUrl: `/api/camera/${camera.id}/snapshot`,
    streamUrl: `/api/camera/${camera.id}/stream`
  }));
  res.json({ cameras });
});

router.get("/api/camera/:id/snapshot", async (req, res) => {
  const camera = getCameraConfig(req.params.id);
  if (!camera) { res.status(404).json({ error: "Camera not found" }); return; }
  if (!process.env.HA_TOKEN) { res.status(500).json({ error: "Home Assistant token missing" }); return; }

  const cameraId = camera.id;
  const now = Date.now();
  try {
    const snapshot = await fetchCameraSnapshot(camera);
    snapshotCache.set(cameraId, {
      buffer: snapshot.buffer,
      contentType: snapshot.contentType,
      ts: now
    });
    setCameraStatus(cameraId, {
      ok: true,
      sourceUsed: snapshot.sourceUsed,
      lastSuccessTs: now,
      lastErrorTs: null,
      lastErrorCode: null,
      lastErrorMsg: null
    });
    setNoCacheHeaders(res);
    res.type(snapshot.contentType).send(snapshot.buffer);
  } catch (err) {
    const errorInfo = err?.code
      ? { status: err?.status || 500, code: err.code, message: err.message }
      : mapHaError(err?.status, err);
    const statusCode = errorInfo.status || 502;
    const cached = snapshotCache.get(cameraId);
    const canServeStale = cached && cached.ts && now - cached.ts <= SNAPSHOT_STALE_WINDOW_MS;

    setCameraStatus(cameraId, {
      ok: false,
      sourceUsed: err?.sourceUsed || null,
      lastErrorTs: now,
      lastErrorCode: errorInfo.code,
      lastErrorMsg: errorInfo.message
    });

    if (canServeStale) {
      setNoCacheHeaders(res);
      res.set("X-Dashboard-Stale", "1");
      res.type(cached.contentType).send(cached.buffer);
      return;
    }

    console.error("Camera snapshot proxy error:", err);
    setNoCacheHeaders(res);
    res.status(statusCode).json({
      error: errorInfo.message || "Camera snapshot error",
      code: errorInfo.code || "snapshot_failed"
    });
  }
});

router.get("/api/camera/:id/status", (req, res) => {
  const camera = getCameraConfig(req.params.id);
  if (!camera) { res.status(404).json({ error: "Camera not found" }); return; }
  res.json(getCameraStatus(camera.id));
});

router.get("/api/camera/:id/stream", async (req, res) => {
  const camera = getCameraConfig(req.params.id);
  if (!camera) { res.status(404).json({ error: "Camera not found" }); return; }

  const upstreamUrl = req.query.url || resolveStreamUrl(camera, req.query.type);
  if (!upstreamUrl) { res.status(500).json({ error: "Stream source not configured" }); return; }

  if (req.query.url) {
    const go2rtcBase = normalizeBaseUrl(process.env.GO2RTC_HOST);
    const allowedHost = go2rtcBase ? new URL(go2rtcBase).host : null;
    if (!isAllowedUpstreamUrl(upstreamUrl, allowedHost)) {
      res.status(400).json({ error: "Disallowed stream host" });
      return;
    }
  }

  try {
    const upstream = await fetchWithTimeout(upstreamUrl);
    const contentType = upstream.headers.get("content-type") || "";
    const isHls =
      contentType.includes("application/vnd.apple.mpegurl") ||
      contentType.includes("application/x-mpegURL") ||
      upstreamUrl.toString().includes(".m3u8");

    if (upstream.ok && isHls) {
      const playlist = await upstream.text();
      res.set("Content-Type", contentType);
      res.set("Cache-Control", "no-store");
      res.send(rewriteHlsPlaylist(playlist, camera.id, upstreamUrl));
      return;
    }

    res.set("Cache-Control", "no-store");
    await proxyFetchToResponse(upstream, res);
  } catch (err) {
    console.error("Camera stream proxy error:", err);
    res.status(500).json({ error: "Camera stream error" });
  }
});

export default router;
