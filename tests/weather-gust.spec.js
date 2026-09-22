import { test, expect } from "@playwright/test";
import http from "node:http";
import { compileDataSchema, validateData } from "../server/middleware/validate.js";
import { weatherNowSchema } from "../server/schemas/weather.js";
import {
  fetchWeatherRaw, normalizeWeatherNow, normalizeBomNow, weatherFallbackNow
} from "../server/services/weatherService.js";

/* ═══════════════════════════════════════════════════════════════════════════
   GUSTS ON /api/weather/now — `wind_gust_kph`, for the field's gust term
   (features.v3FieldCauses, Living Window 2.0 Stage 3).

   What this file is here to catch:
     · the request never ASKS for windgusts_10m  → every gust is null forever,
                                                   and tests/api.spec.js cannot
                                                   see it: the suite points
                                                   Open-Meteo at a dead port
     · a gust read from the wrong hour            → the field surges for a gust
                                                   that happened at 3am
     · an unknown gust served as a number          → a plausible default is a
                                                   cause the room cannot see
     · any path failing the schema                 → ⚠ that is not an error: it
                                                   swaps in "Unavailable" and
                                                   the wall loses its weather
   Pure functions plus one local server. No real upstream.
   ═══════════════════════════════════════════════════════════════════════════ */

const validateNow = compileDataSchema(weatherNowSchema);
const valid = (data) => validateData(validateNow, structuredClone(data));

// Current time mid-hour, as Open-Meteo returns it; hourly is on the hour.
const raw = (gusts) => ({
  timezone: "Australia/Brisbane",
  current_weather: { time: "2026-09-22T14:45", temperature: 24, windspeed: 18, winddirection: 110, weathercode: 3 },
  hourly: {
    time: ["2026-09-22T13:00", "2026-09-22T14:00", "2026-09-22T15:00"],
    apparent_temperature: [23, 24, 25],
    relativehumidity_2m: [60, 62, 64],
    precipitation_probability: [10, 20, 30],
    uv_index: [5, 4, 3],
    windspeed_10m: [15, 18, 20],
    cloudcover: [40, 50, 60],
    ...(gusts ? { windgusts_10m: gusts } : {})
  },
  daily: { temperature_2m_max: [27], temperature_2m_min: [16], sunrise: ["x"], sunset: ["y"] }
});

test("the request ASKS Open-Meteo for windgusts_10m, in the hourly block", async () => {
  let seen = null;
  const server = http.createServer((req, res) => {
    seen = new URL(req.url, "http://x");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(raw([30, 41, 50])));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const prev = process.env.OPEN_METEO_URL;
  process.env.OPEN_METEO_URL = `http://127.0.0.1:${server.address().port}/v1/forecast`;
  try {
    await fetchWeatherRaw({ lat: -27.4, lon: 153 });
  } finally {
    if (prev === undefined) delete process.env.OPEN_METEO_URL; else process.env.OPEN_METEO_URL = prev;
    server.close();
  }
  expect(seen, "the local upstream was never called").not.toBeNull();
  expect((seen.searchParams.get("hourly") || "").split(",")).toContain("windgusts_10m");
});

test("a gust is read from the CURRENT hour — not the first, not the next", () => {
  const now = normalizeWeatherNow(raw([30, 41, 50])).now;
  expect(now.wind_gust_kph, "14:45 belongs to the 14:00 slot").toBe(41);
  expect(valid(normalizeWeatherNow(raw([30, 41, 50]))).ok).toBe(true);
});

test("no gust reading is NULL, never a number — and still schema-valid", () => {
  const absent = normalizeWeatherNow(raw(null));
  expect(absent.now.wind_gust_kph).toBeNull();
  expect(valid(absent).ok).toBe(true);
  // An hour missing from the series is unknown too, not the neighbour's value.
  const off = normalizeWeatherNow({ ...raw([30, 41, 50]), current_weather: { ...raw(null).current_weather, time: "2026-09-22T19:10" } });
  expect(off.now.wind_gust_kph).toBeNull();
});

test("every path carries the field, so none can fall back to 'Unavailable'", () => {
  const bom = normalizeBomNow({ current: { condition: "rainy", temp_c: 15, wind_kph: 15 }, days: [] });
  expect(bom.now).toHaveProperty("wind_gust_kph", null);
  expect(valid(bom).ok, "the BOM path fails the schema — the wall would lose its weather").toBe(true);
  const fallback = weatherFallbackNow();
  expect(fallback.now).toHaveProperty("wind_gust_kph", null);
  expect(valid(fallback).ok).toBe(true);
});
