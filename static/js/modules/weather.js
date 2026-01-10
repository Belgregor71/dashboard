import { WEATHER_LAT, WEATHER_LON, WEATHER_ANIMATIONS } from "../config/config.js";
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

  if (tempEl) tempEl.textContent = `${Math.round(current.temperature)}°`;

  const isDay = isDaytime(data);
  const anim = WEATHER_ANIMATIONS[current.weathercode];
  const file = anim ? (isDay ? anim.day : anim.night) : (isDay ? "clear-day.json" : "clear-night.json");

  loadLottieAnimation("weather-lottie", file);

  if (descEl) descEl.textContent = describeWeatherCode(current.weathercode);

  const max = Math.round(daily.temperature_2m_max[0]);
  const min = Math.round(daily.temperature_2m_min[0]);
  if (rangeEl) rangeEl.textContent = `H ${max}°  L ${min}°`;
}

function describeWeatherCode(code) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Mostly Clear";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 67) return "Drizzle";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95) return "Storms";
  return "Weather";
}
