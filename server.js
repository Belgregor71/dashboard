console.log(">>> DASHBOARD SERVER LOADED <<<");

import dotenv from "dotenv";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import https from "https";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import ical from "node-ical";
import { CAMERA_CONFIG } from "./config/cameras.js";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import os from "os";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const HA_HOST = process.env.HA_HOST;
const GO2RTC_HOST = process.env.GO2RTC_HOST;
const HOME_ASSISTANT_TOKEN = process.env.HA_TOKEN;
const CALENDAR_URLS = {
  google: process.env.CALENDAR_GOOGLE_URL,
  apple: process.env.CALENDAR_APPLE_URL,
  tripit: process.env.CALENDAR_TRIPIT_URL
};

const CAMERA_MAP = new Map(CAMERA_CONFIG.map((camera) => [camera.id, camera]));
const HA_TARGET = normalizeBaseUrl(HA_HOST);

attachHaProxy(app);

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizePingTarget(target) {
  if (!target) return "https://1.1.1.1";
  if (/^https?:\/\//i.test(target)) return target;
  return `https://${target}`;
}

function attachHaProxy(appInstance) {
  if (!HA_TARGET) {
    console.warn("HA_HOST is not configured; skipping Home Assistant proxy.");
    const missingHaHandler = (req, res) => {
      res.status(503).json({
        error: "Home Assistant proxy unavailable",
        detail:
          "Set HA_HOST (and HA_TOKEN if required) in the dashboard environment to enable /api/image_proxy and /api/camera_proxy."
      });
    };
    appInstance.use("/api/image_proxy", missingHaHandler);
    appInstance.use("/api/camera_proxy", missingHaHandler);
    appInstance.use("/api/websocket", missingHaHandler);
    return;
  }

  const addAuthHeader = (proxyReq) => {
    if (HOME_ASSISTANT_TOKEN) {
      proxyReq.setHeader("Authorization", `Bearer ${HOME_ASSISTANT_TOKEN}`);
    }
  };

  const proxyOptions = {
    target: HA_TARGET,
    changeOrigin: true,
    ws: true,
    onProxyReq: addAuthHeader,
    onProxyReqWs: addAuthHeader
  };

  appInstance.use("/api/image_proxy", createProxyMiddleware(proxyOptions));
  appInstance.use("/api/camera_proxy", createProxyMiddleware(proxyOptions));
  appInstance.use("/api/websocket", createProxyMiddleware(proxyOptions));
}

async function readPiTemperature() {
  try {
    const raw = await readFile("/sys/class/thermal/thermal_zone0/temp", "utf8");
    const value = Number.parseFloat(raw.trim());
    if (Number.isNaN(value)) return null;
    return value / 1000;
  } catch (err) {
    return null;
  }
}

function getRecurrenceWindow(referenceDate = new Date()) {
  const rangeStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  rangeStart.setDate(rangeStart.getDate() - 7);

  const rangeEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0);
  rangeEnd.setDate(rangeEnd.getDate() + 7);
  rangeEnd.setHours(23, 59, 59, 999);

  return { rangeStart, rangeEnd };
}

function isExcludedDate(date, ev) {
  if (!ev.exdate) return false;
  const time = date.getTime();
  return Object.values(ev.exdate).some((ex) => ex instanceof Date && ex.getTime() === time);
}

function getRecurrenceOverride(date, ev) {
  if (!ev.recurrences) return null;
  const iso = date.toISOString();
  if (ev.recurrences[iso]) return ev.recurrences[iso];
  const matchKey = Object.keys(ev.recurrences).find(
    (key) => new Date(key).getTime() === date.getTime()
  );
  return matchKey ? ev.recurrences[matchKey] : null;
}

function buildEvent(baseEvent, overrideEvent, start, end, sourceName) {
  const sourceEvent = overrideEvent || baseEvent;
  return {
    title: sourceEvent.summary || baseEvent.summary || "",
    start: start ? new Date(start).toISOString() : null,
    end: end ? new Date(end).toISOString() : null,
    location: sourceEvent.location || baseEvent.location || "",
    allDay: (sourceEvent.datetype || baseEvent.datetype) === "date",
    source: sourceName
  };
}

async function fetchCalendar(url, sourceName = "") {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      throw new Error(`Calendar fetch failed (${res.status}) for ${url}`);
    }
    const text = await res.text();
    const data = ical.parseICS(text);
    const events = [];

    const { rangeStart, rangeEnd } = getRecurrenceWindow();

    for (const key in data) {
      const ev = data[key];
      if (ev.type !== "VEVENT") continue;

      if (ev.rrule) {
        const durationMs =
          ev.end && ev.start ? ev.end.getTime() - ev.start.getTime() : 0;
        const occurrences = ev.rrule.between(rangeStart, rangeEnd, true);
        const added = new Set();

        for (const occurrence of occurrences) {
          if (isExcludedDate(occurrence, ev)) continue;
          const overrideEvent = getRecurrenceOverride(occurrence, ev);
          const start = overrideEvent?.start || occurrence;
          let end = overrideEvent?.end;
          if (!end && durationMs) {
            end = new Date(start.getTime() + durationMs);
          }

          const keyTime = start ? start.getTime() : occurrence.getTime();
          if (added.has(keyTime)) continue;
          added.add(keyTime);

          events.push(buildEvent(ev, overrideEvent, start, end, sourceName));
        }

        if (ev.recurrences) {
          for (const recurrence of Object.values(ev.recurrences)) {
            if (!recurrence?.start) continue;
            if (recurrence.start < rangeStart || recurrence.start > rangeEnd) continue;
            const keyTime = recurrence.start.getTime();
            if (added.has(keyTime)) continue;
            added.add(keyTime);
            events.push(buildEvent(ev, recurrence, recurrence.start, recurrence.end, sourceName));
          }
        }

        continue;
      }

      events.push(buildEvent(ev, null, ev.start, ev.end, sourceName));
    }

    return events;
  } catch (err) {
    console.error("Calendar fetch error:", err);
    return [];
  }
}

