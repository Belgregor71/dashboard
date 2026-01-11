// static/js/modules/weather.js

import { WEATHER_LAT, WEATHER_LON } from "../config/config.js";
import {
  getWeatherAnimationFilename,
  getBeaufortNumber,
  getWindBeaufortFilename,
  describeWindDirection
} from "../config/weather-animations.js";
import { loadLottieAnimation } from "../helpers/lottie.js";

/* ------------------------------------------------------------
   DAYTIME CHECK
------------------------------------------------------------ */
function isDaytime(data) {
  const now = new Date();
  const sunrise = new Date(data.daily.sunrise[0]);
  const sunset = new Date(data.daily.sunset[0]);
  return now >= sunrise && now < sunset;
}

/* ------------------------------------------------------------
   FETCH WEATHER
------------------------------------------------------------ */
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

/* ------------------------------------------------------------
   RENDER CURRENT WEATHER PANEL
------------------------------------------------------------ */
function renderWeather(data) {
  if (!data || !data.current_weather) return;

  const panel = document.getElementById("current-weather-panel");
  const iconDiv = document.getElementById("weather-lottie");
  const tempEl = document.getElementById("current-temp");
  const descEl = document.getElementById("current-conditions");
  const rangeEl = document.getElementById("weather-range");

  const current = data.current_weather;
  const daily = data.daily;

  /* Temperature */
  tempEl.textContent = `${Math.round(current.temperature)}°`;

  /* Main weather animation */
  const isDay = isDaytime(data);
  const mainFilename = getWeatherAnimationFilename(current.weathercode, isDay);
  loadLottieAnimation("weather-lottie", mainFilename);

  /* Description */
  descEl.textContent = describeWeatherCode(current.weathercode);

  /* High / Low */
  const max = Math.round(daily.temperature_2m_max[0]);
  const min = Math.round(daily.temperature_2m_min[0]);
  rangeEl.textContent = `H ${max}°  L ${min}°`;

  /* Wind */
  renderWind(current);
}

/* ------------------------------------------------------------
   WIND ROW
------------------------------------------------------------ */
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

  const windKmh = current.windspeed;
  const beaufort = getBeaufortNumber(windKmh);
  const windDirText = describeWindDirection(current.winddirection);

  const text = windDirText
    ? `${Math.round(windKmh)} km/h ${windDirText}`
    : `${Math.round(windKmh)} km/h`;

  const textEl = document.getElementById("weather-wind-text");
  textEl.textContent = text;

  const filename = getWindBeaufortFilename(beaufort);
  loadLottieAnimation("weather-wind-icon", filename);
}

/* ------------------------------------------------------------
   WEATHER CODE → TEXT
------------------------------------------------------------ */
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

/* ------------------------------------------------------------
   WEEKLY WEATHER ICONS (NO HTML CREATION)
------------------------------------------------------------ */
export function renderWeeklyWeatherIcons(daily) {
  if (!daily || !daily.weathercode || !daily.weathercode.length) return;

  const codes = daily.weathercode;
  const maxTemps = daily.temperature_2m_max;
  const minTemps = daily.temperature_2m_min;

  const days = Math.min(7, codes.length);

  for (let i = 0; i < days; i++) {
    /* Weather icon */
    const filename = getWeatherAnimationFilename(codes[i], true);
    loadLottieAnimation(`week-icon-${i}`, filename);

    /* High/Low */
    const rangeEl = document.getElementById(`week-range-${i}`);
    if (rangeEl) {
      rangeEl.textContent = `H ${Math.round(maxTemps[i])}°  L ${Math.round(minTemps[i])}°`;
    }
  }
}
