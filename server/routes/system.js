import express from "express";
import os from "os";
import { readFile, readdir } from "fs/promises";
import { fetchWithTimeout } from "../utils/fetch.js";
import { getHealth, getMotionCoverage } from "../services/healthService.js";
import { getRecoveryLog } from "../services/recoveryService.js";

const router = express.Router();

// CPU temperature, portable across hosts. The Pi reads
// /sys/class/thermal/thermal_zone0/temp; x86 exposes the CPU die under
// /sys/class/hwmon (k10temp on AMD/Ryzen, coretemp on Intel), where
// thermal_zone0 may be absent or a different sensor entirely. Both paths are
// tried so a rollback from the mini PC to the Pi keeps reporting.
const HWMON_ROOT = "/sys/class/hwmon";
const THERMAL_ZONE_FALLBACK = "/sys/class/thermal/thermal_zone0/temp";

// Ordered by how specifically each chip reports CPU die temperature.
const SENSOR_PREFERENCE = ["k10temp", "coretemp", "cpu_thermal", "acpitz"];

// Plausible CPU range in millidegrees. A fan-speed or voltage sensor latched by
// mistake reads far outside it, and would otherwise render as a confident wrong
// "0.0°C" rather than an honest "—".
const MIN_MILLIDEGREES = 20_000;
const MAX_MILLIDEGREES = 120_000;

let resolvedTempPath = null;

// Exported for the contract test — the ordering is the part worth pinning, and
// it tests without touching a filesystem (same pattern as isWithinOffWindow).
export function pickSensorPath(entries) {
  for (const name of SENSOR_PREFERENCE) {
    const hit = entries.find((entry) => entry.name === name);
    if (hit) return hit.path;
  }
  return null;
}

async function readMillidegrees(path) {
  try {
    const raw = await readFile(path, "utf8");
    const value = Number.parseFloat(raw.trim());
    if (!Number.isFinite(value)) return null;
    if (value < MIN_MILLIDEGREES || value > MAX_MILLIDEGREES) return null;
    return value;
  } catch {
    return null;
  }
}

async function discoverHwmonEntries() {
  try {
    const dirs = await readdir(HWMON_ROOT);
    const entries = [];
    for (const dir of dirs) {
      try {
        const name = (await readFile(`${HWMON_ROOT}/${dir}/name`, "utf8")).trim();
        entries.push({ name, path: `${HWMON_ROOT}/${dir}/temp1_input` });
      } catch {
        // A chip with no name or no temp1_input — not a CPU sensor.
      }
    }
    return entries;
  } catch {
    return [];
  }
}

// Read process.env INSIDE the function, never at module load: ES imports hoist
// above server.js's dotenv.config(), so a module-level read is frozen to its
// default and the documented knob is silently unsettable (the KOKORO_VOICE /
// TTS_CACHE_MAX_BYTES trap).
async function readCpuTemperature() {
  const override = process.env.CPU_TEMP_PATH;
  if (override) {
    const milli = await readMillidegrees(override);
    return milli === null ? null : milli / 1000;
  }

  if (resolvedTempPath) {
    const milli = await readMillidegrees(resolvedTempPath);
    if (milli !== null) return milli / 1000;
    resolvedTempPath = null; // sensor vanished — re-resolve rather than stick null
  }

  // thermal_zone0 stays last so the Pi's guaranteed path still wins if hwmon
  // enumeration surprises us.
  const candidates = [pickSensorPath(await discoverHwmonEntries()), THERMAL_ZONE_FALLBACK];

  for (const path of candidates) {
    if (!path) continue;
    const milli = await readMillidegrees(path);
    if (milli !== null) {
      resolvedTempPath = path;
      return milli / 1000;
    }
  }
  return null;
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
  // The per-camera table rides alongside the feeds so the divergence
  // thresholds can be tuned against real numbers rather than guessed at again.
  res.json({
    ...getHealth(),
    recoveries: getRecoveryLog(),
    motionCoverage: getMotionCoverage().cameras
  });
});

router.get("/api/system/metrics", async (_req, res) => {
  const cpuCount = os.cpus()?.length || 1;
  const load = os.loadavg?.()[0] ?? 0;
  const cpuLoadPercent = Math.round((load / cpuCount) * 100);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const tempC = await readCpuTemperature();
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
