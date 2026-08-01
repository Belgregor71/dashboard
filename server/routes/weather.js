import express from "express";
import { compileDataSchema } from "../middleware/validate.js";
import { weatherNowSchema, weatherForecastSchema } from "../schemas/weather.js";
import {
  getWeatherNormalized,
  weatherFallbackNow,
  weatherFallbackForecast,
  fetchWeatherRaw,
  normalizeNowcast
} from "../services/weatherService.js";

const router = express.Router();

const validateWeatherNow = compileDataSchema(weatherNowSchema);
const validateWeatherForecast = compileDataSchema(weatherForecastSchema);

router.get("/api/weather/now", async (_req, res) => {
  const lat = Number(process.env.WEATHER_LAT);
  const lon = Number(process.env.WEATHER_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.json(weatherFallbackNow());
    return;
  }
  try {
    const { now } = await getWeatherNormalized({
      lat,
      lon,
      validateNow: validateWeatherNow,
      validateForecast: validateWeatherForecast
    });
    res.json(now);
  } catch (error) {
    console.error("Weather now upstream error:", error?.message || error);
    res.status(502).json(weatherFallbackNow());
  }
});

router.get("/api/weather/forecast", async (_req, res) => {
  const lat = Number(process.env.WEATHER_LAT);
  const lon = Number(process.env.WEATHER_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.json(weatherFallbackForecast());
    return;
  }
  try {
    const { forecast } = await getWeatherNormalized({
      lat,
      lon,
      validateNow: validateWeatherNow,
      validateForecast: validateWeatherForecast
    });
    res.json(forecast);
  } catch (error) {
    console.error("Weather forecast upstream error:", error?.message || error);
    res.status(502).json(weatherFallbackForecast());
  }
});

// Phase 3 nowcast: the next short-range precip window (or null). Always JSON,
// degrades to { nowcast: null } when coords are missing or upstream is down —
// the predictive rain-incoming rule treats null as "no rain coming".
router.get("/api/weather/nowcast", async (_req, res) => {
  const lat = Number(process.env.WEATHER_LAT);
  const lon = Number(process.env.WEATHER_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.json({ nowcast: null });
    return;
  }
  try {
    const raw = await fetchWeatherRaw({ lat, lon });
    res.json({ nowcast: normalizeNowcast(raw) });
  } catch (error) {
    console.error("Weather nowcast upstream error:", error?.message || error);
    res.status(502).json({ nowcast: null });
  }
});

export default router;
