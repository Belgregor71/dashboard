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
import { startWeatherMotion, stopWeatherMotion } from "../../weatherMotion.js";
import { categoryForWeatherCode } from "../../weatherPrompts.js";

let activeLotties = [];
let cachedDaily = null;
let cachedWeather = null;
let lastWeatherCode = null;
let narrativeTimer = null;
let timelineInterval = null;
let timelineIndex = 0;
const pillState = {};

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
  }
};

const PILL_MIN_VISIBLE_MS = 5 * 60 * 1000;

function clearLotties() {
  activeLotties.forEach(anim => anim.destroy?.());
  activeLotties = [];
}

function cinematicCategoryForCode(code) {
  const category = categoryForWeatherCode(code);
  if (category === "mostly_clear" || category === "clear") return "clear";
  if (category === "cloudy") return "cloudy";
  if (category === "drizzle" || category === "rain" || category === "showers") return "rain";
  if (category === "storms") return "storm";
  if (category === "fog") return "fog";
  if (category === "snow") return "cloudy";
  return "cloudy";
}

function applyCinematicBackground(code) {
  if (code == null) return;
  const video = document.getElementById("weather-bg-video");
  const webmSource = document.getElementById("weather-bg-webm");
  const mp4Source = document.getElementById("weather-bg-mp4");
  const image = document.getElementById("weather-bg-image");

  if (!video || !webmSource || !mp4Source || !image) return;

  const category = cinematicCategoryForCode(code);
  const asset = BACKGROUND_ASSETS[category] || BACKGROUND_ASSETS.cloudy;

  if (video.dataset.category === category) return;

  video.dataset.category = category;
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
}

function syncWeatherMotion(code) {
  if (code == null) return;
  applyCinematicBackground(code);

  if (document.body?.dataset?.view === "weather") {
    const category = cinematicCategoryForCode(code);
    if (category === "storm") {
      startWeatherMotion({ code });
    } else {
      stopWeatherMotion();
    }
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

  const category = cinematicCategoryForCode(code);
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
  const category = cinematicCategoryForCode(code);
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

  lastWeatherCode = current.weathercode;
  syncWeatherMotion(lastWeatherCode);

  const anim = loadLottieAnimation("weather-lottie", animFile);
  if (anim) activeLotties.push(anim);

  renderCinematic(data, hourlyIndex);
}

function renderWeekly(daily) {
  if (!daily?.weathercode) return;

  daily.weathercode.slice(0, 7).forEach((code, i) => {
    const file = weatherAnimation(code, true);
    const anim = loadLottieAnimation(`week-icon-${i}`, file);
    if (anim) activeLotties.push(anim);
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
}

function renderNarrative({ current, hourly, hourlyIndex }) {
  const narrativeEl = document.getElementById("weather-narrative");
  if (!narrativeEl) return;

  const pop = hourly?.precipitation_probability?.[hourlyIndex] ?? 0;
  const uvIndex = hourly?.uv_index?.[hourlyIndex];
  const wind = hourly?.windspeed_10m?.[hourlyIndex] ?? current?.windspeed ?? 0;
  const visibility = hourly?.visibility?.[hourlyIndex];
  const category = cinematicCategoryForCode(current?.weathercode);
  const hour = new Date().getHours();

  let text = "";
  if (category === "storm") {
    text = "Thunderstorms in the area.";
  } else if (category === "fog" || (visibility != null && visibility < 6000)) {
    text = "Low visibility. Keep lights on.";
  } else if (pop >= 60) {
    text = "Rain likely later. Plan indoor time.";
  } else if (pop >= 30) {
    text = "Showers possible later.";
  } else if (uvIndex != null && uvIndex >= 7 && hour >= 9 && hour <= 16) {
    text = "Bright daylight. UV is high.";
  } else if (wind >= 25) {
    text = "Breezy air moving through.";
  } else if (category === "clear" && hour >= 18) {
    text = "Calm evening. No rain expected.";
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
  const visValue = document.getElementById("weather-pill-visibility-value");

  const windSpeed = hourly?.windspeed_10m?.[hourlyIndex] ?? current?.windspeed ?? 0;
  const uvIndex = hourly?.uv_index?.[hourlyIndex];
  const visibility = hourly?.visibility?.[hourlyIndex];
  const visibilityKm = visibility != null ? visibility / 1000 : null;
  const category = cinematicCategoryForCode(current?.weathercode);

  if (windValue) windValue.textContent = `${Math.round(windSpeed)} km/h`;
  if (uvValue) uvValue.textContent = uvIndex != null ? `${Math.round(uvIndex)}` : "--";
  if (visValue) visValue.textContent = visibilityKm != null ? `${visibilityKm.toFixed(1)} km` : "--";

  const windShow = windSpeed >= 25;
  const windHide = windSpeed <= 20;
  setPillVisibility("weather-pill-wind", windShow, windHide);

  const uvShow = uvIndex != null && uvIndex >= 6;
  const uvHide = uvIndex != null && uvIndex <= 4;
  setPillVisibility("weather-pill-uv", uvShow, uvHide);

  const visShow = category === "fog" || (visibilityKm != null && visibilityKm <= 5);
  const visHide = category !== "fog" && (visibilityKm == null || visibilityKm >= 7);
  setPillVisibility("weather-pill-visibility", visShow, visHide);
}

function setPillVisibility(id, shouldShow, shouldHide) {
  const pill = document.getElementById(id);
  if (!pill) return;

  const now = Date.now();
  const state = pillState[id] || { visible: false, lastShown: 0 };

  if (shouldShow && !state.visible) {
    state.visible = true;
    state.lastShown = now;
    pill.classList.add("is-visible");
  }

  if (!shouldShow && state.visible && shouldHide && now - state.lastShown > PILL_MIN_VISIBLE_MS) {
    state.visible = false;
    pill.classList.remove("is-visible");
  }

  pillState[id] = state;
}

function rerenderWeeklyFromCache() {
  if (!cachedDaily) return;
  renderWeekly(cachedDaily);
}

/* 🔁 Cleanup on view change (prevents memory leaks) */
on("view:changed", () => {
  clearLotties();
  if (document.body?.dataset?.view !== "weather") {
    stopWeatherMotion();
    if (timelineInterval) clearInterval(timelineInterval);
    timelineInterval = null;
    if (narrativeTimer) clearTimeout(narrativeTimer);
    narrativeTimer = null;
    const video = document.getElementById("weather-bg-video");
    video?.pause();
  }
  if (cachedWeather) {
    renderCurrent(cachedWeather);
    renderWeekly(cachedWeather.daily);
  }
});

on("calendar:weekRendered", () => {
  rerenderWeeklyFromCache();
});
