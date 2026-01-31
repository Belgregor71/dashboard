import { fetchWeatherData } from "./api.js";
import {
  isDaytime,
  weatherText,
  weatherAnimation
} from "./mapper.js";
import {
  getBeaufortNumber,
  getWindBeaufortFilename,
  describeWindDirection
} from "../../config/weather-animations.js";
import { loadLottieAnimation } from "../../helpers/lottie.js";
import { on } from "../../core/eventBus.js";

let activeLotties = [];
let cachedDaily = null;
let cachedWeather = null;

function clearLotties() {
  activeLotties.forEach(anim => anim.destroy?.());
  activeLotties = [];
}

function getClosestHourIndex(hourly) {
  if (!hourly?.time?.length) return null;
  const now = new Date();
  let closestIndex = 0;
  let smallestDiff = Infinity;

  hourly.time.forEach((time, index) => {
    const diff = Math.abs(new Date(time).getTime() - now.getTime());
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function formatHourlyLabel(isoTime) {
  if (!isoTime) return "";
  return new Date(isoTime)
    .toLocaleTimeString("en-AU", { hour: "numeric" })
    .toUpperCase();
}

function getUvIcon(uvIndex) {
  if (uvIndex == null) return "uv-index.json";
  const rounded = Math.max(0, Math.min(11, Math.round(uvIndex)));
  if (rounded === 0) return "uv-index.json";
  return `uv-index-${rounded}.json`;
}

export async function startWeather() {
  try {
    clearLotties();
    const data = await fetchWeatherData();
    cachedWeather = data;
    cachedDaily = data?.daily || null;
    renderCurrent(data);
    renderWeekly(data.daily);
    renderHourly(data.hourly);
  } catch (e) {
    console.error("Weather render error:", e);
  }
}

function renderCurrent(data) {
  const current = data?.current_weather;
  const daily = data?.daily;
  const hourly = data?.hourly;
  const hourlyIndex = getClosestHourIndex(hourly);
  if (!current || !daily?.temperature_2m_max?.length || !daily?.temperature_2m_min?.length) {
    return;
  }

  const tempEl = document.getElementById("current-temp");
  const descEl = document.getElementById("current-conditions");
  const rangeEl = document.getElementById("weather-range");
  const windTextEl = document.getElementById("weather-wind-text");

  if (tempEl) tempEl.textContent = `${Math.round(current.temperature)}°`;
  if (descEl) descEl.textContent = weatherText(current.weathercode);

  const max = Math.round(daily.temperature_2m_max[0]);
  const min = Math.round(daily.temperature_2m_min[0]);
  if (rangeEl) rangeEl.textContent = `H ${max}°  L ${min}°`;

  if (windTextEl && current.windspeed != null) {
    const windKmh = current.windspeed;
    const windDirText = describeWindDirection(current.winddirection);
    windTextEl.textContent = windDirText
      ? `${Math.round(windKmh)} km/h ${windDirText}`
      : `${Math.round(windKmh)} km/h`;

    const beaufort = getBeaufortNumber(windKmh);
    const windIconFile = getWindBeaufortFilename(beaufort);
    const windAnim = loadLottieAnimation("weather-wind-icon", windIconFile);
    if (windAnim) activeLotties.push(windAnim);
  }

  const isDay = isDaytime(data);
  const animFile = weatherAnimation(current.weathercode, isDay);

  const anim = loadLottieAnimation("weather-lottie", animFile);
  if (anim) activeLotties.push(anim);

  const overlayAnim = loadLottieAnimation("weather-overlay-lottie", animFile);
  if (overlayAnim) activeLotties.push(overlayAnim);

  renderOverlay(data, hourlyIndex);
}

function renderWeekly(daily) {
  if (!daily?.weathercode) return;

  daily.weathercode.slice(0, 7).forEach((code, i) => {
    const file = weatherAnimation(code, true);
    const anim = loadLottieAnimation(`week-icon-${i}`, file);
    if (anim) activeLotties.push(anim);
  });
}

function renderOverlay(data, hourlyIndex) {
  const current = data.current_weather;
  const daily = data.daily;
  const hourly = data.hourly || {};

  const overlayTempEl = document.getElementById("weather-overlay-temp");
  const overlayConditionEl = document.getElementById("weather-overlay-condition");
  const overlayRangeEl = document.getElementById("weather-overlay-range");
  const overlayFeelsEl = document.getElementById("weather-overlay-feels");
  const overlayHumidityEl = document.getElementById("weather-overlay-humidity");
  const overlayPressureEl = document.getElementById("weather-overlay-pressure");
  const overlayRainEl = document.getElementById("weather-overlay-rain");
  const overlayWindEl = document.getElementById("weather-overlay-wind");
  const overlayUvEl = document.getElementById("weather-overlay-uv");
  const overlayVisibilityEl = document.getElementById("weather-overlay-visibility");
  const overlayDewEl = document.getElementById("weather-overlay-dew");
  const overlayCloudEl = document.getElementById("weather-overlay-cloud");

  if (overlayTempEl) overlayTempEl.textContent = `${Math.round(current.temperature)}°`;
  if (overlayConditionEl) overlayConditionEl.textContent = weatherText(current.weathercode);

  const max = Math.round(daily.temperature_2m_max[0]);
  const min = Math.round(daily.temperature_2m_min[0]);
  if (overlayRangeEl) overlayRangeEl.textContent = `H ${max}°  L ${min}°`;

  if (overlayFeelsEl) {
    const apparent = hourly?.apparent_temperature?.[hourlyIndex];
    overlayFeelsEl.textContent =
      apparent != null ? `Feels like ${Math.round(apparent)}°` : "";
  }

  const humidity = hourly?.relativehumidity_2m?.[hourlyIndex];
  if (overlayHumidityEl) {
    overlayHumidityEl.textContent = humidity != null ? `${Math.round(humidity)}%` : "--";
  }

  const pressure = hourly?.surface_pressure?.[hourlyIndex];
  if (overlayPressureEl) {
    overlayPressureEl.textContent =
      pressure != null ? `${Math.round(pressure)} hPa` : "--";
  }

  const rainChance = hourly?.precipitation_probability?.[hourlyIndex];
  if (overlayRainEl) {
    overlayRainEl.textContent = rainChance != null ? `${Math.round(rainChance)}%` : "--";
  }

  if (overlayWindEl && current.windspeed != null) {
    overlayWindEl.textContent = `${Math.round(current.windspeed)} km/h`;
  }

  const uvIndex = hourly?.uv_index?.[hourlyIndex];
  if (overlayUvEl) {
    overlayUvEl.textContent = uvIndex != null ? `${Math.round(uvIndex)}` : "--";
  }

  const visibility = hourly?.visibility?.[hourlyIndex];
  if (overlayVisibilityEl) {
    const visibilityKm = visibility != null ? visibility / 1000 : null;
    overlayVisibilityEl.textContent =
      visibilityKm != null ? `${visibilityKm.toFixed(1)} km` : "--";
  }

  const dewPoint = hourly?.dewpoint_2m?.[hourlyIndex];
  if (overlayDewEl) {
    overlayDewEl.textContent = dewPoint != null ? `${Math.round(dewPoint)}°` : "--";
  }

  const cloudCover = hourly?.cloudcover?.[hourlyIndex];
  if (overlayCloudEl) {
    overlayCloudEl.textContent = cloudCover != null ? `${Math.round(cloudCover)}%` : "--";
  }

  const humidityAnim = loadLottieAnimation("weather-overlay-humidity-icon", "humidity.json");
  if (humidityAnim) activeLotties.push(humidityAnim);

  const pressureAnim = loadLottieAnimation("weather-overlay-pressure-icon", "barometer.json");
  if (pressureAnim) activeLotties.push(pressureAnim);

  const rainAnim = loadLottieAnimation("weather-overlay-rain-icon", "raindrop.json");
  if (rainAnim) activeLotties.push(rainAnim);

  const uvIcon = loadLottieAnimation("weather-overlay-uv-icon", getUvIcon(uvIndex));
  if (uvIcon) activeLotties.push(uvIcon);

  const visibilityIcon = loadLottieAnimation("weather-overlay-visibility-icon", "mist.json");
  if (visibilityIcon) activeLotties.push(visibilityIcon);

  const dewIcon = loadLottieAnimation("weather-overlay-dew-icon", "thermometer-water.json");
  if (dewIcon) activeLotties.push(dewIcon);

  const cloudIcon = loadLottieAnimation("weather-overlay-cloud-icon", "cloudy.json");
  if (cloudIcon) activeLotties.push(cloudIcon);

  if (current.windspeed != null) {
    const windBeaufort = getBeaufortNumber(current.windspeed);
    const windIconFile = getWindBeaufortFilename(windBeaufort);
    const windAnim = loadLottieAnimation("weather-overlay-wind-icon", windIconFile);
    if (windAnim) activeLotties.push(windAnim);
  }
}

function renderHourly(hourly) {
  const grid = document.getElementById("weather-hourly-grid");
  if (!grid) return;

  if (!hourly?.time?.length) {
    grid.innerHTML = `<div class="weather-hourly__empty">Hourly data unavailable.</div>`;
    return;
  }

  const startIndex = getClosestHourIndex(hourly) ?? 0;
  grid.innerHTML = "";

  const cards = 8;
  for (let i = 0; i < cards; i++) {
    const dataIndex = startIndex + i;
    if (dataIndex >= hourly.time.length) break;

    const card = document.createElement("div");
    card.className = "weather-hourly__card";

    const time = document.createElement("div");
    time.className = "weather-hourly__time";
    time.textContent = formatHourlyLabel(hourly.time[dataIndex]);

    const icon = document.createElement("div");
    icon.className = "weather-hourly__icon";
    icon.id = `weather-hourly-icon-${i}`;

    const temp = document.createElement("div");
    temp.className = "weather-hourly__temp";
    const tempValue = hourly.temperature_2m?.[dataIndex];
    temp.textContent = tempValue != null ? `${Math.round(tempValue)}°` : "--";

    card.appendChild(time);
    card.appendChild(icon);
    card.appendChild(temp);
    grid.appendChild(card);

    const code = hourly.weathercode?.[dataIndex];
    if (code != null) {
      const file = weatherAnimation(code, true);
      const anim = loadLottieAnimation(icon.id, file);
      if (anim) activeLotties.push(anim);
    }
  }
}

function rerenderWeeklyFromCache() {
  if (!cachedDaily) return;
  renderWeekly(cachedDaily);
}

/* 🔁 Cleanup on view change (prevents memory leaks) */
on("view:changed", () => {
  clearLotties();
  if (cachedWeather) {
    renderCurrent(cachedWeather);
    renderWeekly(cachedWeather.daily);
    renderHourly(cachedWeather.hourly);
  }
});

on("calendar:weekRendered", () => {
  rerenderWeeklyFromCache();
});
