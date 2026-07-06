import express from "express";
import os from "os";
import { readFile } from "fs/promises";
import { fetchWithTimeout } from "../utils/fetch.js";
import { getHealth } from "../services/healthService.js";
import { getRecoveryLog } from "../services/recoveryService.js";

const router = express.Router();

async function readPiTemperature() {
  try {
    const raw = await readFile("/sys/class/thermal/thermal_zone0/temp", "utf8");
    const value = Number.parseFloat(raw.trim());
    if (Number.isNaN(value)) return null;
    return value / 1000;
  } catch {
    return null;
  }
}

function normalizePingTarget(target) {
  if (!target) return "https://1.1.1.1";
  if (/^https?:\/\//i.test(target)) return target;
  return `https://${target}`;
}

router.get("/env.js", (_req, res) => {
  const bomDailyConfig = {
    5: {
      sourceEntityId: process.env.BOM_D5_ENTITY_ID || "",
      rainChance: process.env.BOM_RAIN_CHANCE_5 || "",
      rainRange: process.env.BOM_RAIN_RANGE_5 || "",
      uvCategory: process.env.BOM_UV_CATEGORY_5 || "",
      uvMaxIndex: process.env.BOM_UV_MAX_5 || ""
    },
    6: {
      sourceEntityId: process.env.BOM_D6_ENTITY_ID || "",
      rainChance: process.env.BOM_RAIN_CHANCE_6 || "",
      rainRange: process.env.BOM_RAIN_RANGE_6 || "",
      uvCategory: process.env.BOM_UV_CATEGORY_6 || "",
      uvMaxIndex: process.env.BOM_UV_MAX_6 || ""
    },
    7: {
      sourceEntityId: process.env.BOM_D7_ENTITY_ID || "",
      rainChance: process.env.BOM_RAIN_CHANCE_7 || "",
      rainRange: process.env.BOM_RAIN_RANGE_7 || "",
      uvCategory: process.env.BOM_UV_CATEGORY_7 || "",
      uvMaxIndex: process.env.BOM_UV_MAX_7 || ""
    }
  };

  const publicEnv = {
    HA_HOST: process.env.HA_HOST || "",
    GO2RTC_HOST: process.env.GO2RTC_HOST || "",
    HA_DEBUG: process.env.HA_DEBUG === "1" ? "1" : "",
    CALENDAR_DEBUG: process.env.CALENDAR_DEBUG === "1" ? "1" : "",
    WEATHER_DEBUG_BOM: process.env.WEATHER_DEBUG_BOM === "1" ? "1" : "",
    HOME_BASE: process.env.HOME_BASE || ""
  };

  res.type("application/javascript");
  res.send(
    `window.__ENV__ = ${JSON.stringify(publicEnv)};` +
    `window.__DASH_CONFIG__ = ${JSON.stringify({
      homeAssistant: {
        enabled: true,
        url: "",
        debug: publicEnv.HA_DEBUG === "1"
      },
      calendar: {
        debug: publicEnv.CALENDAR_DEBUG === "1"
      },
      weather: {
        bom: {
          locationName: process.env.BOM_LOCATION_NAME || "",
          warningsEntityId: process.env.BOM_WARNINGS_ENTITY_ID || "",
          hourlyEntityId: process.env.BOM_HOURLY_ENTITY_ID || "",
          daily: bomDailyConfig
        }
      }
    })};`
  );
});

router.get("/api/config", (_req, res) => {
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

router.get("/api/system/ping", async (_req, res) => {
  const target = normalizePingTarget(process.env.STATUS_PING_TARGET || "https://1.1.1.1");
  const start = Date.now();
  try {
    const response = await fetchWithTimeout(target, { method: "HEAD" }, 5000);
    res.json({ ok: response.ok, status: response.status, latencyMs: Date.now() - start, target });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : "Ping failed",
      latencyMs: Date.now() - start,
      target
    });
  }
});

router.get("/api/system/health", (_req, res) => {
  res.json({ ...getHealth(), recoveries: getRecoveryLog() });
});

router.get("/api/system/metrics", async (_req, res) => {
  const cpuCount = os.cpus()?.length || 1;
  const load = os.loadavg?.()[0] ?? 0;
  const cpuLoadPercent = Math.round((load / cpuCount) * 100);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const tempC = await readPiTemperature();
  res.json({
    cpuLoadPercent,
    cpuCount,
    memory: { total: totalMem, free: freeMem, used: totalMem - freeMem },
    uptimeSeconds: os.uptime(),
    tempC,
    hostname: os.hostname()
  });
});

export default router;
