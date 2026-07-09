import { WEATHER_LAT, WEATHER_LON } from "../../config/config.js";

// Open-Meteo's air-quality API covers Brisbane (verified). Pollen is
// deliberately not read here — that model is Europe-only and returns null
// for SE Queensland, so there's no honest value to show.
//
// US AQI bands (EPA scale). The band key drives the bar colour in CSS
// (metric-aqi[data-aqi-band=...] in weather.css) so no colour is set from JS.
const AQI_BANDS = [
  { max: 50,       key: "good",           label: "Good" },
  { max: 100,      key: "moderate",       label: "Moderate" },
  { max: 150,      key: "sensitive",      label: "Sensitive groups" },
  { max: 200,      key: "unhealthy",      label: "Unhealthy" },
  { max: 300,      key: "very-unhealthy", label: "Very unhealthy" },
  { max: Infinity, key: "hazardous",      label: "Hazardous" }
];

// Bar fills across the 0–300 "meaningful" range; beyond that it's pinned full.
const AQI_BAR_MAX = 300;

function classifyAqi(aqi) {
  return AQI_BANDS.find(band => aqi <= band.max) || AQI_BANDS[AQI_BANDS.length - 1];
}

async function fetchAirQuality() {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
    `&current=us_aqi,pm2_5&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Air quality fetch failed (${res.status})`);
  return res.json();
}

export async function refreshAirQuality() {
  const card = document.getElementById("weather-aqi-card");
  if (!card) return; // weather view not in the DOM

  const valueEl = document.getElementById("weather-aqi-value");
  const metaEl = document.getElementById("weather-aqi-meta");
  const barSpan = document.querySelector("#weather-aqi-bar span");

  try {
    const data = await fetchAirQuality();
    const aqi = data?.current?.us_aqi;
    const pm25 = data?.current?.pm2_5;

    if (!Number.isFinite(aqi)) {
      if (valueEl) valueEl.textContent = "--";
      if (metaEl) metaEl.textContent = "";
      card.removeAttribute("data-aqi-band");
      if (barSpan) card.style.setProperty("--aqi-pct", "0%");
      return;
    }

    const band = classifyAqi(aqi);
    if (valueEl) valueEl.textContent = `${Math.round(aqi)}`;
    if (metaEl) {
      metaEl.textContent = Number.isFinite(pm25)
        ? `${band.label} · PM2.5 ${pm25.toFixed(1)}`
        : band.label;
    }
    card.dataset.aqiBand = band.key;
    card.style.setProperty("--aqi-pct", `${Math.min(100, Math.round((aqi / AQI_BAR_MAX) * 100))}%`);
  } catch (err) {
    // Non-fatal: leave whatever the card last showed rather than blanking it.
    console.warn("Air quality unavailable:", err.message);
  }
}
