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
import { loadLottieAnimation, syncLottiePlayback } from "../../helpers/lottie.js";
import { emit, on } from "../../core/eventBus.js";
import { CONFIG } from "../../core/config.js";
import { startWeatherMotion, stopWeatherMotion } from "../../weatherMotion.js";
import { getBaseCategory, intensityForWeatherCode, isThunderCode } from "../../weatherPrompts.js";
import { WEATHER_LAT, WEATHER_LON } from "../../config/config.js";
import { getTimes as getSunTimesFromCalc } from "../../vendor/suncalc.js";
import { clearWeatherFxOverlay, setWeatherFxOverlay } from "./fxOverlay.js";
import { refreshAirQuality } from "./airQuality.js";
import { set as setContext, get as getContext } from "../../core/contextStore.js";
import { getAllEntities, getEntitiesVersion } from "../homeAssistant/state.js";
import { escapeHtml } from "../../core/escapeHtml.js";
import {
  getBomForecastBundle,
  getBomHourlySeries,
  getBomRelatedEntityIds,
  getBomWarnings,
  normalizeUvCategory
} from "./bom.js";

let activeLotties = [];
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
    mp4: "/assets/weather_bg/clear.mp4",
    image: "/assets/weather_bg/clear.svg"
  },
  cloudy: {
    mp4: "/assets/weather_bg/cloudy.mp4",
    image: "/assets/weather_bg/cloudy.svg"
  },
  rain: {
    mp4: "/assets/weather_bg/rain.mp4",
    image: "/assets/weather_bg/rain.svg"
  },
  storm: {
    mp4: "/assets/weather_bg/storm.mp4",
    image: "/assets/weather_bg/storm.svg"
  },
  fog: {
    mp4: "/assets/weather_bg/fog.mp4",
    image: "/assets/weather_bg/fog.svg"
  },
  golden_hour: {
    mp4: "/assets/weather_bg/golden_hour.mp4",
    image: "/assets/weather_bg/clear.svg"
  },
  heat_haze: {
    mp4: "/assets/weather_bg/heat_haze.mp4",
    image: "/assets/weather_bg/clear.svg"
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

/* Moved to weatherPrompts.js (2026-08-17) so V3 can reach it without importing
   this DOM renderer. Re-exported because this module has been its address since
   Phase 5 and the incumbent's importers should not have to care. */
export { getBaseCategory };

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

const BG_CROSSFADE_SETTLE_MS = 2800;
let bgFadeTimer = null;

function getBgLayers() {
  const entries = ["a", "b"].map(key => ({
    layer: document.getElementById(`weather-bg-layer-${key}`),
    video: document.getElementById(`weather-bg-video-${key}`)
  }));
  return entries.every(({ layer, video }) => layer && video) ? entries : [];
}

function setActiveBgLayer(layers, target) {
  layers.forEach(({ layer }) => {
    layer.classList.toggle("is-active", layer === target.layer);
  });
  if (bgFadeTimer) clearTimeout(bgFadeTimer);
  bgFadeTimer = setTimeout(() => {
    bgFadeTimer = null;
    layers.forEach(({ layer, video }) => {
      if (!layer.classList.contains("is-active")) video.pause();
    });
  }, BG_CROSSFADE_SETTLE_MS);
}

function stopCinematicBackground({ resetSources = false } = {}) {
  const layers = getBgLayers();
  if (!layers.length) return;

  if (bgFadeTimer) {
    clearTimeout(bgFadeTimer);
    bgFadeTimer = null;
  }

  if (!cinematicPaused || resetSources) {
    layers.forEach(({ layer, video }) => {
      video.pause();
      layer.classList.remove("is-active");
    });
    cinematicPaused = true;
  }

  if (!resetSources) return;

  layers.forEach(({ video }) => {
    video.dataset.category = "";
    video.dataset.variant = "";
    video.removeAttribute("src");
    video.load();
  });
}

function applyCinematicBackground(weatherData) {
  const code = weatherData?.current_weather?.weathercode;
  const currentView = document.body?.dataset?.view || "";
  if (code == null || currentView !== "weather") {
    bomLog("cinematic skip", { currentView, reason: "not-weather-or-no-code" });
    return false;
  }

  if (lastAppliedCinematicCode === code && lastAppliedView === currentView && !cinematicPaused) {
    bomLog("cinematic skip", { currentView, code, reason: "unchanged-code" });
    return false;
  }

  const layers = getBgLayers();
  const image = document.getElementById("weather-bg-image");
  if (!layers.length || !image) return false;

  const baseCategory = getBaseCategory(code);
  const variant = getBackgroundVariant(baseCategory, weatherData, new Date());
  const asset = BACKGROUND_ASSETS[variant] || BACKGROUND_ASSETS[baseCategory] || BACKGROUND_ASSETS.cloudy;
  const weatherRoot = document.getElementById("weather-screen");
  if (weatherRoot) {
    const classes = ["is-clear", "is-cloudy", "is-rain", "is-storm", "is-fog"];
    weatherRoot.classList.remove(...classes);
    weatherRoot.classList.add(`is-${baseCategory}`);
  }

  image.style.backgroundImage = `url("${asset.image}")`;

  const loaded = layers.find(({ video }) => video.dataset.variant === variant);
  if (loaded) {
    /* Variant already sits on one layer (resume after view switch, or
       A/B toggle between two conditions) — crossfade back to it. */
    loaded.video.play().catch(() => {});
    setActiveBgLayer(layers, loaded);
    lastAppliedCinematicCode = code;
    lastAppliedView = currentView;
    cinematicPaused = false;
    bomLog("cinematic apply", { currentView, code, variant, reason: "layer-resume" });
    return true;
  }

  const active = layers.find(({ layer }) => layer.classList.contains("is-active"));
  const incoming = layers.find(entry => entry !== active) || layers[0];
  const { video } = incoming;

  video.dataset.category = baseCategory;
  video.dataset.variant = variant;

  const activate = () => {
    if (video.dataset.variant !== variant) return; // superseded by a later change
    video.play().catch(() => {});
    setActiveBgLayer(layers, incoming);
  };

  const handleError = () => {
    if (video.dataset.variant !== variant) return;
    /* Leave the outgoing layer running (or the poster showing). */
    video.dataset.category = "";
    video.dataset.variant = "";
    bomLog("cinematic video error", { variant });
  };

  video.addEventListener("canplay", activate, { once: true });
  video.addEventListener("error", handleError, { once: true });
  video.src = asset.mp4;
  video.load();

  lastAppliedCinematicCode = code;
  lastAppliedView = currentView;
  cinematicPaused = false;
  bomLog("cinematic apply", { currentView, code, variant });
  return true;
}

// Debug hook (same spirit as __switchView): lets kiosk-side CDP / local
// Playwright force a background variant to verify crossfades live.
window.__setWeatherBg = code =>
  applyCinematicBackground({ current_weather: { weathercode: code, temperature: 25 } });

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

export async function startWeather() {
  // Air quality is a separate upstream on its own guard — fire it independently
  // so a failure there never blocks or breaks the main weather render.
  refreshAirQuality();
  try {
    clearLotties();
    const data = await fetchWeatherData();
    cachedWeather = data;
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
  const locationEl = document.getElementById("weather-home-location");

  if (locationEl) {
    setTextIfChanged(locationEl, (CONFIG.weather?.bom?.locationName || "Nudgee").toUpperCase());
  }

  const max = Math.round(daily.temperature_2m_max[0]);
  const min = Math.round(daily.temperature_2m_min[0]);
  const primaryHash = [Math.round(current.temperature), current.weathercode, max, min, Math.round(current.windspeed ?? 0)].join("|");
  if (lastPrimaryRenderHash !== primaryHash) {
    setTextIfChanged(tempEl, `${Math.round(current.temperature)}°`);
    setTextIfChanged(descEl, weatherText(current.weathercode));
    setTextIfChanged(rangeEl, `H ${max}°  L ${min}°`);
    lastPrimaryRenderHash = primaryHash;
  }

  // Bare top row (WP-B, docs/design/DESIGN_ROLLOUT.md): the awake top row drops
  // the weather icon (borrowed light) + wind line. Skip loading those lotties so
  // a hidden animation doesn't keep a requestAnimationFrame running (the zombie-
  // lottie leak CLAUDE.md warns about). Flag-off → loads as before, byte-identical.
  const bareTopRow = Boolean(window.CONFIG?.features?.bareTopRow);

  if (windTextEl && current.windspeed != null) {
    const windKmh = current.windspeed;
    const windDirText = describeWindDirection(current.winddirection);
    windTextEl.textContent = windDirText
      ? `${Math.round(windKmh)} km/h ${windDirText}`
      : `${Math.round(windKmh)} km/h`;

    if (!bareTopRow) {
      const beaufort = getBeaufortNumber(windKmh);
      const windIconFile = getWindBeaufortFilename(beaufort);
      const windAnim = loadLottieAnimation("weather-wind-icon", windIconFile);
      if (windAnim) activeLotties.push(windAnim);
    }
  }

  // Feed the shared store's weather slice so the ambient atmosphere (Phase 5)
  // reads the real condition from one place instead of re-fetching. The richer
  // `weather` object (living-window effects) only writes when a field actually
  // changed — the store's shallow !== compare would otherwise fire subscribers
  // on every render for an identical fresh object.
  const category = getBaseCategory(current.weathercode);
  const weather = {
    category,
    intensity: intensityForWeatherCode(current.weathercode),
    thunder: isThunderCode(current.weathercode),
    windKph: current.windspeed ?? null,
    tempC: current.temperature ?? null
  };
  const prevWeather = getContext().weather;
  const weatherChanged =
    !prevWeather ||
    Object.keys(weather).some(key => prevWeather[key] !== weather[key]);
  const conditionCode = current.weathercode == null ? null : Number(current.weathercode);
  setContext(weatherChanged
    ? { condition: category, conditionCode, weather }
    : { condition: category, conditionCode });

  const isDay = isDaytime(data);
  const animFile = weatherAnimation(current.weathercode, isDay);

  syncWeatherMotion(data);

  // Bare top row (WP-B): the awake top-row weather icon is gone (borrowed light —
  // the wall renders the condition). Skip its lottie so no hidden rAF keeps
  // running. (The weather-view hero icon below is a separate, non-top-row surface.)
  if (!bareTopRow) {
    const anim = loadLottieAnimation("weather-lottie", animFile);
    if (anim) activeLotties.push(anim);
  }

  const heroAnim = loadLottieAnimation("weather-hero-icon", animFile);
  if (heroAnim) activeLotties.push(heroAnim);

  renderCinematic(data, hourlyIndex);
  syncLottiePlayback();
}

function renderWeekly(daily) {
  if (!daily?.weathercode) return;
  if (!document.getElementById("weekly-list")) return;

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
  const humidity = hourlyIndex != null ? hourly?.relativehumidity_2m?.[hourlyIndex] : null;
  if (anchorMeta) {
    const windDirText = describeWindDirection(current.winddirection);
    const wind = current.windspeed != null
      ? `Wind ${Math.round(current.windspeed)}${windDirText ? ` ${windDirText}` : ""}`
      : "";
    const feels = apparent != null ? `Feels ${Math.round(apparent)}°` : "";
    const humidityText = humidity != null ? `Humidity ${Math.round(humidity)}%` : "";
    anchorMeta.textContent = [`High ${max}° Low ${min}°`, wind, feels, humidityText]
      .filter(Boolean)
      .join("   ");
  }

  renderNarrative({ current, hourly, hourlyIndex });
  renderDayparts({ hourly });
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

function renderDayparts({ hourly }) {
  const dayparts = document.getElementById("weather-dayparts");
  if (!dayparts) return;

  if (!hourly?.time?.length) {
    dayparts.innerHTML = "";
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowIndices = (startMs, endMs) =>
    hourly.time.reduce((acc, time, idx) => {
      const t = new Date(time).getTime();
      if (t >= startMs && t < endMs) acc.push(idx);
      return acc;
    }, []);

  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const dayStart = today.getTime();

  const buckets = [
    { key: "morning", label: "Morning", indices: windowIndices(dayStart + 5 * hourMs, dayStart + 12 * hourMs) },
    { key: "afternoon", label: "Afternoon", indices: windowIndices(dayStart + 12 * hourMs, dayStart + 18 * hourMs) },
    { key: "evening", label: "Evening", indices: windowIndices(dayStart + 18 * hourMs, dayStart + 22 * hourMs) },
    { key: "night", label: "Night", indices: windowIndices(dayStart + 22 * hourMs, dayStart + dayMs + 5 * hourMs) }
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
    const isDayValues = bucket.indices.map(i => hourly.is_day?.[i]).filter(v => v != null);
    const isDayMost = isDayValues.length ? mostCommon(isDayValues) : (bucket.key === "night" ? 0 : 1);
    const iconId = `weather-daypart-icon-${bucket.key}`;

    const daypart = document.createElement("div");
    daypart.className = "weather-daypart weather-glass";
    daypart.innerHTML = `
      <div class="weather-daypart__label">${bucket.label}</div>
      <div class="weather-daypart__row">
        <div class="weather-daypart__icon" id="${iconId}"></div>
        <div class="weather-daypart__value">${avgTemp != null ? `${Math.round(avgTemp)}°` : "--"}</div>
      </div>
      <div class="weather-daypart__meta">${descriptor}</div>
    `;
    dayparts.appendChild(daypart);

    if (reprCode != null) {
      const animFile = weatherAnimation(Number(reprCode), Number(isDayMost) !== 0);
      const anim = loadLottieAnimation(iconId, animFile);
      if (anim) activeLotties.push(anim);
    }
  });
}

const HOURLY_BAR_COUNT = 10;
const HOURLY_BAR_MAX_HEIGHT = 110;
const HOURLY_BAR_MIN_HEIGHT = 55;

function formatBarHourLabel(time, idx) {
  if (idx === 0) return "Now";
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "--";
  return date
    .toLocaleTimeString([], { hour: "numeric", hour12: true })
    .replace(/\s/g, "")
    .toLowerCase()
    .replace(/m$/, "");
}

function renderHourlyStrip({ hourly, hourlyIndex }) {
  const strip = document.getElementById("weather-hourly-strip");
  if (!strip) return;

  const rows = getNextHourlySlice(hourly, hourlyIndex, HOURLY_BAR_COUNT);
  if (!rows.length) {
    strip.innerHTML = "";
    strip.classList.add("is-hidden");
    return;
  }

  strip.classList.remove("is-hidden");

  const temps = rows.map(row => row.temp).filter(v => v != null);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const range = Math.max(maxTemp - minTemp, 1);

  strip.innerHTML = rows.map((row, idx) => {
    const temp = row.temp;
    const ratio = temp != null ? (temp - minTemp) / range : 0;
    const barHeight = Math.round(HOURLY_BAR_MIN_HEIGHT + ratio * (HOURLY_BAR_MAX_HEIGHT - HOURLY_BAR_MIN_HEIGHT));
    return `
      <div class="hourly-bar-col">
        <div class="hourly-bar-value">${temp != null ? `${Math.round(temp)}°` : "--"}</div>
        <div class="hourly-bar" style="height:${barHeight}px"></div>
        <div class="hourly-bar-time">${formatBarHourLabel(row.time, idx)}</div>
      </div>
    `;
  }).join("");
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
      return `<span class="bar" style="height:${height}px" title="${escapeHtml(item.label)}: ${(item.value ?? 0).toFixed(1)}mm"></span>`;
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

function formatFeelsDeltaMeta(apparent, actual) {
  if (apparent == null || actual == null) return "";
  const delta = Math.round(apparent - actual);
  if (delta === 0) return "Same as actual";
  return delta > 0 ? `${delta}° warmer than actual` : `${Math.abs(delta)}° cooler than actual`;
}

function normalizeUvScale(index, category) {
  const uvIndex = Number.isFinite(index) ? Math.max(0, Math.round(index)) : null;
  const maxScale = 11; // WHO "extreme" band starts at 11 — top of the scale
  const ratio = uvIndex == null ? 0 : Math.min(uvIndex, maxScale) / maxScale;
  const pct = Math.round(ratio * 100);
  const label = category || "--";
  return { uvIndex, label, pct };
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
  const dewPoint = hourlyIndex != null ? hourly?.dewpoint_2m?.[hourlyIndex] : null;
  const actualTemp = cachedWeather?.current_weather?.temperature ?? null;
  const rainfallSeries = (bomHourly.length ? bomHourly : hourlySlice.map((row) => ({
    value: Number.isFinite(row.precipMm) ? row.precipMm : 0,
    label: formatHourLabel(row.time)
  })));
  const todayKey = dayKeyForDate(new Date());
  const todayRainTotal = (hourly?.time || []).reduce((sum, time, idx) => {
    if (dayKeyForDate(new Date(time)) !== todayKey) return sum;
    const value = hourly?.precipitation?.[idx];
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  // UV from BOM/HA is optional — fall back to Open-Meteo's hourly uv_index
  // (already fetched for the narrative/background logic) so the card isn't
  // dependent on a Home Assistant BOM sensor being configured.
  const uvIndexFallback = hourlyIndex != null ? hourly?.uv_index?.[hourlyIndex] : null;
  const uvMaxIndex = todayBundle.uvMaxIndex ?? uvIndexFallback;
  const uvCategory = todayBundle.uvMaxIndex != null
    ? todayBundle.uvCategory
    : normalizeUvCategory(null, uvIndexFallback);

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
    uv: uvMaxIndex,
    uvCategory,
    rainfall: rainfallSeries.map((item) => item.value),
    todayRainTotal,
    humidity,
    apparent,
    dewPoint,
    actualTemp
  });

  if (summaryHash === lastBomRenderHash) return;
  lastBomRenderHash = summaryHash;

  const uvTrack = document.getElementById("weather-uv-track");
  const uvValue = document.getElementById("weather-uv-value");
  const uvMeta = document.getElementById("weather-uv-meta");
  const rainCard = document.getElementById("weather-rain-range-card");
  const rainMeta = document.getElementById("weather-rain-range-meta");
  const rainSpark = document.getElementById("weather-rain-spark");
  const humidityLarge = document.getElementById("weather-humidity-large");
  const humidityMeta = document.getElementById("weather-humidity-meta");
  const humidityBar = document.querySelector("#weather-humidity-bar span");
  const feelsLarge = document.getElementById("weather-feels-like-large");
  const feelsMeta = document.getElementById("weather-feels-like-meta");
  const feelsSpark = document.getElementById("weather-feels-spark");

  const uvScaleData = normalizeUvScale(uvMaxIndex, uvCategory);
  if (uvTrack) uvTrack.style.setProperty("--uv-pct", `${uvScaleData.pct}%`);
  setTextIfChanged(uvValue, uvScaleData.uvIndex != null ? `${uvScaleData.uvIndex}` : "--");
  setTextIfChanged(uvMeta, uvScaleData.label);

  if (rainCard) rainCard.innerHTML = `${todayRainTotal.toFixed(1)}<span class="metric-unit">mm today</span>`;

  const nextRainIndex = rainfallSeries.findIndex((item) => item.value > 0.1);
  if (nextRainIndex >= 0) {
    const nextRainPoint = rainfallSeries[nextRainIndex];
    const hourlyPoint = hourlySlice[nextRainIndex];
    const timestamp = hourlyPoint?.time ? new Date(hourlyPoint.time) : new Date(Date.now() + nextRainIndex * 3600000);
    const deltaMs = Math.max(0, timestamp.getTime() - Date.now());
    setTextIfChanged(rainMeta, `Next window — ${formatNextRainMeta(deltaMs, nextRainPoint.value)}`);
  } else {
    setTextIfChanged(rainMeta, "No rain expected");
  }
  renderBarSparkline(rainSpark, rainfallSeries, 36);

  setTextIfChanged(humidityLarge, humidity != null ? `${Math.round(humidity)}%` : "--");
  setTextIfChanged(humidityMeta, dewPoint != null ? `Dew point ${Math.round(dewPoint)}°` : "");
  if (humidityBar) humidityBar.style.width = humidity != null ? `${Math.max(0, Math.min(100, Math.round(humidity)))}%` : "0%";

  setTextIfChanged(feelsLarge, apparent != null ? `${Math.round(apparent)}°` : "--");
  setTextIfChanged(feelsMeta, formatFeelsDeltaMeta(apparent, actualTemp));
  renderLineSparkline(feelsSpark, hourlySlice.map((row) => row.apparent));

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
    syncLottiePlayback();
    return;
  }
  if (cachedWeather) {
    renderWeekly(cachedWeather.daily);
  }
  syncLottiePlayback();
});

let cachedTrackedIds = null;
let cachedTrackedVersion = -1;

// Same reason as getTodoEntityIds: this ran once per entity on a snapshot
// fan-out, rebuilding the same Set ~700 times.
function bomTrackedEntityIds() {
  const version = getEntitiesVersion();
  if (cachedTrackedIds && cachedTrackedVersion === version) return cachedTrackedIds;
  cachedTrackedIds = getBomRelatedEntityIds(getAllEntities());
  cachedTrackedVersion = version;
  return cachedTrackedIds;
}

document.addEventListener("ha:state-updated", (event) => {
  const entityId = event?.detail?.entity_id;
  if (!entityId) return;
  const trackedIds = bomTrackedEntityIds();
  if (!trackedIds.has(entityId)) return;
  const warningsEntityId = CONFIG.weather?.bom?.warningsEntityId;
  const immediate = Boolean(warningsEntityId && entityId === warningsEntityId);
  scheduleBomPanelUpdate({ immediate });
});