/* ============================================================================
   ENV CONFIG (INJECTED TO CLIENT)
============================================================================ */

app.get("/env.js", (req, res) => {
  res.type("application/javascript");
  res.send(`window.__ENV__ = ${JSON.stringify({
    HA_HOST: HA_HOST || "",
    HA_TOKEN: HOME_ASSISTANT_TOKEN || ""
  })};`);
});

/* ============================================================================
   STATIC FILES
============================================================================ */

app.use(express.static(path.join(__dirname, "static")));
app.use(
  "/assets",
  express.static(path.join(__dirname, "static", "assets"), {
    maxAge: "30d",
    immutable: true
  })
);
app.use("/photos", express.static(path.join(__dirname, "static", "photos")));
app.use("/icons", express.static(path.join(__dirname, "static", "icons")));

/* ============================================================================
   SYSTEM STATUS
============================================================================ */

app.get("/api/system/ping", async (req, res) => {
  const target = normalizePingTarget(process.env.STATUS_PING_TARGET || "https://1.1.1.1");
  const start = Date.now();

  try {
    const response = await fetchWithTimeout(
      target,
      { method: "HEAD" },
      5000
    );
    const latencyMs = Date.now() - start;
    res.json({
      ok: response.ok,
      status: response.status,
      latencyMs,
      target
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : "Ping failed",
      latencyMs,
      target
    });
  }
});

app.get("/api/system/metrics", async (req, res) => {
  const cpuCount = os.cpus()?.length || 1;
  const load = os.loadavg?.()[0] ?? 0;
  const cpuLoadPercent = Math.round((load / cpuCount) * 100);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const tempC = await readPiTemperature();

  res.json({
    cpuLoadPercent,
    cpuCount,
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem
    },
    uptimeSeconds: os.uptime(),
    tempC,
    hostname: os.hostname()
  });
});

/* ============================================================================
   PHOTOS LISTING
============================================================================ */

app.get("/api/photos", async (req, res) => {
  const photosDir = path.join(__dirname, "static", "photos");
  const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);

  try {
    const entries = await readdir(photosDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => imageExtensions.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));

    res.json(files);
  } catch (err) {
    if (err?.code === "ENOENT") {
      res.json([]);
      return;
    }
    console.error("Photo listing error:", err);
    res.status(500).json({ error: "Unable to list photos" });
  }
});

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
    if (process.env.CALENDAR_SERVICE_URL) {
      try {
        const data = await fetchCalendarService("calendar/all");
        res.json(data);
        return;
      } catch (err) {
        console.warn("Calendar service failed, falling back to direct URLs.", err);
      }
    }

    const urls = Object.entries(CALENDAR_URLS).filter(([, value]) => Boolean(value));
    if (urls.length === 0) {
      res.status(500).json({ error: "Calendar URLs missing" });
      return;
    }

    const results = await Promise.all(
      urls.map(async ([sourceName, url]) => {
        const events = await fetchCalendar(url, sourceName);
        return events;
      })
    );
    const merged = results.flat().filter((ev) => ev.start);
    merged.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    res.json(merged);
  } catch (err) {
    console.error("Calendar ALL proxy error:", err);
    res.status(500).json({ error: "Calendar all error" });
  }
});

/* ============================================================================
   CALENDAR PROXY — INDIVIDUAL SOURCES (REGEX-PROTECTED)
============================================================================ */

const CALENDAR_ENDPOINTS = {
  google: "calendar/google",
  apple: "calendar/apple",
  tripit: "calendar/tripit"
};

function buildCalendarServiceUrl(baseUrl, endpointPath) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = endpointPath.replace(/^\//, "");
  return new URL(normalizedPath, normalizedBase);
}

async function fetchCalendarService(endpointPath) {
  const CAL_SVC = process.env.CALENDAR_SERVICE_URL || "http://localhost:5000";
  const url = buildCalendarServiceUrl(CAL_SVC, endpointPath);
  const r = await fetchWithTimeout(url.toString());
  if (!r.ok) {
    throw new Error(`Calendar service returned ${r.status} for ${endpointPath}`);
  }
  const data = await r.json();
  if (!Array.isArray(data)) {
    throw new Error("Calendar service returned non-array payload");
  }
  return data;
}

// IMPORTANT: prevent ":source" from matching "all"
app.get("/api/calendar/:source(google|apple|tripit)", async (req, res) => {
  const src = req.params.source;
  const pathValue = CALENDAR_ENDPOINTS[src];
  const calendarUrl = CALENDAR_URLS[src];

  try {
    if (process.env.CALENDAR_SERVICE_URL) {
      try {
        const data = await fetchCalendarService(pathValue);
        res.json(data);
        return;
      } catch (err) {
        console.warn(
          `Calendar service failed for ${src}, falling back to direct URL.`,
          err
        );
      }
    }

    if (!calendarUrl) {
      res.status(500).json({ error: "Calendar URL missing" });
      return;
    }

    const events = await fetchCalendar(calendarUrl, src);
    res.json(events);
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
