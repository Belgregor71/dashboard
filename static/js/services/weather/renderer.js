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
let timelineInterval = null;
let timelineIndex = 0;
const pillState = {};
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
    webm: "/assets/weather_bg/clear.webm",
    image: "/assets/weather_bg/clear.svg"
  },
  cloudy: {
    mp4: "/assets/weather_bg/cloudy.mp4",
    webm: "/assets/weather_bg/cloudy.webm",
    image: "/assets/weather_bg/cloudy.svg"
  },
  rain: {
    mp4: "/assets/weather_bg/rain.mp4",
    webm: "/assets/weather_bg/rain.webm",
    image: "/assets/weather_bg/rain.svg"
  },
  storm: {
    mp4: "/assets/weather_bg/storm.mp4",
    webm: "/assets/weather_bg/storm.webm",
    image: "/assets/weather_bg/storm.svg"
  },
  fog: {
    mp4: "/assets/weather_bg/fog.mp4",
    webm: "/assets/weather_bg/fog.webm",
    image: "/assets/weather_bg/fog.svg"
  },
  golden_hour: {
    mp4: "/assets/weather_bg/golden_hour.mp4",
    webm: "/assets/weather_bg/golden_hour.webm",
    image: "/assets/weather_bg/golden_hour.svg"
  },
  heat_haze: {
    mp4: "/assets/weather_bg/heat_haze.mp4",
    webm: "/assets/weather_bg/heat_haze.webm",
    image: "/assets/weather_bg/heat_haze.svg"
  }
};

const PILL_MIN_VISIBLE_MS = 5 * 60 * 1000;
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
  const mp4Source = document.getElementById("weather-bg-mp4");

  video.dataset.category = "";
  video.dataset.variant = "";
  webmSource?.removeAttribute("src");
  mp4Source?.removeAttribute("src");
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
  const mp4Source = document.getElementById("weather-bg-mp4");
  const image = document.getElementById("weather-bg-image");

  if (!video || !webmSource || !mp4Source || !image) return false;

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
  mp4Source.src = asset.mp4;
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
    const file = weatherAnimation(code, true);
    const anim = loadLottieAnimation(`week-icon-${i}`, file);
    if (anim) activeLotties.push(anim);

    if (i >= 4) {
      const bundle = getBomForecastBundle(CONFIG.weather?.bom?.locationName || "", i + 1, haStates);
      const iconRoot = document.getElementById(`week-icon-${i}`);
      if (iconRoot && (bundle.shortText || bundle.rainRange || bundle.uvCategory)) {
        iconRoot.title = [bundle.shortText, bundle.rainRange, bundle.uvCategory].filter(Boolean).join(" • ");
      }
    }
  });
}

