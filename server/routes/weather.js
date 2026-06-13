import express from "express";
import { compileSchema } from "../middleware/validate.js";
import { weatherNowSchema, weatherForecastSchema } from "../schemas/weather.js";
import {
  getWeatherNormalized,
  weatherFallbackNow,
  weatherFallbackForecast
} from "../services/weatherService.js";

const router = express.Router();

const validateWeatherNow = compileSchema(weatherNowSchema);
const validateWeatherForecast = compileSchema(weatherForecastSchema);

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

export default router;
