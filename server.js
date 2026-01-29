console.log(">>> DASHBOARD SERVER LOADED <<<");

import dotenv from "dotenv";
import express from "express";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import serveIndex from "serve-index";
import { CAMERA_CONFIG } from "./config/cameras.js";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const HA_HOST = process.env.HA_HOST;
const GO2RTC_HOST = process.env.GO2RTC_HOST;
const HOME_ASSISTANT_TOKEN = process.env.HA_TOKEN;

const CAMERA_MAP = new Map(CAMERA_CONFIG.map((camera) => [camera.id, camera]));

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================================
   STATIC FILES
============================================================================ */

app.use(express.static(path.join(__dirname, "static")));
app.use("/photos", serveIndex(path.join(__dirname, "static", "photos"), { icons: true }));
app.use("/photos", express.static(path.join(__dirname, "static", "photos")));
app.use("/icons", express.static(path.join(__dirname, "static", "icons")));

/* ============================================================================
   ROOT → index.html
============================================================================ */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

/* ============================================================================
   CALENDAR PROXY — MERGED FEED (STRICT MATCH)
============================================================================ */

app.get("/api/calendar/all", async (req, res) => {
  try {
    const CAL_SVC = process.env.CALENDAR_SERVICE_URL || "http://localhost:5000";
    const r = await fetchWithTimeout(`${CAL_SVC}/calendar/all`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("Calendar ALL proxy error:", err);
    res.status(500).json({ error: "Calendar all error" });
  }
});

/* ============================================================================
   CALENDAR PROXY — INDIVIDUAL SOURCES (REGEX-PROTECTED)
============================================================================ */

const CALENDAR_ENDPOINTS = {
  google: "http://localhost:5000/calendar/google",
  apple: "http://localhost:5000/calendar/apple",
  tripit: "http://localhost:5000/calendar/tripit"
};

// IMPORTANT: prevent ":source" from matching "all"
app.get("/api/calendar/:source(google|apple|tripit)", async (req, res) => {
  const src = req.params.source;
  const url = CALENDAR_ENDPOINTS[src];

  try {
    const r = await fetchWithTimeout(url);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("Calendar proxy error:", err);
    res.status(500).json({ error: "Calendar error" });
  }
});

/* ============================================================================
   COMMUTE PROXY
============================================================================ */

app.get("/api/commute", async (req, res) => {
  const origin = req.query.origin;
  const destination = req.query.destination;
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    res.status(500).json({ error: "Google Maps API key missing" });
    return;
  }

  if (!origin || !destination) {
    res.status(400).json({ error: "origin and destination are required" });
    return;
  }

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("departure_time", "now");
  url.searchParams.set("traffic_model", "best_guess");
  url.searchParams.set("key", googleMapsApiKey);

  try {
    const r = await fetchWithTimeout(url.toString());
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("Commute proxy error:", err);
    res.status(500).json({ error: "Commute error" });
  }
});

app.get("/api/commute_map", async (req, res) => {
  const origin = req.query.origin;
  const destination = req.query.destination;
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    res.status(500).json({ error: "Google Maps API key missing" });
    return;
  }

  if (!origin || !destination) {
    res.status(400).json({ error: "origin and destination are required" });
    return;
  }

  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("size", "600x300");
  url.searchParams.set("scale", "2");
  url.searchParams.set("maptype", "roadmap");
  url.searchParams.append("markers", `color:green|label:S|${origin}`);
  url.searchParams.append("markers", `color:red|label:D|${destination}`);
  url.searchParams.append(
    "path",
    `color:0x1a73e8|weight:5|${origin}|${destination}`
  );
  url.searchParams.set("key", googleMapsApiKey);

  try {
    const r = await fetchWithTimeout(url.toString());
    const buffer = await r.arrayBuffer();
    const contentType = r.headers.get("content-type") || "image/png";
    res.type(contentType).send(Buffer.from(buffer));
  } catch (err) {
    console.error("Commute map proxy error:", err);
    res.status(500).json({ error: "Commute map error" });
  }
});

/* ============================================================================
   PLEX SESSIONS PROXY
============================================================================ */

