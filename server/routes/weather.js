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
import { history as weatherRecord, houseDay } from "../services/weatherHistory.js";
import { buildClaims, MIN_DAYS } from "../services/lately.js";

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

/* What the house actually remembers about the sky, and what that record will
   support it saying (AUGUST-IMPROVEMENTS.md §4).

   ⚠ The verdict is computed HERE rather than handed back as raw rows, for the
   same reason routes/censusFeatures.js computes its report on GET: one curl
   from anywhere on the LAN has to answer the question, and handing back a list
   with a suggestion to compare it by hand is how an instrument becomes unread
   telemetry. `claims.ready` is false and `records` empty until the record is
   MIN_DAYS deep — that refusal IS the answer on a fresh box, not a failure.

   Never 502s: an unreadable record is an empty one. The house has no past yet,
   which is a fact about the house and not an error. */
router.get("/api/weather/lately", async (_req, res) => {
  try {
    const record = await weatherRecord();
    res.json({
      minDays: MIN_DAYS,
      claims: buildClaims(record, { today: houseDay() }),
      history: record
    });
  } catch (error) {
    console.error("Weather lately read error:", error?.message || error);
    res.json({ minDays: MIN_DAYS, claims: buildClaims([], { today: houseDay() }), history: [] });
  }
});

export default router;
