import express from "express";
import { fetchWithTimeout } from "../utils/fetch.js";

const router = express.Router();

// Nudgee, QLD — matches src/js/config/config.js's WEATHER_LAT/WEATHER_LON.
// Only a fallback: WEATHER_LAT/WEATHER_LON in .env win (see the route below).
const DEFAULT_LAT = -27.3691;
const DEFAULT_LON = 153.0847;

const RADAR_ZOOM = 7; // RainViewer's max zoom level
const GRID_RADIUS = 1; // 1 -> 3x3 grid centered on the home tile
const FRAME_CACHE_MS = 5 * 60 * 1000;
const OVERLAY_CACHE_MS = 5 * 60 * 1000;
const BASEMAP_CACHE_MS = 24 * 60 * 60 * 1000;
const RAINVIEWER_COLOR_SCHEME = 2; // "Universal Blue" — readable on a dark dashboard
const RAINVIEWER_OPTIONS = "1_1"; // smoothed, show snow

let frameCache = null; // { path, host, frameTime, fetchedAt }

function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
  );
}

function buildTileGrid(lat, lon, z, radius) {
  const cx = lonToTileX(lon, z);
  const cy = latToTileY(lat, z);
  const tiles = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      tiles.push({ x: cx + dx, y: cy + dy });
    }
  }
  return tiles;
}

async function getLatestFrame() {
  if (frameCache && Date.now() - frameCache.fetchedAt < FRAME_CACHE_MS) {
    return frameCache;
  }
  const response = await fetchWithTimeout("https://api.rainviewer.com/public/weather-maps.json");
  if (!response.ok) throw new Error(`RainViewer HTTP ${response.status}`);
  const data = await response.json();
  const frames = data?.radar?.past || [];
  const latest = frames[frames.length - 1];
  if (!latest) throw new Error("RainViewer returned no radar frames");
  frameCache = {
    host: data.host,
    path: latest.path,
    frameTime: latest.time,
    fetchedAt: Date.now()
  };
  return frameCache;
}

async function proxyImage(res, url, cache, cacheKey, cacheMs) {
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < cacheMs) {
    res.set("Content-Type", cached.contentType);
    res.set("Cache-Control", "no-store");
    res.send(cached.buffer);
    return;
  }

  const response = await fetchWithTimeout(url, {}, 8000);
  if (!response.ok) {
    if (cached) {
      res.set("Content-Type", cached.contentType);
      res.set("Cache-Control", "no-store");
      res.send(cached.buffer);
      return;
    }
    res.status(502).json({ error: `Upstream tile fetch failed (${response.status})` });
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/png";
  cache.set(cacheKey, { buffer, contentType, ts: Date.now() });
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "no-store");
  res.send(buffer);
}

const basemapCache = new Map();
const overlayCache = new Map();

router.get("/api/weather/radar/meta", async (_req, res) => {
  const lat = Number(process.env.WEATHER_LAT) || DEFAULT_LAT;
  const lon = Number(process.env.WEATHER_LON) || DEFAULT_LON;
  try {
    const frame = await getLatestFrame();
    const tiles = buildTileGrid(lat, lon, RADAR_ZOOM, GRID_RADIUS);
    res.json({ z: RADAR_ZOOM, tiles, frameTime: frame.frameTime });
  } catch (error) {
    console.error("Radar meta error:", error.message);
    res.status(502).json({ error: "Radar metadata unavailable" });
  }
});

router.get("/api/weather/radar/basemap/:z/:x/:y", async (req, res) => {
  const { z, x, y } = req.params;
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  try {
    await proxyImage(res, url, basemapCache, `${z}/${x}/${y}`, BASEMAP_CACHE_MS);
  } catch (error) {
    console.error("Radar basemap tile error:", error.message);
    res.status(502).json({ error: "Basemap tile unavailable" });
  }
});

router.get("/api/weather/radar/overlay/:z/:x/:y", async (req, res) => {
  const { z, x, y } = req.params;
  try {
    const frame = await getLatestFrame();
    const url = `${frame.host}${frame.path}/256/${z}/${x}/${y}/${RAINVIEWER_COLOR_SCHEME}/${RAINVIEWER_OPTIONS}.png`;
    await proxyImage(res, url, overlayCache, `${z}/${x}/${y}`, OVERLAY_CACHE_MS);
  } catch (error) {
    console.error("Radar overlay tile error:", error.message);
    res.status(502).json({ error: "Radar overlay tile unavailable" });
  }
});

export default router;
