import { fetchWeatherData } from "./api.js";
import {
  isDaytime,
  weatherText,
  weatherAnimation
} from "./mapper.js";
import { loadLottieAnimation } from "../../helpers/lottie.js";
import { on } from "../../core/eventBus.js";

let activeLotties = [];

function clearLotties() {
  activeLotties.forEach(anim => anim.destroy?.());
  activeLotties = [];
}

export async function startWeather() {
  try {
    const data = await fetchWeatherData();
    renderCurrent(data);
    renderWeekly(data.daily);
  } catch (e) {
    console.error("Weather render error:", e);
  }
}

function renderCurrent(data) {
  const current = data.current_weather;
  const daily = data.daily;

  const tempEl = document.getElementById("current-temp");
  const descEl = document.getElementById("current-conditions");
  const rangeEl = document.getElementById("weather-range");
  const windEl = document.getElementById("weather-wind");

  if (tempEl) tempEl.textContent = `${Math.round(current.temperature)}°`;
  if (descEl) descEl.textContent = weatherText(current.weathercode);

  const max = Math.round(daily.temperature_2m_max[0]);
  const min = Math.round(daily.temperature_2m_min[0]);
  if (rangeEl) rangeEl.textContent = `H ${max}°  L ${min}°`;

  if (windEl && current.windspeed != null) {
    windEl.textContent = `${Math.round(current.windspeed)} km/h`;
  }

  const isDay = isDaytime(data);
  const animFile = weatherAnimation(current.weathercode, isDay);

  const anim = loadLottieAnimation("weather-lottie", animFile);
  if (anim) activeLotties.push(anim);
}

function renderWeekly(daily) {
  if (!daily?.weathercode) return;

  daily.weathercode.slice(0, 7).forEach((code, i) => {
    const file = weatherAnimation(code, true);
    const anim = loadLottieAnimation(`week-icon-${i}`, file);
    if (anim) activeLotties.push(anim);
  });
}

/* 🔁 Cleanup on view change (prevents memory leaks) */
on("view:changed", () => {
  clearLotties();
});