function normalizePlexBaseUrl(baseUrl) {
  if (!baseUrl) return baseUrl;
  const trimmed = baseUrl.trim().replace(/[<>]/g, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function getPlexAgent(baseUrl) {
  const allowInsecure = process.env.PLEX_ALLOW_INSECURE === "true";
  if (!allowInsecure) return undefined;
  if (!baseUrl?.startsWith("https://")) return undefined;
  return new https.Agent({ rejectUnauthorized: false });
}

function buildPlexUrl(baseUrl, pathValue) {
  if (!pathValue) return null;
  if (pathValue.startsWith("http")) return pathValue;
  const normalizedBase = normalizePlexBaseUrl(baseUrl);
  const trimmedBase = normalizedBase?.replace(/\/$/, "");
  const normalizedPath = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
  return `${trimmedBase}${normalizedPath}`;
}

function parsePlexSessions(xmlText) {
  const sessions = [];
  const mediaTags = xmlText.match(/<(Video|Track|Photo)\b[^>]*>/g) || [];

  for (const tag of mediaTags) {
    const attributes = {};
    for (const [, key, value] of tag.matchAll(/(\w+)="([^"]*)"/g)) {
      attributes[key] = value;
    }

    const title =
      attributes.title ||
      attributes.grandparentTitle ||
      attributes.parentTitle ||
      "Plex Stream";

    const thumbPath =
      attributes.thumb ||
      attributes.parentThumb ||
      attributes.grandparentThumb ||
      attributes.art;

    if (!thumbPath) continue;

    sessions.push({
      title,
      grandparentTitle: attributes.grandparentTitle || null,
      parentTitle: attributes.parentTitle || null,
      type: attributes.type,
      thumb: attributes.thumb || null,
      parentThumb: attributes.parentThumb || null,
      grandparentThumb: attributes.grandparentThumb || null,
      art: attributes.art || null,
      sessionKey: attributes.sessionKey
    });
  }

  return sessions;
}

app.get("/api/plex/sessions", async (req, res) => {
  const plexBaseUrl = normalizePlexBaseUrl(process.env.PLEX_BASE_URL);
  const plexToken = process.env.PLEX_TOKEN;

  if (!plexBaseUrl || !plexToken) {
    res.json({ sessions: [], configMissing: true });
    return;
  }

  try {
    const url = new URL("/status/sessions", plexBaseUrl);
    url.searchParams.set("X-Plex-Token", plexToken);
    const agent = getPlexAgent(plexBaseUrl);

    const plexResponse = await fetchWithTimeout(url.toString(), { agent });
    if (!plexResponse.ok) {
      const errorBody = await plexResponse.text();
      res
        .status(plexResponse.status)
        .json({
          error: `Plex HTTP ${plexResponse.status}`,
          detail: errorBody || null
        });
      return;
    }

    const xmlText = await plexResponse.text();
    const sessions = parsePlexSessions(xmlText);
    res.json({ sessions });
  } catch (err) {
    console.error("Plex proxy error:", err);
    res
      .status(500)
      .json({ error: "Plex error", detail: err instanceof Error ? err.message : err });
  }
});

app.get("/api/plex/image", async (req, res) => {
  const plexBaseUrl = normalizePlexBaseUrl(process.env.PLEX_BASE_URL);
  const plexToken = process.env.PLEX_TOKEN;
  const imagePath = req.query.path;

  if (!plexBaseUrl || !plexToken || !imagePath) {
    res.status(400).json({ error: "Missing Plex configuration" });
    return;
  }

  try {
    const builtUrl = buildPlexUrl(plexBaseUrl, imagePath);
    if (!builtUrl) {
      res.status(400).json({ error: "Invalid Plex image path" });
      return;
    }
    const url = new URL(builtUrl);
    const plexHost = new URL(plexBaseUrl).host;
    if (url.host !== plexHost) {
      res.status(400).json({ error: "Disallowed Plex image host" });
      return;
    }
    url.searchParams.set("X-Plex-Token", plexToken);
    const agent = getPlexAgent(plexBaseUrl);

    const imageResponse = await fetchWithTimeout(url.toString(), { agent });
    if (!imageResponse.ok) {
      res
        .status(imageResponse.status)
        .json({ error: `Plex image HTTP ${imageResponse.status}` });
      return;
    }

    const buffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    res.type(contentType).send(Buffer.from(buffer));
  } catch (err) {
    console.error("Plex image proxy error:", err);
    res.status(500).json({
      error: "Plex image error",
      detail: err instanceof Error ? err.message : err
    });
  }
});

/* ============================================================================
   CAMERA PROXIES (HOME ASSISTANT + GO2RTC)
============================================================================ */

function normalizeBaseUrl(url) {
  if (!url) return null;
  const trimmed = url.trim().replace(/[<>]/g, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `http://${trimmed.replace(/\/$/, "")}`;
}

function resolveAbsoluteUrl(pathValue, baseUrl) {
  if (!pathValue) return null;
  if (/^https?:\/\//i.test(pathValue)) return pathValue;
  if (!baseUrl) return null;
  return new URL(pathValue, baseUrl).toString();
}

function getCameraConfig(id) {
  return CAMERA_MAP.get(id);
}

function buildGo2RtcUrl(pathValue) {
  const base = normalizeBaseUrl(GO2RTC_HOST);
  return resolveAbsoluteUrl(pathValue, base);
}

function buildHaUrl(pathValue) {
  const base = normalizeBaseUrl(HA_HOST);
  return resolveAbsoluteUrl(pathValue, base);
}

function resolveSnapshotUrl(camera) {
  if (camera.snapshotPath) return buildHaUrl(camera.snapshotPath);
  if (camera.entity) return buildHaUrl(`/api/camera_proxy/${camera.entity}`);
  return null;
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
  } catch (err) {
    return false;
  }
}

function rewriteHlsPlaylist(playlist, cameraId, upstreamUrl) {
  const lines = playlist.split("\n");
  const baseUrl = new URL(upstreamUrl);
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const absolute = new URL(trimmed, baseUrl).toString();
    const proxied = `/api/camera/${cameraId}/stream?url=${encodeURIComponent(absolute)}`;
    return proxied;
  });
  return rewritten.join("\n");
}

