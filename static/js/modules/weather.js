// static/js/modules/weather.js

import { WEATHER_LAT, WEATHER_LON } from "../config/config.js";
import {
  getWeatherAnimationFilename,
  getBeaufortNumber,
  getWindBeaufortFilename,
  describeWindDirection
} from "../config/weather-animations.js";
import { loadLottieAnimation } from "../helpers/lottie.js";

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
  if (tempEl) tempEl.textContent = `${Math.round(current.temperature)}°`;

  // Main weather animation (uses day/night + full mapping)
  const isDay = isDaytime(data);
  const mainFilename = getWeatherAnimationFilename(
    current.weathercode,
    isDay
  );
  loadLottieAnimation("weather-lottie", mainFilename);

  // Text description
  if (descEl) descEl.textContent = describeWeatherCode(current.weathercode);

  // Today's high/low
  const max = Math.round(daily.temperature_2m_max[0]);
  const min = Math.round(daily.temperature_2m_min[0]);
  if (rangeEl) rangeEl.textContent = `H ${max}°  L ${min}°`;

  // Wind (km/h + Beaufort icon)
  renderWind(current);
}

/**
 * Render wind speed + Beaufort icon into the main weather panel.
 * No HTML changes required — element is created dynamically if missing.
 */
function renderWind(current) {
  const panel = document.getElementById("current-weather-panel");
  if (!panel || current.windspeed == null) return;

  let windRow = document.getElementById("weather-wind");
  if (!windRow) {
    windRow = document.createElement("div");
    windRow.id = "weather-wind";
    windRow.className = "weather-wind";

    const iconDiv = document.createElement("div");
    iconDiv.id = "weather-wind-icon";
    iconDiv.className = "weather-wind-icon";

    const textSpan = document.createElement("span");
    textSpan.id = "weather-wind-text";

    windRow.appendChild(iconDiv);
    windRow.appendChild(textSpan);

    panel.appendChild(windRow);
  }

  const windKmh = current.windspeed; // Open-Meteo uses km/h
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

/* ------------------------------------------------------------------
   WEEKLY WEATHER ICONS FOR WEEK STRIP (uses same mapping)
-------------------------------------------------------------------*/

export function renderWeeklyWeatherIcons(daily) {
  if (!daily || !daily.weathercode || !daily.weathercode.length) return;

  const codes = daily.weathercode;
  const days = Math.min(7, codes.length);

  for (let i = 0; i < days; i++) {
    const code = codes[i];
    // For the week strip we always show the "day" variant,
    // since it's a daytime overview of the next 7 days.
    const filename = getWeatherAnimationFilename(code, true);

    const iconId = `week-icon-${i}`;
    try {
      loadLottieAnimation(iconId, filename);
    } catch (e) {
      console.error("Weekly weather icon error:", e);
    }
  }
}
