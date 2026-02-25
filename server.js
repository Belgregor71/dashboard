console.log(">>> DASHBOARD SERVER LOADED <<<");

import "dotenv/config";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import https from "https";
import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import ical from "node-ical";
import { CAMERA_CONFIG } from "./config/cameras.js";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import os from "os";
import { compileSchema, validateBody, validateData } from "./server/middleware/validate.js";
import { aiBriefBodySchema, aiRouteBodySchema, aiRouteResultSchema } from "./server/schemas/ai.js";
import { haSnapshotSchema } from "./server/schemas/ha.js";
import { weatherForecastSchema, weatherNowSchema } from "./server/schemas/weather.js";
import { getHaSnapshot } from "./server/services/haService.js";
import {
  getWeatherNormalized,
  weatherFallbackForecast,
  weatherFallbackNow
} from "./server/services/weatherService.js";
import arrRoutes from "./server/routes/arr.js";
import { createHaRouter } from "./server/ha/haRoutes.js";
import { readHaConfig } from "./server/ha/haConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use("/api", arrRoutes);
const PORT = process.env.PORT || 3000;

const HA_HOST = process.env.HA_HOST;
const GO2RTC_HOST = process.env.GO2RTC_HOST;
const HOME_ASSISTANT_TOKEN = process.env.HA_TOKEN;
const CALENDAR_URLS = {
  google: process.env.CALENDAR_GOOGLE_URL,
  apple: process.env.CALENDAR_APPLE_URL,
  tripit: process.env.CALENDAR_TRIPIT_URL
};
const HOLIDAY_REGION_DEFAULT = "QLD";
const HOLIDAY_COUNTRY = "AU";
const HOLIDAY_CACHE_DIR = path.join(__dirname, "data", "holiday-cache");
const HOLIDAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const CAMERA_MAP = new Map(CAMERA_CONFIG.map((camera) => [camera.id, camera]));
const HA_TARGET = normalizeBaseUrl(HA_HOST);

const SNAPSHOT_TIMEOUT_MS = 6000;
const SNAPSHOT_RETRY_DELAY_MS = 300;
const SNAPSHOT_MAX_RETRIES = 1;
const SNAPSHOT_STALE_WINDOW_MS = 10 * 60 * 1000;
const snapshotCache = new Map();
const cameraStatusCache = new Map();

const haRouteLogger = (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    console.log(`[ha-api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`);
  });
  next();
};

