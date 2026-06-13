// static/js/modules/weather.js

import { WEATHER_LAT, WEATHER_LON } from "../config/config.js";
import {
  getWeatherAnimationFilename,
  getBeaufortNumber,
  getWindBeaufortFilename,
  describeWindDirection
} from "../config/weather-animations.js";
import { loadLottieAnimation } from "../helpers/lottie.js";

const WX_DEBUG = false;

function isDaytime(data) {
  const now = new Date();
  const sunrise = new Date(data.daily.sunrise[0]);
  const sunset = new Date(data.daily.sunset[0]);
  return now >= sunrise && now < sunset;
}

export async function fetchWeather() {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}` +
      `&longitude=${WEATHER_LON}` +
      `&current_weather=true` +
      `&hourly=temperature_2m` +
      `&daily=temperature_2m_max,temperature_2m_min,weathercode,sunrise,sunset` +
      `&timezone=auto`;

    const res = await fetch(url);
    const data = await res.json();

    renderWeather(data);
    renderWeeklyWeatherIcons(data.daily);
  } catch (err) {
    console.error("Weather error:", err);
  }
}

function renderWeather(data) {
  if (!data || !data.current_weather) return;

  const tempEl = document.getElementById("current-temp");
  const descEl = document.getElementById("current-conditions");
  const rangeEl = document.getElementById("weather-range");

  const current = data.current_weather;
  const daily = data.daily;

  // Temperature
  tempEl.textContent = `${Math.round(current.temperature)}°`;

  // Main weather animation (uses day/night + full mapping)
  const isDay = isDaytime(data);
  const mainFilename = getWeatherAnimationFilename(current.weathercode, isDay);
  loadLottieAnimation("weather-lottie", mainFilename);

  // Text description
  descEl.textContent = describeWeatherCode(current.weathercode);

  // Today's high/low
  const max = Math.round(daily.temperature_2m_max[0]);
  const min = Math.round(daily.temperature_2m_min[0]);
  rangeEl.textContent = `H ${max}°  L ${min}°`;

  // Wind (km/h + Beaufort icon)
  renderWind(current);

  renderTemperatureCurve(data);
}

/**
 * Render wind speed + Beaufort icon into the main weather panel.
 * Element is created dynamically if missing.
 */
function renderWind(current) {
  if (current.windspeed == null) return;

  const windKmh = current.windspeed; // km/h
  const beaufort = getBeaufortNumber(windKmh);
  const windDirText = describeWindDirection(current.winddirection);

  const text = windDirText
    ? `${Math.round(windKmh)} km/h ${windDirText}`
    : `${Math.round(windKmh)} km/h`;

  const textEl = document.getElementById("weather-wind-text");
  if (textEl) textEl.textContent = text;

  const filename = getWindBeaufortFilename(beaufort);
  loadLottieAnimation("weather-wind-icon", filename);
}

function describeWeatherCode(code) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Mostly clear";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95) return "Storms";
  return "Weather";
}

function renderTemperatureCurve(data) {
  const wrapEl = document.getElementById("temp-curve-wrap");
  const curveEl = document.getElementById("temp-curve");
  const rangeEl = document.getElementById("temp-curve-range");

  if (!wrapEl || !curveEl) return;

  const hourly = data?.hourly;
  if (!hourly?.temperature_2m || !hourly?.time) {
    wrapEl.classList.add("is-hidden");
    curveEl.innerHTML = "";
    if (rangeEl) rangeEl.textContent = "";
    return;
  }

  const times = hourly.time;
  const temps = hourly.temperature_2m;
  const now = data?.current_weather?.time
    ? new Date(data.current_weather.time)
    : new Date();

  const nowMs = now.getTime();
  const thresholdMs = nowMs - 30 * 60 * 1000;
  let startIndex = times.findIndex((time) => {
    const tMs = new Date(time).getTime();
    return Number.isFinite(tMs) && tMs >= thresholdMs;
  });
  if (startIndex === -1) startIndex = 0;

  const windowSize = 12;
  if (startIndex + windowSize > times.length) {
    startIndex = Math.max(0, times.length - windowSize);
  }

  const windowTimes = times.slice(startIndex, startIndex + windowSize);
  const windowTempsRaw = temps.slice(startIndex, startIndex + windowSize);
  const windowData = windowTempsRaw
    .map((temp, index) => ({
      temp,
      time: windowTimes[index]
    }))
    .filter((entry) => Number.isFinite(entry.temp));

  const windowTemps = windowData.map((entry) => entry.temp);

  if (windowTemps.length < 2) {
    wrapEl.classList.add("is-hidden");
    curveEl.innerHTML = "";
    if (rangeEl) rangeEl.textContent = "";
    if (WX_DEBUG) {
      console.log("WX curve hidden", {
        startIndex,
        windowTemps,
        hidden: true
      });
    }
    return;
  }

  wrapEl.classList.remove("is-hidden");

  const minTemp = Math.min(...windowTemps);
  const maxTemp = Math.max(...windowTemps);
  const paddedMin = minTemp - 1;
  const paddedMax = maxTemp + 1;
  const tempRange = Math.max(1, paddedMax - paddedMin);

  const width = 720;
  const height = 180;
  const paddingX = 32;
  const paddingY = 24;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingY * 2;

  const points = windowTemps.map((temp, index) => {
    const x =
      paddingX + (plotWidth / (windowTemps.length - 1)) * index;
    const y =
      paddingY + ((paddedMax - temp) / tempRange) * plotHeight;
    return { x, y, temp, time: windowData[index]?.time };
  });

  const linePath = buildSmoothPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1].x},${
    height - paddingY
  } L ${points[0].x},${height - paddingY} Z`;

  const minIndex = windowTemps.indexOf(minTemp);
  const maxIndex = windowTemps.indexOf(maxTemp);

  const labelMarkup = [
    renderLabel(points[0], "NOW", "label-now"),
    renderLabel(points[minIndex], "MIN", "label-min"),
    renderLabel(points[maxIndex], "MAX", "label-max")
  ].join("");

  const dotsMarkup = points
    .map(
      (point) =>
        `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(
          1
        )}" r="2.2" class="temp-curve__dot" />`
    )
    .join("");

  curveEl.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Temperature curve for the next 12 hours">
      <defs>
        <linearGradient id="temp-curve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <line x1="${points[0].x}" y1="${paddingY}" x2="${points[0].x}" y2="${
    height - paddingY
  }" class="temp-curve__now-line" />
      <path d="${areaPath}" class="temp-curve__area" />
      <path d="${linePath}" class="temp-curve__line" />
      ${dotsMarkup}
      ${labelMarkup}
    </svg>
  `;

  if (rangeEl) {
    rangeEl.textContent = `Min ${Math.round(minTemp)}° / Max ${Math.round(
      maxTemp
    )}°`;
  }

  if (WX_DEBUG) {
    console.log("WX curve rendered", {
      startIndex,
      windowTemps,
      minTemp,
      maxTemp,
      hidden: false
    });
  }
}

function buildSmoothPath(points) {
  if (!points.length) return "";

  const path = [`M ${points[0].x},${points[0].y}`];

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path.push(
      `C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(
        2
      )},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
    );
  }

  return path.join(" ");
}

