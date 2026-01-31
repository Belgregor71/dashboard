import { WEATHER_LAT, WEATHER_LON } from "../../config/config.js";

export async function fetchWeatherData() {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${WEATHER_LAT}` +
    `&longitude=${WEATHER_LON}` +
    `&current_weather=true` +
    `&daily=temperature_2m_max,temperature_2m_min,weathercode,sunrise,sunset` +
    `&hourly=temperature_2m,apparent_temperature,weathercode,relativehumidity_2m,` +
    `precipitation_probability,surface_pressure,windspeed_10m,uv_index,visibility,` +
    `dewpoint_2m,cloudcover` +
    `&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather fetch failed");

  return res.json();
}
