import { test, expect } from "@playwright/test";

import { compileDataSchema, validateData } from "../server/middleware/validate.js";
import { weatherNowSchema, weatherForecastSchema } from "../server/schemas/weather.js";
import { normalizeBomNow, normalizeBomForecast } from "../server/services/weatherService.js";
import { haConditionToWmoCode } from "../server/services/bomWeatherService.js";

// The BOM fallback only runs when Open-Meteo is down, which is exactly when
// nobody is watching — so the mapping is covered here rather than by driving
// the live upstream. These are pure functions: no network, no HA, no clock.
//
// The fixture is a real capture from weather.nudgee on 2026-08-02, not an
// invention. Two things about that shape are easy to get wrong from memory:
// the daily high is `temperature` (not `temp_max`) with the low in `templow`,
// and the forecast is NOT in entity attributes at all — it only comes back
// from the weather.get_forecasts service, POSTed with ?return_response.

const validateNow = compileDataSchema(weatherNowSchema);
const validateForecast = compileDataSchema(weatherForecastSchema);

// compileDataSchema's Ajv does not coerce, so validating is now a pure check.
// The clone is belt-and-braces: it means these specs still assert on exactly
// what the mapper returned even if the validator ever regains a mutating option.
const checks = (validateFn, data) => validateData(validateFn, structuredClone(data));

const BOM_FIXTURE = {
  entityId: "weather.nudgee",
  current: {
    condition: "rainy",
    temp_c: 14.9,
    humidity_pct: 93,
    wind_kph: 15,
    locationName: "Nudgee"
  },
  days: [
    { datetime: "2026-08-02T00:00:00", condition: "rainy", templow: 11, temperature: 21, precipitation_probability: 50, precipitation: 1 },
    { datetime: "2026-08-03T00:00:00", condition: "sunny", templow: 10, temperature: 21, precipitation_probability: 30, precipitation: 1 }
  ]
};

test("BOM now maps into a schema-valid WeatherNow", () => {
  const now = normalizeBomNow(BOM_FIXTURE);
  const result = checks(validateNow, now);

  expect(result.ok, `schema errors: ${JSON.stringify(result.errors)}`).toBe(true);
  expect(now.now.temp_c).toBe(14.9);
  expect(now.now.humidity_pct).toBe(93);
  expect(now.now.wind_kph).toBe(15);
  expect(now.location.name).toBe("Nudgee");
  // Today's high/low come from forecast day 0, not from the current-conditions
  // entity, which carries only the instantaneous temperature.
  expect(now.day.high_c).toBe(21);
  expect(now.day.low_c).toBe(11);
  expect(now.now.rain_chance_pct).toBe(50);
});

test("BOM forecast maps into a schema-valid WeatherForecast", () => {
  const forecast = normalizeBomForecast(BOM_FIXTURE);
  const result = checks(validateForecast, forecast);

  expect(result.ok, `schema errors: ${JSON.stringify(result.errors)}`).toBe(true);
  expect(forecast.days).toHaveLength(2);
  // Open-Meteo's daily.time is a bare date. If BOM's full ISO datetime leaked
  // through, anything keying a day off this string would silently stop matching.
  expect(forecast.days[0].date).toBe("2026-08-02");
  expect(forecast.days[1].condition.label).toBe("Clear");
});

test("HA condition strings resolve through the shared WMO table", () => {
  // Sky state must survive the hop, because the living-window effects key off
  // condition.icon/intensity rather than the label.
  expect(haConditionToWmoCode("sunny")).toBe(0);
  expect(haConditionToWmoCode("partlycloudy")).toBe(2);
  expect(haConditionToWmoCode("pouring")).toBe(65);
  expect(haConditionToWmoCode("lightning-rainy")).toBe(95);
  expect(haConditionToWmoCode("RAINY")).toBe(63);

  const heavy = normalizeBomNow({ ...BOM_FIXTURE, current: { ...BOM_FIXTURE.current, condition: "pouring" } });
  expect(heavy.now.condition.icon).toBe("rain");
  expect(heavy.now.condition.intensity).toBe("heavy");

  const storm = normalizeBomNow({ ...BOM_FIXTURE, current: { ...BOM_FIXTURE.current, condition: "lightning" } });
  expect(storm.now.condition.thunder).toBe(true);
});

test("an unmapped condition degrades without breaking the contract", () => {
  // "exceptional" is BOM's catch-all, and HA can emit unknown/null on restart.
  for (const condition of ["exceptional", "not-a-real-condition", null, undefined]) {
    const now = normalizeBomNow({ ...BOM_FIXTURE, current: { ...BOM_FIXTURE.current, condition } });
    expect(checks(validateNow, now).ok).toBe(true);
    expect(now.now.condition.code).toBeNull();
    // api.spec.js asserts both of these on every weather response, including
    // the degraded ones — a bare null here would fail the contract test.
    expect(now.now.condition.thunder).toBe(false);
    expect([null, "light", "moderate", "heavy"]).toContain(now.now.condition.intensity);
  }
});

test("a forecast-less BOM read still serves current conditions", () => {
  // get_forecasts is allowed to fail on its own (fetchBomWeather swallows it),
  // which lands here as days: []. The now payload must still stand up.
  const bare = { ...BOM_FIXTURE, days: [] };

  const now = normalizeBomNow(bare);
  expect(checks(validateNow, now).ok).toBe(true);
  expect(now.now.temp_c).toBe(14.9);
  expect(now.day.high_c).toBeNull();

  const forecast = normalizeBomForecast(bare);
  expect(checks(validateForecast, forecast).ok).toBe(true);
  expect(forecast.days).toEqual([]);
});

test("validating an outbound payload never rewrites it", () => {
  // Regression guard for the fix on 2026-08-02. Ajv applies coerceTypes,
  // useDefaults and removeAdditional by mutating in place, and
  // getWeatherNormalized validates the very object it returns — so "unknown"
  // used to leave the server as a confident 0 (numbers) or "" (strings) on
  // BOTH upstreams. Every `!= null` guard downstream was dead code:
  // aiBriefing.js told the model "UV 0" when the truth was "no reading".
  //
  // The schemas are compiled by compileDataSchema now, which uses a separate
  // non-coercing Ajv. If someone routes an outbound schema back through
  // compileSchema, this is what catches it.
  const now = normalizeBomNow(BOM_FIXTURE);

  const before = structuredClone(now);
  const result = validateData(validateNow, now); // deliberately NOT the cloning helper

  expect(result.ok).toBe(true);
  expect(now).toEqual(before);
  expect(now.now.feels_like_c).toBeNull();
  expect(now.now.uv).toBeNull();
  expect(now.day.sunrise).toBeNull();
});

test("sunrise/sunset are null on the BOM path, and that is deliberate", () => {
  // BOM's HA entity carries neither. Verified safe on 2026-08-02: screensaver.js
  // and services/weather/renderer.js compute sun times from the vendored
  // suncalc using the dashboard's own coordinates, and the only other reader,
  // services/weather/mapper.js, is orphaned and parses the raw Open-Meteo shape.
  // If a consumer of day.sunrise from THIS api ever appears, this test is the
  // place that should start failing.
  const now = normalizeBomNow(BOM_FIXTURE);
  expect(now.day.sunrise).toBeNull();
  expect(now.day.sunset).toBeNull();
  expect(checks(validateNow, now).ok).toBe(true);
});