async function proxyFetchToResponse(upstream, res, options = {}) {
  res.status(upstream.status);
  const contentType = upstream.headers.get("content-type");
  if (contentType) res.set("Content-Type", contentType);
  if (options.cacheControl) res.set("Cache-Control", options.cacheControl);

  if (!upstream.ok) {
    const errorBody = await upstream.text();
    res.send(errorBody);
    return;
  }

  if (!upstream.body) {
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
    return;
  }

  const stream = Readable.fromWeb(upstream.body);
  await pipeline(stream, res);
}

app.get("/api/cameras", (req, res) => {
  const cameras = CAMERA_CONFIG.map((camera) => ({
    id: camera.id,
    name: camera.name,
    entity: camera.entity,
    mode: camera.mode,
    streamType: camera.streamType,
    streamFallbacks: camera.streamFallbacks ?? [],
    snapshotUrl: `/api/camera/${camera.id}/snapshot`,
    streamUrl: `/api/camera/${camera.id}/stream`
  }));
  res.json({ cameras });
});

app.get("/api/camera/:id/snapshot", async (req, res) => {
  const camera = getCameraConfig(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const snapshotUrl = resolveSnapshotUrl(camera);
  if (!snapshotUrl) {
    res.status(500).json({ error: "Snapshot source not configured" });
    return;
  }

  try {
    const haBase = normalizeBaseUrl(HA_HOST);
    const needsAuth = haBase && snapshotUrl.startsWith(haBase);
    if (needsAuth && !HOME_ASSISTANT_TOKEN) {
      res.status(500).json({ error: "Home Assistant token missing" });
      return;
    }

    const upstream = await fetchWithTimeout(snapshotUrl, {
      headers: needsAuth
        ? {
            Authorization: `Bearer ${HOME_ASSISTANT_TOKEN}`
          }
        : undefined
    });
    res.set("Cache-Control", "no-store, max-age=0");
    await proxyFetchToResponse(upstream, res);
  } catch (err) {
    console.error("Camera snapshot proxy error:", err);
    res.status(500).json({ error: "Camera snapshot error" });
  }
});

app.get("/api/camera/:id/stream", async (req, res) => {
  const camera = getCameraConfig(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const upstreamUrl = req.query.url || resolveStreamUrl(camera, req.query.type);
  if (!upstreamUrl) {
    res.status(500).json({ error: "Stream source not configured" });
    return;
  }

  if (req.query.url) {
    const go2rtcBase = normalizeBaseUrl(GO2RTC_HOST);
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

/* ============================================================================
   START SERVER
============================================================================ */

app.listen(PORT, () => {
  console.log(`Dashboard listening on http://localhost:${PORT}`);
});