try {
  readHaConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

app.use("/api/ha", haRouteLogger, createHaRouter());

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



const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const aiRouteCache = new Map();
const aiBriefCache = new Map();

// Compile schemas once at startup (Pi-friendly).
const validateAiRouteBody = compileSchema(aiRouteBodySchema);
const validateAiBriefBody = compileSchema(aiBriefBodySchema);
const validateAiRouteResult = compileSchema(aiRouteResultSchema);
const validateHaSnapshot = compileSchema(haSnapshotSchema);
const validateWeatherNow = compileSchema(weatherNowSchema);
const validateWeatherForecast = compileSchema(weatherForecastSchema);

function normalizeAiRouteBody(req, _res, next) {
  if (req.body?.input) return next();
  if (typeof req.body?.text === "string") {
    req.body = { input: { text: req.body.text } };
  }
  next();
}

function normalizeAiBriefBody(req, _res, next) {
  if (req.body?.input) return next();
  if (typeof req.body?.context === "object" && req.body.context) {
    req.body = { input: { context: req.body.context } };
  } else if (typeof req.body?.context === "string") {
    req.body = { input: { context: { mode: req.body.context } } };
  } else {
    req.body = { input: {} };
  }
  next();
}

function getCached(cache, key) {
  const item = cache.get(key);
  if (!item) return null;
  if (item.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCached(cache, key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function fallbackAiRoute() {
  return {
    intent: "unknown",
    confidence: 0,
    response: "Sorry, I didn’t get that."
  };
}

function coerceAiRoute(payload = {}) {
  const validIntents = new Set([
    "switch_view",
    "show_weather",
    "show_cameras",
    "show_calendar",
    "status_explain",
    "unknown"
  ]);
  const validViews = new Set(["home", "weather", "cameras", "calendar", "agenda", "status", "briefing"]);
  const intent = validIntents.has(payload.intent) ? payload.intent : "unknown";
  const view = validViews.has(payload.view) ? payload.view : undefined;
  const confidence = Number.isFinite(payload.confidence)
    ? Math.max(0, Math.min(1, payload.confidence))
    : 0;
  const response = typeof payload.response === "string" && payload.response.trim()
    ? payload.response.trim().slice(0, 180)
    : "Okay.";

  return view ? { intent, view, confidence, response } : { intent, confidence, response };
}

function parseModelJson(rawText) {
  const trimmed = rawText?.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function callGeminiJson({ prompt, schemaExample, timeoutMs = 10_000 }) {
  if (!GEMINI_API_KEY) {
    const err = new Error("AI not configured");
    err.status = 501;
    throw err;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${prompt}

Return strictly JSON only. Example: ${schemaExample}` }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    },
    timeoutMs
  );

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(`Gemini HTTP ${response.status}`);
    err.detail = errorText;
    throw err;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseModelJson(text);
}

function normalizePingTarget(target) {
  if (!target) return "https://1.1.1.1";
  if (/^https?:\/\//i.test(target)) return target;
  return `https://${target}`;
}

function attachHaProxy(appInstance) {
  const HA_PROXY_DEBUG = process.env.DEBUG_HA_PROXY === "1";
  const debugHaProxy = (...args) => {
    if (HA_PROXY_DEBUG) {
      console.log("[ha-proxy]", ...args);
    }
  };

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
    return;
  }

  const addAuthHeader = (proxyReq) => {
    if (HOME_ASSISTANT_TOKEN) {
      proxyReq.setHeader("Authorization", `Bearer ${HOME_ASSISTANT_TOKEN}`);
    }
  };

  const baseProxyOptions = {
    target: HA_TARGET,
    changeOrigin: true,
    ws: true,
    on: {
      proxyReq: addAuthHeader,
      error: (error, req) => {
        console.error("[ha-proxy] Proxy error", {
          route: req?.originalUrl || req?.url,
          code: error?.code,
          message: error?.message
        });
      }
    }
  };

  appInstance.use("/api/image_proxy", createProxyMiddleware(baseProxyOptions));
  appInstance.use("/api/camera_proxy", createProxyMiddleware(baseProxyOptions));

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

async function readHolidayFallback(region, year) {
  const fallbackPath = path.join(__dirname, "static", "data", `holidays_${String(region).toLowerCase()}_${year}.json`);
  try {
    const raw = await readFile(fallbackPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function normalizeHolidayRows(rows = [], region = HOLIDAY_REGION_DEFAULT) {
  return rows
    .map(row => {
      const date = row.date || row.start;
      const title = row.localName || row.name || row.title;
      if (!date || !title) return null;
      return {
        id: `holiday:${region}:${date}:${title}`,
        title,
        start: date,
        end: date,
        allDay: true,
        source: "holidays",
        location: "Queensland, AU"
      };
    })
    .filter(Boolean);
}

function isHolidayForRegion(row, region) {
  if (!row || !region) return false;
  if (row.global === true) return true;
  if (!Array.isArray(row.counties)) return false;
  return row.counties.includes(`AU-${region}`);
}

async function readHolidayCache(region, year) {
  try {
    const filePath = path.join(HOLIDAY_CACHE_DIR, `${String(region).toLowerCase()}_${year}.json`);
    const fileStats = await stat(filePath);
    if (Date.now() - fileStats.mtimeMs > HOLIDAY_CACHE_TTL_MS) return null;
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

async function writeHolidayCache(region, year, rows) {
  try {
    await mkdir(HOLIDAY_CACHE_DIR, { recursive: true });
    const filePath = path.join(HOLIDAY_CACHE_DIR, `${String(region).toLowerCase()}_${year}.json`);
    await writeFile(filePath, JSON.stringify(rows), "utf8");
  } catch (error) {
    console.warn("Unable to write holiday cache", error.message);
  }
}

async function fetchPublicHolidays(region, year) {
  const cached = await readHolidayCache(region, year);
  if (cached) return normalizeHolidayRows(cached, region);

  try {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${HOLIDAY_COUNTRY}`;
    const response = await fetchWithTimeout(url, {}, 6000);
    if (!response.ok) throw new Error(`holiday api ${response.status}`);
    const rows = await response.json();
    const filtered = Array.isArray(rows) ? rows.filter(row => isHolidayForRegion(row, region)) : [];
    await writeHolidayCache(region, year, filtered);
    return normalizeHolidayRows(filtered, region);
  } catch (error) {
    console.warn("Holiday API unavailable, using local fallback", error.message);
    const fallbackRows = await readHolidayFallback(region, year);
    return normalizeHolidayRows(fallbackRows, region);
  }
}

/* ============================================================================
   ENV CONFIG (INJECTED TO CLIENT)
============================================================================ */

app.get("/env.js", (req, res) => {
  const publicEnv = {
    HA_HOST: HA_HOST || "",
    GO2RTC_HOST: GO2RTC_HOST || "",
    HA_DEBUG: process.env.HA_DEBUG === "1" ? "1" : "",
    CALENDAR_DEBUG: process.env.CALENDAR_DEBUG === "1" ? "1" : "",
    HOME_BASE: process.env.HOME_BASE || ""
  };

  res.type("application/javascript");
  res.send(`window.__ENV__ = ${JSON.stringify(publicEnv)};window.__DASH_CONFIG__ = ${JSON.stringify({
    homeAssistant: {
      enabled: true,
      url: "",
      debug: publicEnv.HA_DEBUG === "1"
    },
    calendar: {
      debug: publicEnv.CALENDAR_DEBUG === "1"
    }
  })};`);
});

app.get("/api/config", (_req, res) => {
  res.json({
    homeAssistant: {
      enabled: true,
      url: "",
      debug: process.env.HA_DEBUG === "1"
    },
    calendar: {
      debug: process.env.CALENDAR_DEBUG === "1"
    }
  });
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

app.get("/api/ha/snapshot", async (req, res) => {
  if (!HA_TARGET || !HOME_ASSISTANT_TOKEN) {
    res.status(502).json({ ok: false, error: { code: "HA_UNAVAILABLE", message: "Home Assistant unavailable" } });
    return;
  }

  try {
    const snapshot = await getHaSnapshot({
      haHost: HA_TARGET,
      token: HOME_ASSISTANT_TOKEN,
      validateSnapshot: validateHaSnapshot
    });
    res.json(snapshot);
  } catch (error) {
    console.error("HA snapshot upstream error:", error?.message || error);
    res.status(502).json({ ok: false, error: { code: "HA_UNAVAILABLE", message: "Home Assistant unavailable" } });
  }
});

app.get("/api/weather/now", async (req, res) => {
  const lat = Number(process.env.WEATHER_LAT);
  const lon = Number(process.env.WEATHER_LON);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.json(weatherFallbackNow());
    return;
  }

  try {
    const { now } = await getWeatherNormalized({
      lat,
      lon,
      validateNow: validateWeatherNow,
      validateForecast: validateWeatherForecast
    });
    res.json(now);
  } catch (error) {
    console.error("Weather now upstream error:", error?.message || error);
    res.status(502).json(weatherFallbackNow());
  }
});

app.get("/api/weather/forecast", async (req, res) => {
  const lat = Number(process.env.WEATHER_LAT);
  const lon = Number(process.env.WEATHER_LON);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.json(weatherFallbackForecast());
    return;
  }

  try {
    const { forecast } = await getWeatherNormalized({
      lat,
      lon,
      validateNow: validateWeatherNow,
      validateForecast: validateWeatherForecast
    });
    res.json(forecast);
  } catch (error) {
    console.error("Weather forecast upstream error:", error?.message || error);
    res.status(502).json(weatherFallbackForecast());
  }
});

/* ============================================================================
   AI ROUTING + BRIEFING
============================================================================ */

app.post("/api/ai/route", normalizeAiRouteBody, validateBody(validateAiRouteBody), async (req, res) => {
  if (!GEMINI_API_KEY) {
    res.status(501).json({ error: "AI not configured" });
    return;
  }

  const text = req.body.input.text.trim();

  const cacheKey = text.toLowerCase();
  const cached = getCached(aiRouteCache, cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const prompt = [
      "You classify wall-dashboard commands.",
      "Valid intents: switch_view, show_weather, show_cameras, show_calendar, status_explain, unknown.",
      "If user asks for a specific view, set intent=switch_view and set view.",
      "Valid view values: home, weather, cameras, calendar, agenda, status, briefing.",
      `Input: ${text}`
    ].join("\n");

    const parsed = await callGeminiJson({
      prompt,
      schemaExample: JSON.stringify(fallbackAiRoute()),
      timeoutMs: 10_000
    });

    const payload = parsed ? coerceAiRoute(parsed) : fallbackAiRoute();
    const validated = validateData(validateAiRouteResult, payload);
    const safePayload = validated.ok ? payload : fallbackAiRoute();
    if (!validated.ok) console.error("AI route outbound validation failed:", validated.errors);
    setCached(aiRouteCache, cacheKey, safePayload, 30_000);
    res.json(safePayload);
  } catch (error) {
    console.error("AI route error:", error?.message || error, error?.detail || "");
    res.json(fallbackAiRoute());
  }
});

async function fetchInternalContext(endpointPath) {
  const baseUrl = `http://127.0.0.1:${PORT}`;
  try {
    const response = await fetchWithTimeout(`${baseUrl}${endpointPath}`, {}, 5_000);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`AI brief context error for ${endpointPath}:`, error?.message || error);
    return null;
  }
}

app.post("/api/ai/brief", normalizeAiBriefBody, validateBody(validateAiBriefBody), async (req, res) => {
  if (!GEMINI_API_KEY) {
    res.status(501).json({ error: "AI not configured" });
    return;
  }

  const mode = typeof req.body?.input?.context?.mode === "string" ? req.body.input.context.mode : "default";
  const cacheKey = mode.toLowerCase();
  const cached = getCached(aiBriefCache, cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const [calendar, metrics, ping, haHealth, cameras] = await Promise.all([
    fetchInternalContext("/api/calendar/all"),
    fetchInternalContext("/api/system/metrics"),
    fetchInternalContext("/api/system/ping"),
    fetchInternalContext("/api/ha/health"),
    fetchInternalContext("/api/cameras")
  ]);

  const contextPayload = {
    mode,
    generated_at: new Date().toISOString(),
    calendar_count: Array.isArray(calendar) ? calendar.length : null,
    next_events: Array.isArray(calendar) ? calendar.slice(0, 4) : [],
    metrics,
    ping,
    ha_health: haHealth,
    cameras
  };

  const fallback = {
    generated_at: new Date().toISOString(),
    headline: mode === "system" ? "System summary unavailable." : "Morning summary unavailable.",
    sections: {
      weather: "Weather data unavailable.",
      calendar: "Calendar data unavailable.",
      home: "Home status data unavailable.",
      tasks: "Task data unavailable."
    }
  };

  try {
    const prompt = [
      "You generate a concise wall-dashboard summary.",
      "Return JSON with fields: generated_at, headline, sections.weather, sections.calendar, sections.home, sections.tasks.",
      "Each section max 1 sentence.",
      `Context JSON: ${JSON.stringify(contextPayload).slice(0, 5000)}`
    ].join("\n");

    const parsed = await callGeminiJson({
      prompt,
      schemaExample: JSON.stringify(fallback),
      timeoutMs: 10_000
    });

    const payload = {
      generated_at: parsed?.generated_at || new Date().toISOString(),
      headline: typeof parsed?.headline === "string" ? parsed.headline : fallback.headline,
      sections: {
        weather: parsed?.sections?.weather || fallback.sections.weather,
        calendar: parsed?.sections?.calendar || fallback.sections.calendar,
        home: parsed?.sections?.home || fallback.sections.home,
        tasks: parsed?.sections?.tasks || fallback.sections.tasks
      }
    };

    setCached(aiBriefCache, cacheKey, payload, 5 * 60_000);
    res.json(payload);
  } catch (error) {
    console.error("AI brief error:", error?.message || error, error?.detail || "");
    res.json(fallback);
  }
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
   CALENDAR HOLIDAYS
============================================================================ */

app.get("/api/calendar/holidays", async (req, res) => {
  const region = String(req.query.region || HOLIDAY_REGION_DEFAULT).toUpperCase();
  const year = Number.parseInt(String(req.query.year || new Date().getFullYear()), 10);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    res.status(400).json({ error: "Invalid year" });
    return;
  }

  try {
    const holidays = await fetchPublicHolidays(region, year);
    res.json(holidays);
  } catch (error) {
    console.error("Holiday endpoint failed", error);
    res.json([]);
  }
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

function getCameraEntity(camera) {
  return camera?.cameraEntity || camera?.entity || null;
}

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
  const current = getCameraStatus(id);
  const next = { ...current, ...updates };
  cameraStatusCache.set(id, next);
  return next;
}

function buildGo2RtcUrl(pathValue) {
  const base = normalizeBaseUrl(GO2RTC_HOST);
  return resolveAbsoluteUrl(pathValue, base);
}

function buildHaUrl(pathValue) {
  const base = normalizeBaseUrl(HA_HOST);
  return resolveAbsoluteUrl(pathValue, base);
}

function resolveEventImageSource(camera) {
  if (camera.eventImagePath) {
    return {
      type: "eventImage",
      url: buildHaUrl(camera.eventImagePath)
    };
  }
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
  return {
    type: "legacySnapshot",
    url: buildHaUrl(camera.snapshotPath)
  };
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

  if (legacySource && !sources.some((source) => source.url === legacySource.url)) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  if (status === 404) {
    return { status, code: "missing_entity", message: "Camera entity not found" };
  }
  if (status >= 500) {
    return { status, code: "ha_error", message: "Home Assistant error" };
  }
  if (status === 408) {
    return { status: 504, code: "timeout", message: "Home Assistant timeout" };
  }
  if (error?.name === "AbortError") {
    return { status: 504, code: "timeout", message: "Home Assistant timeout" };
  }
  return { status: status || 502, code: "network", message: error?.message || "Home Assistant unreachable" };
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
  if (!HOME_ASSISTANT_TOKEN) {
    throw Object.assign(new Error("Home Assistant token missing"), { status: 500, code: "auth" });
  }

  const response = await fetchHaWithRetry(
    url,
    {
      headers: {
        Authorization: `Bearer ${HOME_ASSISTANT_TOKEN}`,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    },
    {
      timeoutMs,
      retries: SNAPSHOT_MAX_RETRIES,
      retryDelayMs: SNAPSHOT_RETRY_DELAY_MS
    }
  );
  return response;
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
        lastFailure = {
          ...mapped,
          sourceUsed: source.type
        };
        if ([401, 403].includes(response.status)) break;
        if (response.status === 404 && source.type === "eventImage") {
          continue;
        }
        if (!shouldRetryStatus(response.status) && response.status !== 404) {
          break;
        }
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "image/jpeg";
      return { buffer, contentType, sourceUsed: source.type };
    } catch (err) {
      const mapped = mapHaError(err?.status, err);
      lastFailure = {
        ...mapped,
        sourceUsed: source.type
      };
      if (mapped.code === "auth") break;
    }
  }

  throw Object.assign(new Error(lastFailure?.message || "Camera snapshot failed"), lastFailure || {});
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

app.get("/api/camera/:id/snapshot", async (req, res) => {
  const camera = getCameraConfig(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  if (!HOME_ASSISTANT_TOKEN) {
    res.status(500).json({ error: "Home Assistant token missing" });
    return;
  }

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

    res.set("Cache-Control", "no-store, max-age=0");
    res.type(snapshot.contentType).send(snapshot.buffer);
  } catch (err) {
    const errorInfo = err?.code
      ? {
          status: err?.status || 500,
          code: err.code,
          message: err.message
        }
      : mapHaError(err?.status, err);
    const statusCode = errorInfo.status || 502;
    const cached = snapshotCache.get(cameraId);
    const canServeStale =
      cached && cached.ts && now - cached.ts <= SNAPSHOT_STALE_WINDOW_MS;

    setCameraStatus(cameraId, {
      ok: false,
      sourceUsed: err?.sourceUsed || null,
      lastErrorTs: now,
      lastErrorCode: errorInfo.code,
      lastErrorMsg: errorInfo.message
    });

    if (canServeStale) {
      res.set("Cache-Control", "no-store, max-age=0");
      res.set("X-Dashboard-Stale", "1");
      res.type(cached.contentType).send(cached.buffer);
      return;
    }

    console.error("Camera snapshot proxy error:", err);
    res.status(statusCode).json({
      error: errorInfo.message || "Camera snapshot error",
      code: errorInfo.code || "snapshot_failed"
    });
  }
});

app.get("/api/camera/:id/status", (req, res) => {
  const camera = getCameraConfig(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  res.json(getCameraStatus(camera.id));
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
