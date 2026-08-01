import fetch from "node-fetch";

/**
 * BOM-via-Home-Assistant weather, used only when Open-Meteo is unreachable.
 *
 * Why HA and not the BOM API directly: the Bureau has no free, stable JSON API
 * for this, but the `bureau_of_meteorology` HACS integration is already
 * installed and already polling. Reading it costs one LAN round-trip and no
 * third-party quota — which is the whole point, since the failure this exists
 * to cover is Open-Meteo 429-ing us.
 *
 * Shape note: the integration does NOT create sensor.bom_* entities (the
 * frontend's src/js/services/weather/bom.js assumes it does, and finds nothing).
 * It creates weather.<location> and weather.<location>_hourly. Current
 * conditions live in that entity's attributes; the forecast is NOT in
 * attributes — HA 2024+ moved it behind the weather.get_forecasts service,
 * which must be POSTed with ?return_response.
 */

const REQUEST_TIMEOUT_MS = 6000;

// HA condition strings -> a representative WMO code, so the existing
// conditionFor() in weatherService stays the single source of truth for
// label/icon/intensity/thunder. The living-window effects key off icon and
// intensity, so inventing a second label table here would silently fork them.
const HA_CONDITION_TO_WMO = new Map([
  ["sunny", 0],
  ["clear-night", 0],
  ["partlycloudy", 2],
  ["cloudy", 3],
  ["fog", 45],
  ["rainy", 63],
  ["pouring", 65],
  ["hail", 96],
  ["lightning", 95],
  ["lightning-rainy", 95],
  ["snowy", 73],
  ["snowy-rainy", 66],
  // No WMO code means "windy"; the sky is the visible part, so treat it as the
  // partly-cloudy look rather than leaving it Unavailable.
  ["windy", 2],
  ["windy-variant", 2]
]);

/** @returns {number|null} */
export function haConditionToWmoCode(condition) {
  if (typeof condition !== "string") return null;
  const key = condition.trim().toLowerCase();
  // "exceptional" is BOM's catch-all and carries no usable sky state.
  return HA_CONDITION_TO_WMO.has(key) ? HA_CONDITION_TO_WMO.get(key) : null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(haToken) {
  return { Authorization: `Bearer ${haToken}`, "Content-Type": "application/json" };
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Resolved entity id is cached for the process: the auto-detect scan pulls the
// full HA state table (~700 entities here), which is wasteful to repeat on
// every Open-Meteo blip.
let cachedEntityId = null;

export function __resetBomEntityCache() {
  cachedEntityId = null;
}

/**
 * WEATHER_BOM_ENTITY wins; otherwise find a weather.* entity that BOM
 * attributes itself on. Prefers the daily entity over the _hourly one, which
 * carries the same current conditions but a different forecast granularity.
 */
export async function resolveBomEntityId({ haHost, haToken }) {
  if (cachedEntityId) return cachedEntityId;

  const configured = (process.env.WEATHER_BOM_ENTITY || "").trim();
  if (configured) {
    cachedEntityId = configured;
    return cachedEntityId;
  }

  const response = await fetchWithTimeout(`${haHost}/api/states`, { headers: authHeaders(haToken) });
  if (!response.ok) throw new Error(`HA states fetch failed (${response.status})`);
  const states = await response.json();
  if (!Array.isArray(states)) throw new Error("HA states payload was not an array");

  const candidates = states.filter(
    (entity) =>
      typeof entity?.entity_id === "string" &&
      entity.entity_id.startsWith("weather.") &&
      /bureau of meteorology/i.test(entity?.attributes?.attribution || "")
  );
  if (!candidates.length) throw new Error("No BOM weather.* entity found in Home Assistant");

  const daily = candidates.find((entity) => !entity.entity_id.endsWith("_hourly"));
  cachedEntityId = (daily || candidates[0]).entity_id;
  return cachedEntityId;
}

/**
 * Raw-ish BOM read: current conditions plus the daily forecast array.
 * Normalising into the API's WeatherNow/WeatherForecast shapes is left to
 * weatherService, which owns conditionFor() — keeping the dependency one-way
 * so there is no import cycle.
 *
 * @returns {Promise<{entityId: string, current: object, days: Array<object>}>}
 */
export async function fetchBomWeather({ haHost, haToken }) {
  const entityId = await resolveBomEntityId({ haHost, haToken });

  const stateResponse = await fetchWithTimeout(
    `${haHost}/api/states/${encodeURIComponent(entityId)}`,
    { headers: authHeaders(haToken) }
  );
  if (!stateResponse.ok) throw new Error(`HA state fetch failed for ${entityId} (${stateResponse.status})`);
  const entity = await stateResponse.json();
  const attributes = entity?.attributes || {};

  // ?return_response is mandatory — without it HA returns 200 and an empty body,
  // which reads as "the integration has no forecast" rather than "wrong call".
  let days = [];
  try {
    const forecastResponse = await fetchWithTimeout(
      `${haHost}/api/services/weather/get_forecasts?return_response`,
      {
        method: "POST",
        headers: authHeaders(haToken),
        body: JSON.stringify({ type: "daily", entity_id: entityId })
      }
    );
    if (forecastResponse.ok) {
      const payload = await forecastResponse.json();
      const forecast = payload?.service_response?.[entityId]?.forecast;
      if (Array.isArray(forecast)) days = forecast;
    }
  } catch {
    // Current conditions alone are still worth serving; an empty forecast
    // degrades to days: [], which weatherFallbackForecast() already returns.
  }

  return {
    entityId,
    current: {
      condition: typeof entity?.state === "string" ? entity.state : null,
      temp_c: numberOrNull(attributes.temperature),
      humidity_pct: numberOrNull(attributes.humidity),
      wind_kph: numberOrNull(attributes.wind_speed),
      locationName: typeof attributes.friendly_name === "string" ? attributes.friendly_name : "BOM"
    },
    days
  };
}
