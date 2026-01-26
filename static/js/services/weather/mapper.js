import { getWeatherAnimationFilename } from "../../config/weather-animations.js";

export function isDaytime(data) {
  const now = new Date();
  const sunrise = new Date(data.daily.sunrise[0]);
  const sunset = new Date(data.daily.sunset[0]);
  return now >= sunrise && now < sunset;
}

export function weatherText(code) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Mostly Clear";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 67) return "Drizzle";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 85 || code === 86) return "Snow Showers";
  if (code >= 95) return "Storms";
  return "Weather";
}

export function weatherAnimation(code, isDay) {
  return getWeatherAnimationFilename(code, isDay);
}