function renderCinematic(data, hourlyIndex) {
  const current = data.current_weather;
  const daily = data.daily;
  const hourly = data.hourly || {};
  const anchorCondition = document.getElementById("weather-cine-condition");
  const anchorTemp = document.getElementById("weather-cine-temp");
  const anchorMeta = document.getElementById("weather-cine-meta");

  if (anchorCondition) anchorCondition.textContent = weatherText(current.weathercode);
  if (anchorTemp) anchorTemp.textContent = `${Math.round(current.temperature)}°`;

  const max = Math.round(daily.temperature_2m_max[0]);
  const min = Math.round(daily.temperature_2m_min[0]);
  const apparent = hourly?.apparent_temperature?.[hourlyIndex];
  if (anchorMeta) {
    const feels = apparent != null ? `Feels like ${Math.round(apparent)}°` : "";
    anchorMeta.textContent = `${feels}${feels ? " | " : ""}H ${max}° L ${min}°`;
  }

  renderNarrative({ current, hourly, hourlyIndex });
  renderTimeline({ current, hourly, hourlyIndex });
  renderPills({ current, hourly, hourlyIndex });
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

function renderTimeline({ hourly, hourlyIndex }) {
  const track = document.getElementById("weather-timeline-track");
  const timeline = document.getElementById("weather-timeline");
  if (!track || !timeline) return;

  if (!hourly?.time?.length) {
    track.innerHTML = "<div class=\"weather-timeline__item\">Hourly data unavailable.</div>";
    return;
  }

  const now = new Date();
  const endWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const indicesForRange = (start, end) =>
    hourly.time.reduce((acc, time, idx) => {
      const t = new Date(time);
      if (t < now || t > endWindow) return acc;
      if (withinHourRange(t.getHours(), start, end)) acc.push(idx);
      return acc;
    }, []);

  const buckets = [
    { key: "now", label: "Now", indices: hourlyIndex != null ? [hourlyIndex] : [] },
    { key: "evening", label: "Evening", indices: indicesForRange(18, 21) },
    { key: "night", label: "Night", indices: indicesForRange(22, 4) },
    { key: "morning", label: "Morning", indices: indicesForRange(5, 11) }
  ];

  const mostCommon = values => {
    if (!values?.length) return null;
    const counts = values.reduce((acc, v) => {
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  };

  track.innerHTML = "";
  let maxPop = 0;

  buckets.forEach((bucket, index) => {
    const temps = bucket.indices
      .map(i => hourly.temperature_2m?.[i])
      .filter(v => v != null);
    const avgTemp = mean(temps);
    const codes = bucket.indices
      .map(i => hourly.weathercode?.[i])
      .filter(v => v != null);
    const popValues = bucket.indices
      .map(i => hourly.precipitation_probability?.[i])
      .filter(v => v != null);
    const pop = popValues.length ? Math.max(...popValues) : 0;
    maxPop = Math.max(maxPop, pop);
    const reprCode = mostCommon(codes);
    const descriptor = pickDescriptor(reprCode, pop);
    const icon = pickIcon(reprCode, pop);

    const item = document.createElement("div");
    item.className = "weather-timeline__item";
    if (index === timelineIndex) item.classList.add("is-active");
    if (pop >= 50) {
      item.classList.add("has-rain-strong");
    } else if (pop >= 20) {
      item.classList.add("has-rain");
    }

    const phase = document.createElement("div");
    phase.className = "weather-timeline__phase";
    phase.textContent = bucket.label;

    const temp = document.createElement("div");
    temp.className = "weather-timeline__temp";
    temp.textContent = avgTemp != null ? `${Math.round(avgTemp)}°` : "--";

    const desc = document.createElement("div");
    desc.className = "weather-timeline__desc";
    if (icon) {
      const iconEl = document.createElement("span");
      iconEl.className = "weather-timeline__icon";
      iconEl.textContent = icon;
      desc.appendChild(iconEl);
    }
    const textEl = document.createElement("span");
    textEl.textContent = descriptor;
    desc.appendChild(textEl);

    item.appendChild(phase);
    item.appendChild(temp);
    item.appendChild(desc);
    track.appendChild(item);
  });

  timeline.classList.toggle("has-rain", maxPop >= 20);
  timeline.classList.toggle("has-rain-strong", maxPop >= 50);

  startTimelineAutoAdvance(buckets.length);
}

function startTimelineAutoAdvance(count) {
  if (timelineInterval) clearInterval(timelineInterval);
  if (count <= 1) return;
  if (document.body?.dataset?.view !== "weather") return;

  timelineIndex = 0;
  timelineInterval = setInterval(() => {
    const track = document.getElementById("weather-timeline-track");
    if (!track) return;
    const items = Array.from(track.children);
    if (!items.length) return;
    timelineIndex = (timelineIndex + 1) % items.length;
    items.forEach((item, idx) => {
      item.classList.toggle("is-active", idx === timelineIndex);
    });
  }, 20000);
}

function renderPills({ current, hourly, hourlyIndex }) {
  const windValue = document.getElementById("weather-pill-wind-value");
  const uvValue = document.getElementById("weather-pill-uv-value");
  const rainValue = document.getElementById("weather-pill-rain-value");
  const stormValue = document.getElementById("weather-pill-storm-value");
  const visValue = document.getElementById("weather-pill-visibility-value");

  const windSpeed = hourly?.windspeed_10m?.[hourlyIndex] ?? current?.windspeed ?? 0;
  const uvIndex = hourly?.uv_index?.[hourlyIndex];
  const pop = hourly?.precipitation_probability?.[hourlyIndex] ?? 0;
  const visibility = hourly?.visibility?.[hourlyIndex];
  const visibilityKm = visibility != null ? visibility / 1000 : null;
  const category = getBaseCategory(current?.weathercode);

  if (windValue) windValue.textContent = `${Math.round(windSpeed)} km/h`;
  if (uvValue) uvValue.textContent = uvIndex != null ? `${Math.round(uvIndex)}` : "--";
  if (rainValue) rainValue.textContent = `${Math.round(pop)}%`;
  if (stormValue) stormValue.textContent = category === "storm" ? "Alert" : "--";
  if (visValue) visValue.textContent = visibilityKm != null ? `${visibilityKm.toFixed(1)} km` : "--";

  const windShow = windSpeed >= 25;
  const windHide = windSpeed < 20;
  setPillVisibility("weather-pill-wind", windShow, windHide);

  const uvShow = uvIndex != null && uvIndex >= 6;
  const uvHide = uvIndex != null && uvIndex < 5;
  setPillVisibility("weather-pill-uv", uvShow, uvHide);

  const rainShow = pop >= 20;
  const rainHide = pop < 15;
  setPillVisibility("weather-pill-rain", rainShow, rainHide);

  const stormShow = category === "storm";
  const stormHide = category !== "storm";
  setPillVisibility("weather-pill-storm", stormShow, stormHide);

  const visShow = category === "fog" || (visibilityKm != null && visibilityKm <= 8);
  const visHide = category !== "fog" && (visibilityKm == null || visibilityKm > 8);
  setPillVisibility("weather-pill-visibility", visShow, visHide);
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
  const hourly = getBomHourlySeries(haStates);

  const summaryHash = JSON.stringify({
    warning: warnings.summary,
    fire: todayBundle.fireDanger,
    uv: todayBundle.uvMaxIndex,
    uvCategory: todayBundle.uvCategory,
    rainChance: todayBundle.rainChance,
    rainRange: todayBundle.rainRange,
    hourly: hourly.map((item) => item.value)
  });

  if (summaryHash === lastBomRenderHash) return;
  lastBomRenderHash = summaryHash;

  const riskStrip = document.getElementById("weather-risk-strip");
  const uvDial = document.getElementById("weather-uv-dial");
  const uvValue = document.getElementById("weather-uv-dial-value");
  const uvMeta = document.getElementById("weather-uv-dial-meta");
  const rainCard = document.getElementById("weather-rain-range-card");
  const rainMeta = document.getElementById("weather-rain-range-meta");
  const rainSparkline = document.getElementById("weather-rain-hourly");

  if (riskStrip) {
    const badges = [];
    if (warnings.summary) badges.push(`<span class="weather-risk-badge weather-risk-badge--warning">⚠ ${warnings.summary}</span>`);
    if (todayBundle.fireDanger) badges.push(`<span class="weather-risk-badge">🔥 ${todayBundle.fireDanger}</span>`);
    if (todayBundle.uvMaxIndex != null || todayBundle.uvCategory) {
      const uvText = todayBundle.uvMaxIndex != null ? `${todayBundle.uvCategory || "UV"} ${Math.round(todayBundle.uvMaxIndex)}` : todayBundle.uvCategory;
      badges.push(`<span class="weather-risk-badge">☀ ${uvText}</span>`);
    }
    if (todayBundle.rainChance != null || todayBundle.rainRange) {
      const chance = todayBundle.rainChance != null ? `${Math.round(todayBundle.rainChance)}%` : "Rain";
      const range = todayBundle.rainRange ? ` ${todayBundle.rainRange}` : "";
      badges.push(`<span class="weather-risk-badge">☔ ${chance}${range}</span>`);
    }
    riskStrip.innerHTML = badges.slice(0, 4).join("") || `<span class="weather-risk-empty">No active weather risks</span>`;
  }

  const uvDialData = normalizeUvDial(todayBundle.uvMaxIndex, todayBundle.uvCategory);
  if (uvDial) {
    uvDial.style.setProperty("--uv-deg", `${uvDialData.degrees}deg`);
  }
  setTextIfChanged(uvValue, uvDialData.uvIndex != null ? `${uvDialData.uvIndex}` : "--");
  setTextIfChanged(uvMeta, uvDialData.label);

  const rainChanceText = todayBundle.rainChance != null ? `${Math.round(todayBundle.rainChance)}% chance` : "Chance unavailable";
  const rainRangeText = todayBundle.rainRange || "Range unavailable";
  setTextIfChanged(rainCard, rainChanceText);
  setTextIfChanged(rainMeta, rainRangeText);

  if (rainSparkline) {
    if (hourly.length) {
      const maxValue = Math.max(...hourly.map((item) => item.value), 1);
      rainSparkline.innerHTML = hourly
        .map((item) => {
          const height = Math.max(6, Math.round((item.value / maxValue) * 36));
          return `<span class="weather-rain-hourly__bar" style="height:${height}px" title="${item.label}: ${item.value}mm"></span>`;
        })
        .join("");
    } else {
      rainSparkline.innerHTML = "";
    }
  }

  bomLog("summary", {
    warning: warnings.summary,
    fireDanger: todayBundle.fireDanger,
    uvCategory: todayBundle.uvCategory,
    uvMaxIndex: todayBundle.uvMaxIndex,
    rainChance: todayBundle.rainChance,
    rainRange: todayBundle.rainRange
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

function setPillVisibility(id, shouldShow, shouldHide) {
  const pill = document.getElementById(id);
  if (!pill) return;

  const now = Date.now();
  const state = pillState[id] || { visible: false, lastShown: 0, belowCount: 0 };

  if (shouldShow) {
    state.belowCount = 0;
  } else if (shouldHide) {
    state.belowCount += 1;
  } else {
    state.belowCount = 0;
  }

  if (shouldShow && !state.visible) {
    state.visible = true;
    state.lastShown = now;
    pill.classList.add("is-visible");
  }

  if (
    !shouldShow &&
    state.visible &&
    shouldHide &&
    state.belowCount >= 2 &&
    now - state.lastShown > PILL_MIN_VISIBLE_MS
  ) {
    state.visible = false;
    pill.classList.remove("is-visible");
  }

  pillState[id] = state;
}

export function stopWeatherView() {
  clearLotties();
  stopWeatherMotion();
  if (timelineInterval) clearInterval(timelineInterval);
  timelineInterval = null;
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
