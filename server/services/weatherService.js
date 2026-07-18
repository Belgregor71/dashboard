import fetch from "node-fetch";
import { validateData } from "../middleware/validate.js";
import { reportFailure, reportSuccess } from "./healthService.js";

/** @typedef {import("../types/api.js").WeatherNowNormalized} WeatherNowNormalized */
/** @typedef {import("../types/api.js").WeatherForecastNormalized} WeatherForecastNormalized */

const REQUEST_TIMEOUT_MS = 6000;

// WMO weathercode → [label, category, intensity, thunder]. Full practical set —
// the old 10-entry map left common codes (53/55/63/65/80–82/96/99) labelled
// "Unavailable" and mislabelled 71 snow as storm. Intensity tiers drive the
// living-window effects (droplet/streak density); thunder marks the lightning
// lane. Non-precip codes carry intensity null.
const CODE_LABELS = new Map([
  [0, ["Clear", "clear", null, false]],
  [1, ["Mostly clear", "clear", null, false]],
  [2, ["Partly cloudy", "cloudy", null, false]],
  [3, ["Cloudy", "cloudy", null, false]],
  [45, ["Fog", "fog", null, false]],
  [48, ["Fog", "fog", null, false]],
  [51, ["Light drizzle", "rain", "light", false]],
  [53, ["Drizzle", "rain", "moderate", false]],
  [55, ["Heavy drizzle", "rain", "heavy", false]],
  [56, ["Freezing drizzle", "rain", "light", false]],
  [57, ["Freezing drizzle", "rain", "heavy", false]],
  [61, ["Light rain", "rain", "light", false]],
  [63, ["Rain", "rain", "moderate", false]],
  [65, ["Heavy rain", "rain", "heavy", false]],
  [66, ["Freezing rain", "rain", "light", false]],
  [67, ["Freezing rain", "rain", "heavy", false]],
  [71, ["Light snow", "snow", "light", false]],
  [73, ["Snow", "snow", "moderate", false]],
  [75, ["Heavy snow", "snow", "heavy", false]],
  [77, ["Snow grains", "snow", "light", false]],
  [80, ["Light showers", "rain", "light", false]],
  [81, ["Showers", "rain", "moderate", false]],
  [82, ["Heavy showers", "rain", "heavy", false]],
  [85, ["Snow showers", "snow", "light", false]],
  [86, ["Snow showers", "snow", "heavy", false]],
  [95, ["Thunderstorm", "storm", "moderate", true]],
  [96, ["Thunderstorm with hail", "storm", "heavy", true]],
  [99, ["Thunderstorm with heavy hail", "storm", "heavy", true]]
]);

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWeatherRaw({ lat, lon }) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current_weather", "true");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weathercode,sunrise,sunset,precipitation_probability_max");
  url.searchParams.set("hourly", "apparent_temperature,relativehumidity_2m,precipitation_probability,uv_index,windspeed_10m");
  // Short-range nowcast (Phase 3): 15-min precip for the next ~3h. Ignored by
  // the now/forecast normalizers; read only by normalizeNowcast.
  url.searchParams.set("minutely_15", "precipitation,precipitation_probability");
  url.searchParams.set("forecast_minutely_15", "12");
  url.searchParams.set("timezone", "auto");

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    const error = new Error(`Weather fetch failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function conditionFor(code) {
  const [label, icon, intensity, thunder] = CODE_LABELS.get(code) || ["Unavailable", null, null, false];
  return { code: Number.isFinite(code) ? code : null, label, icon, intensity, thunder };
}

/** @returns {WeatherNowNormalized} */
export function normalizeWeatherNow(raw) {
  const current = raw?.current_weather || {};
  const daily = raw?.daily || {};
  // current_weather.time has 15-min resolution ("…T17:45") but hourly.time
  // is on the hour — truncate to the hour or indexOf misses 3 times out of 4.
  const currentHour = typeof current.time === "string"
    ? current.time.replace(/T(\d{2}):\d{2}/, "T$1:00")
    : current.time;
  const timeIndex = Array.isArray(raw?.hourly?.time)
    ? raw.hourly.time.indexOf(currentHour)
    : -1;

  return {
    location: {
      name: raw?.timezone || "Local",
      tz: raw?.timezone || "UTC"
    },
    now: {
      temp_c: current?.temperature ?? null,
      feels_like_c: timeIndex >= 0 ? raw?.hourly?.apparent_temperature?.[timeIndex] ?? null : null,
      condition: conditionFor(current?.weathercode),
      wind_kph: current?.windspeed ?? null,
      humidity_pct: timeIndex >= 0 ? raw?.hourly?.relativehumidity_2m?.[timeIndex] ?? null : null,
      uv: timeIndex >= 0 ? raw?.hourly?.uv_index?.[timeIndex] ?? null : null,
      rain_chance_pct: timeIndex >= 0 ? raw?.hourly?.precipitation_probability?.[timeIndex] ?? null : null
    },
    day: {
      high_c: daily?.temperature_2m_max?.[0] ?? null,
      low_c: daily?.temperature_2m_min?.[0] ?? null,
      sunrise: daily?.sunrise?.[0] ?? null,
      sunset: daily?.sunset?.[0] ?? null
    }
  };
}

/** @returns {WeatherForecastNormalized} */
export function normalizeWeatherForecast(raw) {
  const dates = raw?.daily?.time || [];
  return {
    days: dates.map((date, idx) => ({
      date,
      high_c: raw?.daily?.temperature_2m_max?.[idx] ?? null,
      low_c: raw?.daily?.temperature_2m_min?.[idx] ?? null,
      condition: conditionFor(raw?.daily?.weathercode?.[idx]),
      rain_chance_pct: raw?.daily?.precipitation_probability_max?.[idx] ?? null
    }))
  };
}

/**
 * Next precip window from Open-Meteo minutely_15, or null.
 * Shape: { startsInMin, probabilityPct, mm }. The first future 15-min block
 * within the horizon that carries a real precip forecast (≥ PRECIP_MM_FLOOR mm).
 * Time is anchored to current_weather.time so the diff is TZ-consistent with
 * the block timestamps (both are local, naive ISO from the same response).
 */
export function normalizeNowcast(raw) {
  const minutely = raw?.minutely_15 || {};
  const times = minutely.time;
  const precip = minutely.precipitation;
  const probs = minutely.precipitation_probability;
  if (!Array.isArray(times) || !Array.isArray(precip)) return null;

  const HORIZON_MIN = 120;
  const PRECIP_MM_FLOOR = 0.1;

  const anchorStr = raw?.current_weather?.time;
  const anchor = typeof anchorStr === "string" ? new Date(anchorStr).getTime() : Date.now();
  if (!Number.isFinite(anchor)) return null;

  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    if (!Number.isFinite(t)) continue;
    const startsInMin = Math.round((t - anchor) / 60_000);
    if (startsInMin <= 0) continue;        // current/past block
    if (startsInMin > HORIZON_MIN) break;  // past the nowcast horizon
    const mm = Number(precip[i]);
    if (!Number.isFinite(mm) || mm < PRECIP_MM_FLOOR) continue;
    const prob = Number(probs?.[i]);
    return {
      startsInMin,
      probabilityPct: Number.isFinite(prob) ? prob : null,
      mm: Math.round(mm * 10) / 10
    };
  }
  return null;
}

export function weatherFallbackNow() {
  return {
    location: { name: "Unavailable", tz: "UTC" },
    now: {
      temp_c: null,
      feels_like_c: null,
      condition: { code: null, label: "Unavailable", icon: null, intensity: null, thunder: false },
      wind_kph: null,
      humidity_pct: null,
      uv: null,
      rain_chance_pct: null
    },
    day: { high_c: null, low_c: null, sunrise: null, sunset: null }
  };
}

export function weatherFallbackForecast() {
  return { days: [] };
}

export async function getWeatherNormalized({ lat, lon, validateNow, validateForecast }) {
  try {
    const raw = await fetchWeatherRaw({ lat, lon });
    reportSuccess("weather");
    const now = normalizeWeatherNow(raw);
    const forecast = normalizeWeatherForecast(raw);

    const nowResult = validateData(validateNow, now);
    if (!nowResult.ok) {
      console.error("Weather now validation failed:", nowResult.errors);
      return { now: weatherFallbackNow(), forecast: weatherFallbackForecast() };
    }

    const forecastResult = validateData(validateForecast, forecast);
    if (!forecastResult.ok) {
      console.error("Weather forecast validation failed:", forecastResult.errors);
      return { now, forecast: weatherFallbackForecast() };
    }

    return { now, forecast };
  } catch (error) {
    reportFailure("weather", error?.message);
    error.code = "WEATHER_UNAVAILABLE";
    throw error;
  }
}
