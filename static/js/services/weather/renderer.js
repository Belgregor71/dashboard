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
import { emit, on } from "../../core/eventBus.js";
import { CONFIG } from "../../core/config.js";
import { startWeatherMotion, stopWeatherMotion } from "../../weatherMotion.js";
import { categoryForWeatherCode } from "../../weatherPrompts.js";
import { WEATHER_LAT, WEATHER_LON } from "../../config/config.js";
import { getTimes as getSunTimesFromCalc } from "../../vendor/suncalc.js";
import { clearWeatherFxOverlay, setWeatherFxOverlay } from "./fxOverlay.js";
import { getAllEntities } from "../homeAssistant/state.js";
import {
  getBomForecastBundle,
  getBomHourlySeries,
  getBomRelatedEntityIds,
  getBomWarnings
} from "./bom.js";

let activeLotties = [];
let cachedDaily = null;
let cachedWeather = null;
let narrativeTimer = null;
let lastAppliedCinematicCode = null;
let lastAppliedView = "";
let cinematicPaused = false;
let pendingBomTimer = null;
let lastBomRenderHash = "";
let lastPrimaryRenderHash = "";

const WEATHER_DEBOUNCE_MS = 350;
const BOM_DEBUG = CONFIG.weather?.debugBom === true;

const BACKGROUND_ASSETS = {
  clear: {
    webm: "/assets/weather_bg/clear.webm",
    image: "/assets/weather_bg/clear.svg"
  },
  cloudy: {
    webm: "/assets/weather_bg/cloudy.webm",
    image: "/assets/weather_bg/cloudy.svg"
  },
  rain: {
    webm: "/assets/weather_bg/rain.webm",
    image: "/assets/weather_bg/rain.svg"
  },
  storm: {
    webm: "/assets/weather_bg/storm.webm",
    image: "/assets/weather_bg/storm.svg"
  },
  fog: {
    webm: "/assets/weather_bg/fog.webm",
    image: "/assets/weather_bg/fog.svg"
  },
  golden_hour: {
    webm: "/assets/weather_bg/golden_hour.webm",
    image: "/assets/weather_bg/golden_hour.svg"
  },
  heat_haze: {
    webm: "/assets/weather_bg/heat_haze.webm",
    image: "/assets/weather_bg/heat_haze.svg"
  }
};

const GOLDEN_HOUR_WINDOW_MS = 45 * 60 * 1000;
const HEAT_HAZE_TEMP_C = 32;
const HEAT_HAZE_FEELS_LIKE_C = 34;
const HEAT_HAZE_UV_INDEX = 7;

let cachedSunTimes = {
  dayKey: "",
  lat: null,
  lon: null,
  sunrise: null,
  sunset: null
};

function clearLotties() {
  activeLotties.forEach(anim => anim.destroy?.());
  activeLotties = [];
}

function setTextIfChanged(element, nextText) {
  if (!element) return;
  if (element.textContent !== nextText) {
    element.textContent = nextText;
  }
}

function bomLog(message, details = null) {
  if (!BOM_DEBUG) return;
  if (details) {
    console.log(`[Weather BOM] ${message}`, details);
    return;
  }
  console.log(`[Weather BOM] ${message}`);
}

export function getBaseCategory(code) {
  const category = categoryForWeatherCode(code);
  if (category === "mostly_clear" || category === "clear") return "clear";
  if (category === "cloudy") return "cloudy";
  if (category === "drizzle" || category === "rain" || category === "showers") return "rain";
  if (category === "storms") return "storm";
  if (category === "fog") return "fog";
  if (category === "snow") return "cloudy";
  return "cloudy";
}