function renderLabel(point, text, className) {
  if (!point) return "";
  const labelOffsetY = 12;
  const labelOffsetX = text === "NOW" ? 0 : 4;
  const anchor = text === "NOW" ? "start" : "middle";
  return `
    <text x="${(point.x + labelOffsetX).toFixed(
      1
    )}" y="${(point.y - labelOffsetY).toFixed(
    1
  )}" text-anchor="${anchor}" class="temp-curve__label ${className}">
      ${text}
    </text>
  `;
}

/* ------------------------------------------------------------------
   WEEKLY WEATHER ICONS FOR WEEK STRIP (uses same mapping)
-------------------------------------------------------------------*/
export function renderWeeklyWeatherIcons(daily) {
  if (!daily || !daily.weathercode || !daily.weathercode.length) return;

  const weeklyList = document.getElementById("weekly-list");
  weeklyList.innerHTML = ""; // clear old content

  const codes = daily.weathercode;
  const maxTemps = daily.temperature_2m_max;
  const minTemps = daily.temperature_2m_min;

  const days = Math.min(7, codes.length);

  for (let i = 0; i < days; i++) {
    const li = document.createElement("li");
    li.className = "week-day-block";

    // Icon container
    const iconDiv = document.createElement("div");
    iconDiv.className = "week-weather-icon";
    iconDiv.id = `week-icon-${i}`;

    // Day label
    const dayDiv = document.createElement("div");
    dayDiv.className = "week-day";
    dayDiv.id = `week-day-${i}`;
    dayDiv.textContent = formatDayLabel(i);

    // High/low
    const rangeDiv = document.createElement("div");
    rangeDiv.className = "week-range";
    rangeDiv.id = `week-range-${i}`;
    rangeDiv.textContent = `H ${Math.round(maxTemps[i])}°  L ${Math.round(minTemps[i])}°`;

    li.appendChild(iconDiv);
    li.appendChild(dayDiv);
    li.appendChild(rangeDiv);

    weeklyList.appendChild(li);

    // Load icon
    const filename = getWeatherAnimationFilename(codes[i], true);
    loadLottieAnimation(`week-icon-${i}`, filename);
  }
}

function formatDayLabel(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString("en-AU", { weekday: "short" });
}
