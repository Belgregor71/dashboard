import fetch from "node-fetch";
import { validateData } from "../middleware/validate.js";

/** @typedef {import("../types/api.js").WeatherNowNormalized} WeatherNowNormalized */
/** @typedef {import("../types/api.js").WeatherForecastNormalized} WeatherForecastNormalized */

const REQUEST_TIMEOUT_MS = 6000;

const CODE_LABELS = new Map([
  [0, ["Clear", "clear"]],
  [1, ["Mostly clear", "clear"]],
  [2, ["Partly cloudy", "cloudy"]],
  [3, ["Cloudy", "cloudy"]],
  [45, ["Fog", "fog"]],
  [48, ["Fog", "fog"]],
  [51, ["Drizzle", "rain"]],
  [61, ["Rain", "rain"]],
  [71, ["Snow", "storm"]],
  [95, ["Thunderstorm", "storm"]]
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
  url.searchParams.set("timezone", "auto");

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    const error = new Error(`Weather fetch failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function conditionFor(code) {
  const [label, icon] = CODE_LABELS.get(code) || ["Unavailable", null];
  return { code: Number.isFinite(code) ? code : null, label, icon };
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

export function weatherFallbackNow() {
  return {
    location: { name: "Unavailable", tz: "UTC" },
    now: {
      temp_c: null,
      feels_like_c: null,
      condition: { code: null, label: "Unavailable", icon: null },
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
    error.code = "WEATHER_UNAVAILABLE";
    throw error;
  }
}