function dayKeyForDate(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function getSunTimes(lat, lon, date = new Date()) {
  const dayKey = dayKeyForDate(date);
  if (
    cachedSunTimes.dayKey === dayKey &&
    cachedSunTimes.lat === lat &&
    cachedSunTimes.lon === lon &&
    cachedSunTimes.sunrise &&
    cachedSunTimes.sunset
  ) {
    return cachedSunTimes;
  }

  const times = getSunTimesFromCalc(date, lat, lon);
  cachedSunTimes = {
    dayKey,
    lat,
    lon,
    sunrise: times?.sunrise ?? null,
    sunset: times?.sunset ?? null
  };

  return cachedSunTimes;
}

function withinGoldenHourWindow(now, targetTime) {
  if (!(targetTime instanceof Date) || Number.isNaN(targetTime.getTime())) return false;
  return Math.abs(now.getTime() - targetTime.getTime()) <= GOLDEN_HOUR_WINDOW_MS;
}

function resolveWeatherCoordinates(data) {
  const lat = data?.latitude ?? WEATHER_LAT;
  const lon = data?.longitude ?? WEATHER_LON;
  return { lat, lon };
}

export function getBackgroundVariant(baseCategory, currentWeatherData, nowDate = new Date()) {
  if (["storm", "rain", "fog"].includes(baseCategory)) return baseCategory;

  const now = nowDate instanceof Date ? nowDate : new Date(nowDate);
  const current = currentWeatherData?.current_weather || {};
  const hourly = currentWeatherData?.hourly || {};
  const hourlyIndex = getClosestHourIndex(hourly);
  const uvIndex = hourlyIndex != null ? hourly?.uv_index?.[hourlyIndex] : null;
  const feelsLikeC = hourlyIndex != null ? hourly?.apparent_temperature?.[hourlyIndex] : null;
  const currentTempC = current?.temperature;
  const { lat, lon } = resolveWeatherCoordinates(currentWeatherData);
  const { sunrise, sunset } = getSunTimes(lat, lon, now);

  const isGoldenHourEligible = baseCategory === "clear" || baseCategory === "cloudy";
  const isGoldenHour =
    isGoldenHourEligible &&
    (withinGoldenHourWindow(now, sunrise) || withinGoldenHourWindow(now, sunset));
  if (isGoldenHour) return "golden_hour";

  const isHeatHazeEligible = baseCategory === "clear";
  const uvGatePasses =
    uvIndex == null ||
    uvIndex >= HEAT_HAZE_UV_INDEX ||
    (feelsLikeC != null && feelsLikeC >= HEAT_HAZE_FEELS_LIKE_C);
  const isHeatHaze =
    isHeatHazeEligible &&
    currentTempC != null &&
    currentTempC >= HEAT_HAZE_TEMP_C &&
    uvGatePasses;

  return isHeatHaze ? "heat_haze" : baseCategory;
}

function isWeatherViewActive() {
  return document.body?.dataset?.view === "weather";
}

function stopCinematicBackground({ resetSources = false } = {}) {
  const video = document.getElementById("weather-bg-video");
  if (!video) return;

  if (!cinematicPaused || resetSources) {
    video.pause();
    video.classList.remove("is-active");
    cinematicPaused = true;
  }

  if (!resetSources) return;

  const webmSource = document.getElementById("weather-bg-webm");

  video.dataset.category = "";
  video.dataset.variant = "";
  webmSource?.removeAttribute("src");
  video.removeAttribute("src");
  video.load();
}

function applyCinematicBackground(weatherData) {
  const code = weatherData?.current_weather?.weathercode;
  const currentView = document.body?.dataset?.view || "";
  if (code == null || currentView !== "weather") {
    bomLog("cinematic skip", { currentView, reason: "not-weather-or-no-code" });
    return false;
  }

  if (lastAppliedCinematicCode === code && lastAppliedView === currentView) {
    bomLog("cinematic skip", { currentView, code, reason: "unchanged-code" });
    return false;
  }

  const video = document.getElementById("weather-bg-video");
  const webmSource = document.getElementById("weather-bg-webm");
  const image = document.getElementById("weather-bg-image");

  if (!video || !webmSource || !image) return false;

  const baseCategory = getBaseCategory(code);
  const variant = getBackgroundVariant(baseCategory, weatherData, new Date());
  const asset = BACKGROUND_ASSETS[variant] || BACKGROUND_ASSETS[baseCategory] || BACKGROUND_ASSETS.cloudy;
  const weatherRoot = document.getElementById("weather-screen");
  if (weatherRoot) {
    const classes = ["is-clear", "is-cloudy", "is-rain", "is-storm", "is-fog"];
    weatherRoot.classList.remove(...classes);
    weatherRoot.classList.add(`is-${baseCategory}`);
  }

  if (video.dataset.variant === variant) {
    lastAppliedCinematicCode = code;
    lastAppliedView = currentView;
    cinematicPaused = false;
    bomLog("cinematic skip", { currentView, code, reason: "unchanged-variant" });
    return false;
  }

  video.dataset.category = baseCategory;
  video.dataset.variant = variant;
  webmSource.src = asset.webm;
  image.style.backgroundImage = `url("${asset.image}")`;

  const activateVideo = () => {
    video.classList.add("is-active");
  };

  const handleError = () => {
    video.classList.remove("is-active");
  };

  video.removeEventListener("loadeddata", activateVideo);
  video.removeEventListener("error", handleError);
  video.addEventListener("loadeddata", activateVideo, { once: true });
  video.addEventListener("error", handleError, { once: true });

  video.load();
  video.play().catch(() => {
    handleError();
  });

  lastAppliedCinematicCode = code;
  lastAppliedView = currentView;
  cinematicPaused = false;
  bomLog("cinematic apply", { currentView, code, variant });
  return true;
}

function syncWeatherMotion(weatherData) {
  const code = weatherData?.current_weather?.weathercode;
  if (code == null) return;

  if (!isWeatherViewActive()) {
    stopWeatherMotion();
    clearWeatherFxOverlay();
    stopCinematicBackground();
    lastAppliedView = document.body?.dataset?.view || "";
    bomLog("cinematic skip", { currentView: lastAppliedView, reason: "view-not-weather" });
    return;
  }

  applyCinematicBackground(weatherData);
  setWeatherFxOverlay(weatherText(code));

  const category = getBaseCategory(code);
  if (category === "storm") {
    startWeatherMotion({ code });
  } else {
    stopWeatherMotion();
  }
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

function withinHourRange(hour, start, end) {
  if (start <= end) return hour >= start && hour <= end;
  return hour >= start || hour <= end;
}

function mean(values) {
  if (!values?.length) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function pickDescriptor(code, maxPop) {
  if (maxPop >= 50) return "Rain later";
  if (maxPop >= 20) return "Showers";

  const category = getBaseCategory(code);
  const map = {
    clear: "Clear",
    cloudy: "Cloudy",
    rain: "Rain",
    storm: "Stormy",
    fog: "Foggy"
  };
  return map[category] || "Calm";
}

function pickIcon(code, maxPop) {
  if (maxPop >= 50) return "☔";
  const category = getBaseCategory(code);
  if (category === "storm") return "⚡";
  if (category === "rain" && maxPop >= 20) return "☔";
  return "";
}

export async function startWeather() {
  try {
    clearLotties();
    const data = await fetchWeatherData();
    cachedWeather = data;
    cachedDaily = data?.daily || null;
    renderCurrent(data);
    renderWeekly(data.daily);
    emit("weather:refreshed", { timestamp: Date.now() });
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

  const max = Math.round(daily.temperature_2m_max[0]);
  const min = Math.round(daily.temperature_2m_min[0]);
  const primaryHash = [Math.round(current.temperature), current.weathercode, max, min, Math.round(current.windspeed ?? 0)].join("|");
  if (lastPrimaryRenderHash !== primaryHash) {
    setTextIfChanged(tempEl, `${Math.round(current.temperature)}°`);
    setTextIfChanged(descEl, weatherText(current.weathercode));
    setTextIfChanged(rangeEl, `H ${max}°  L ${min}°`);
    lastPrimaryRenderHash = primaryHash;
  }

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

  syncWeatherMotion(data);

  const anim = loadLottieAnimation("weather-lottie", animFile);
  if (anim) activeLotties.push(anim);

  renderCinematic(data, hourlyIndex);
}

function renderWeekly(daily) {
  if (!daily?.weathercode) return;

  const haStates = getAllEntities();
  daily.weathercode.slice(0, 7).forEach((code, i) => {
    const iconId = `week-icon-${i}`;
    const iconContainer = ensureWeekIconContainer(i, iconId);
    if (!iconContainer) return;

    const file = weatherAnimation(code, true);
    const anim = loadLottieAnimation(iconId, file);
    if (anim) activeLotties.push(anim);

    if (i >= 4) {
      const bundle = getBomForecastBundle(CONFIG.weather?.bom?.locationName || "", i + 1, haStates);
      if (iconContainer && (bundle.shortText || bundle.rainRange || bundle.uvCategory)) {
        iconContainer.title = [bundle.shortText, bundle.rainRange, bundle.uvCategory].filter(Boolean).join(" • ");
      }
    }
  });
}

function ensureWeekIconContainer(index, iconId) {
  const existing = document.getElementById(iconId);
  if (existing) return existing;

  const weekBlocks = document.querySelectorAll("#weekly-list .week-day-block");
  const parent = weekBlocks[index];
  if (!parent) return null;

  const iconDiv = document.createElement("div");
  iconDiv.className = "week-weather-icon";
  iconDiv.id = iconId;

  parent.prepend(iconDiv);
  return iconDiv;
}

function renderCinematic(data, hourlyIndex) {
  const current = data.current_weather;
  const daily = data.daily;
  const hourly = data.hourly || {};
  const anchorCondition = document.getElementById("weather-cine-condition");
  const anchorTemp = document.getElementById("weather-cine-temp");
  const anchorMeta = document.getElementById("weather-cine-meta");
  const locationLabel = document.getElementById("weather-location-label");
  const dayLabel = document.getElementById("weather-day-label");

  if (anchorCondition) anchorCondition.textContent = weatherText(current.weathercode);
  if (anchorTemp) anchorTemp.textContent = `${Math.round(current.temperature)}°`;
  if (locationLabel) locationLabel.textContent = (CONFIG.weather?.bom?.locationName || "Nudgee").toUpperCase();
  if (dayLabel) dayLabel.textContent = "TODAY";

  const max = Math.round(daily.temperature_2m_max[0]);
  const min = Math.round(daily.temperature_2m_min[0]);
  const apparent = hourly?.apparent_temperature?.[hourlyIndex];
  if (anchorMeta) {
    const feels = apparent != null ? `Feels like ${Math.round(apparent)}°` : "";
    anchorMeta.textContent = `${feels}${feels ? " | " : ""}H ${max}° L ${min}°`;
  }

  renderNarrative({ current, hourly, hourlyIndex });
  renderDayparts({ hourly, hourlyIndex });
  renderHourlyStrip({ hourly, hourlyIndex });
  scheduleBomPanelUpdate({ immediate: true });
}

function renderNarrative({ current, hourly, hourlyIndex }) {
  const narrativeEl = document.getElementById("weather-narrative");
  if (!narrativeEl) return;

  const pop = hourly?.precipitation_probability?.[hourlyIndex] ?? 0;
  const uvIndex = hourly?.uv_index?.[hourlyIndex];
  const wind = hourly?.windspeed_10m?.[hourlyIndex] ?? current?.windspeed ?? 0;
  const category = getBaseCategory(current?.weathercode);
  const hour = new Date().getHours();
  const temp = current?.temperature ?? null;

  let text = "";
  if (category === "storm") {
    text = "Storm risk. Stay alert.";
  } else if (pop >= 50) {
    text = "Rain likely later.";
  } else if (pop >= 20) {
    text = "Chance of rain later.";
  } else if (uvIndex != null && uvIndex >= 6 && temp != null && temp >= 28 && hour >= 11 && hour <= 16) {
    text = "High UV this afternoon.";
  } else if (wind >= 25) {
    text = "Breezy conditions.";
  }

  if (!text) {
    narrativeEl.classList.remove("is-visible");
    narrativeEl.textContent = "";
    if (narrativeTimer) clearTimeout(narrativeTimer);
    return;
  }

  narrativeEl.textContent = text;
  narrativeEl.classList.add("is-visible");
  if (narrativeTimer) clearTimeout(narrativeTimer);
  narrativeTimer = setTimeout(() => {
    narrativeEl.classList.remove("is-visible");
  }, 10000);
}

function getNextHourlySlice(hourly, hourlyIndex, count = 12) {
  if (!hourly?.time?.length) return [];
  const start = hourlyIndex == null ? 0 : Math.max(0, hourlyIndex);
  const end = Math.min(hourly.time.length, start + count);
  const rows = [];
  for (let idx = start; idx < end; idx += 1) {
    rows.push({
      index: idx,
      time: hourly.time[idx],
      temp: hourly.temperature_2m?.[idx],
      apparent: hourly.apparent_temperature?.[idx],
      code: hourly.weathercode?.[idx],
      precipProb: hourly.precipitation_probability?.[idx],
      precipMm: hourly.precipitation?.[idx],
      isDay: hourly.is_day?.[idx]
    });
  }
  return rows;
}

function formatHourLabel(time) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "--";
  return date
    .toLocaleTimeString([], { hour: "numeric", hour12: true })
    .replace(/\s/g, "")
    .toLowerCase();
}

function renderDayparts({ hourly, hourlyIndex }) {
  const dayparts = document.getElementById("weather-dayparts");
  if (!dayparts) return;

  if (!hourly?.time?.length) {
    dayparts.innerHTML = "";
    return;
  }

  const now = new Date();
  const endWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const indicesForRange = (startHour, endHour) =>
    hourly.time.reduce((acc, time, idx) => {
      const t = new Date(time);
      if (t < now || t > endWindow) return acc;
      if (withinHourRange(t.getHours(), startHour, endHour)) acc.push(idx);
      return acc;
    }, []);

  const buckets = [
    { key: "now", label: "Now", indices: hourlyIndex != null ? [hourlyIndex] : [] },
    { key: "evening", label: "Evening", indices: indicesForRange(18, 21) },
    { key: "night", label: "Night", indices: indicesForRange(22, 4) },
    { key: "morning", label: "Morning", indices: indicesForRange(5, 11) }
  ];

  const mostCommon = (values) => {
    if (!values?.length) return null;
    const counts = values.reduce((acc, v) => {
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  };

  dayparts.innerHTML = "";
  buckets.forEach((bucket) => {
    const temps = bucket.indices.map(i => hourly.temperature_2m?.[i]).filter(v => v != null);
    const avgTemp = mean(temps);
    const codes = bucket.indices.map(i => hourly.weathercode?.[i]).filter(v => v != null);
    const popValues = bucket.indices.map(i => hourly.precipitation_probability?.[i]).filter(v => v != null);
    const pop = popValues.length ? Math.max(...popValues) : 0;
    const reprCode = mostCommon(codes);
    const descriptor = pickDescriptor(reprCode, pop);
    const icon = pickIcon(reprCode, pop);

    const daypart = document.createElement("div");
    daypart.className = "weather-daypart weather-glass";
    daypart.innerHTML = `
      <div class="weather-daypart__label">${bucket.label}</div>
      <div class="weather-daypart__value">${icon ? `${icon} ` : ""}${avgTemp != null ? `${Math.round(avgTemp)}°` : "--"}</div>
      <div class="weather-daypart__meta">${descriptor}</div>
    `;
    dayparts.appendChild(daypart);
  });
}

function renderHourlyStrip({ hourly, hourlyIndex }) {
  const strip = document.getElementById("weather-hourly-strip");
  if (!strip) return;

  const rows = getNextHourlySlice(hourly, hourlyIndex, 12);
  if (!rows.length) {
    strip.innerHTML = "";
    strip.classList.add("is-hidden");
    return;
  }

  strip.classList.remove("is-hidden");
  strip.innerHTML = rows.map((row, idx) => `
    <div class="hourly-item">
      <div class="hourly-time">${formatHourLabel(row.time)}</div>
      <div class="hourly-lottie" id="weather-hourly-lottie-${idx}"></div>
      <div class="hourly-temp">${row.temp != null ? `${Math.round(row.temp)}°` : "--"}</div>
    </div>
  `).join("");

  rows.forEach((row, idx) => {
    if (row.code == null) return;
    const animFile = weatherAnimation(row.code, row.isDay !== 0);
    const anim = loadLottieAnimation(`weather-hourly-lottie-${idx}`, animFile);
    if (anim) activeLotties.push(anim);
  });
}

function toggleSparkVisibility(target, isVisible) {
  if (!target) return;
  target.style.display = isVisible ? "" : "none";
}

function renderBarSparkline(target, series = [], maxHeight = 36) {
  if (!target) return;
  if (!series.length) {
    target.innerHTML = "";
    toggleSparkVisibility(target, false);
    return;
  }
  const maxValue = Math.max(...series.map(item => item.value ?? 0), 0);
  const divisor = maxValue > 0 ? maxValue : 1;
  target.innerHTML = series
    .map((item) => {
      const normalized = (item.value ?? 0) / divisor;
      const height = Math.max(4, Math.round(normalized * maxHeight));
      return `<span class="bar" style="height:${height}px" title="${item.label}: ${(item.value ?? 0).toFixed(1)}mm"></span>`;
    })
    .join("");
  toggleSparkVisibility(target, true);
}

function renderLineSparkline(target, values = []) {
  if (!target) return;
  const numeric = values.filter(value => Number.isFinite(value));
  if (!numeric.length) {
    target.innerHTML = "";
    toggleSparkVisibility(target, false);
    return;
  }

  const minValue = Math.min(...numeric);
  const maxValue = Math.max(...numeric);
  const range = Math.max(maxValue - minValue, 1);
  const width = 100;
  const height = 44;
  const points = values.map((value, idx) => {
    const x = values.length <= 1 ? 0 : (idx / (values.length - 1)) * width;
    const safeValue = Number.isFinite(value) ? value : minValue;
    const y = height - ((safeValue - minValue) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  target.innerHTML = `<svg class="metric-line" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points.join(" ")}" /></svg>`;
  toggleSparkVisibility(target, true);
}

function formatNextRainMeta(deltaMs, amount) {
  const mins = Math.max(0, Math.round(deltaMs / 60000));
  if (mins < 60) return `in ${mins} mins • ${amount.toFixed(1)}mm`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (!remMins) return `in ${hours} hrs • ${amount.toFixed(1)}mm`;
  return `in ${hours}h ${remMins}m • ${amount.toFixed(1)}mm`;
}

function normalizeUvDial(index, category) {
  const uvIndex = Number.isFinite(index) ? Math.max(0, Math.round(index)) : null;
  const maxDial = 12;
  const ratio = uvIndex == null ? 0 : Math.min(uvIndex, maxDial) / maxDial;
  const degrees = Math.round(ratio * 360);
  const label = category || "--";
  return { uvIndex, label, degrees };
}

function renderBomPanels() {
  const haStates = getAllEntities();
  const todayBundle = getBomForecastBundle(CONFIG.weather?.bom?.locationName || "", 0, haStates);
  const warnings = getBomWarnings(haStates);
  const bomHourly = getBomHourlySeries(haStates);
  const hourly = cachedWeather?.hourly || {};
  const hourlyIndex = getClosestHourIndex(hourly);
  const hourlySlice = getNextHourlySlice(hourly, hourlyIndex, 12);
  const humidity = hourlyIndex != null ? hourly?.relativehumidity_2m?.[hourlyIndex] : null;
  const apparent = hourlyIndex != null ? hourly?.apparent_temperature?.[hourlyIndex] : null;
  const rainfallSeries = (bomHourly.length ? bomHourly : hourlySlice.map((row) => ({
    value: Number.isFinite(row.precipMm) ? row.precipMm : 0,
    label: formatHourLabel(row.time)
  })));

  if (BOM_DEBUG) {
    bomLog("resolved BOM ids", {
      warningsEntityId: CONFIG.weather?.bom?.warningsEntityId || "(auto)",
      hourlyEntityId: CONFIG.weather?.bom?.hourlyEntityId || "(auto)",
      locationName: CONFIG.weather?.bom?.locationName || "(unset)"
    });
    bomLog("hourly array lengths", {
      temperature: hourly?.temperature_2m?.length || 0,
      apparent: hourly?.apparent_temperature?.length || 0,
      precipitation: hourly?.precipitation?.length || 0,
      bomHourly: bomHourly.length
    });
  }

  const summaryHash = JSON.stringify({
    warning: warnings.summary,
    fire: todayBundle.fireDanger,
    uv: todayBundle.uvMaxIndex,
    uvCategory: todayBundle.uvCategory,
    rainChance: todayBundle.rainChance,
    rainRange: todayBundle.rainRange,
    rainfall: rainfallSeries.map((item) => item.value),
    humidity,
    apparent
  });

  if (summaryHash === lastBomRenderHash) return;
  lastBomRenderHash = summaryHash;

  const uvDial = document.getElementById("weather-uv-dial");
  const uvValue = document.getElementById("weather-uv-dial-value");
  const uvMeta = document.getElementById("weather-uv-dial-meta");
  const rainCard = document.getElementById("weather-rain-range-card");
  const rainMeta = document.getElementById("weather-rain-range-meta");
  const rainSpark = document.getElementById("weather-rain-spark");
  const humidityLarge = document.getElementById("weather-humidity-large");
  const humidityMeta = document.getElementById("weather-humidity-meta");
  const feelsLarge = document.getElementById("weather-feels-like-large");
  const feelsMeta = document.getElementById("weather-feels-like-meta");
  const feelsSpark = document.getElementById("weather-feels-spark");
  const nextRainValue = document.getElementById("weather-next-rain");
  const nextRainMeta = document.getElementById("weather-next-rain-meta");
  const nextRainSpark = document.getElementById("weather-next-rain-spark");

  const uvDialData = normalizeUvDial(todayBundle.uvMaxIndex, todayBundle.uvCategory);
  if (uvDial) uvDial.style.setProperty("--uv-deg", `${uvDialData.degrees}deg`);
  setTextIfChanged(uvValue, uvDialData.uvIndex != null ? `${uvDialData.uvIndex}` : "--");
  setTextIfChanged(uvMeta, uvDialData.label);

  setTextIfChanged(rainCard, todayBundle.rainChance != null ? `${Math.round(todayBundle.rainChance)}% chance` : "--");
  setTextIfChanged(rainMeta, "");
  renderBarSparkline(rainSpark, rainfallSeries, 36);

  setTextIfChanged(humidityLarge, humidity != null ? `${Math.round(humidity)}%` : "--");
  setTextIfChanged(humidityMeta, "");

  setTextIfChanged(feelsLarge, apparent != null ? `${Math.round(apparent)}°` : "--");
  setTextIfChanged(feelsMeta, "");
  renderLineSparkline(feelsSpark, hourlySlice.map((row) => row.apparent));

  const nextRainIndex = rainfallSeries.findIndex((item) => item.value > 0.1);
  if (nextRainIndex >= 0) {
    const nextRainPoint = rainfallSeries[nextRainIndex];
    const hourlyPoint = hourlySlice[nextRainIndex];
    const timestamp = hourlyPoint?.time ? new Date(hourlyPoint.time) : new Date(Date.now() + nextRainIndex * 3600000);
    const timeLabel = timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
    const deltaMs = Math.max(0, timestamp.getTime() - Date.now());
    setTextIfChanged(nextRainValue, timeLabel);
    setTextIfChanged(nextRainMeta, formatNextRainMeta(deltaMs, nextRainPoint.value));
    renderBarSparkline(nextRainSpark, rainfallSeries, 28);
  } else {
    setTextIfChanged(nextRainValue, "No rain expected");
    setTextIfChanged(nextRainMeta, "");
    renderBarSparkline(nextRainSpark, [], 28);
  }

  bomLog("summary", {
    warning: warnings.summary,
    fireDanger: todayBundle.fireDanger,
    uvCategory: todayBundle.uvCategory,
    uvMaxIndex: todayBundle.uvMaxIndex,
    rainChance: todayBundle.rainChance,
    rainRange: todayBundle.rainRange,
    humidity,
    apparent
  });
}

function scheduleBomPanelUpdate({ immediate = false } = {}) {
  if (pendingBomTimer) {
    clearTimeout(pendingBomTimer);
    pendingBomTimer = null;
  }
  if (immediate) {
    renderBomPanels();
    return;
  }
  pendingBomTimer = setTimeout(() => {
    pendingBomTimer = null;
    renderBomPanels();
  }, WEATHER_DEBOUNCE_MS);
}

export function stopWeatherView() {
  clearLotties();
  stopWeatherMotion();
  if (narrativeTimer) clearTimeout(narrativeTimer);
  narrativeTimer = null;
  if (pendingBomTimer) clearTimeout(pendingBomTimer);
  pendingBomTimer = null;
  stopCinematicBackground({ resetSources: true });
  clearWeatherFxOverlay();
}

function rerenderWeeklyFromCache() {
  if (!cachedDaily) return;
  renderWeekly(cachedDaily);
}

/* 🔁 Cleanup on view change (prevents memory leaks) */
on("view:changed", ({ view } = {}) => {
  clearLotties();
  if (cachedWeather) {
    renderCurrent(cachedWeather);
  }
  if (!isWeatherViewActive()) {
    stopWeatherMotion();
    clearWeatherFxOverlay();
    stopCinematicBackground();
    lastAppliedView = view || "";
    return;
  }
  if (cachedWeather) {
    renderWeekly(cachedWeather.daily);
  }
});

document.addEventListener("ha:state-updated", (event) => {
  const entityId = event?.detail?.entity_id;
  if (!entityId) return;
  const trackedIds = getBomRelatedEntityIds(getAllEntities());
  if (!trackedIds.has(entityId)) return;
  const warningsEntityId = CONFIG.weather?.bom?.warningsEntityId;
  const immediate = Boolean(warningsEntityId && entityId === warningsEntityId);
  scheduleBomPanelUpdate({ immediate });
});

on("calendar:weekRendered", () => {
  rerenderWeeklyFromCache();
});
