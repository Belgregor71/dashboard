/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

import { CONFIG } from "../../core/config.js";

const BOM_DEFAULT_DAY_MAP = {
  tempMin: "temp_min",
  tempMax: "temp_max",
  iconDescriptor: "icon_descriptor",
  mdiIcon: "mdi_icon",
  shortText: "short_text",
  extendedText: "extended_text",
  rainChance: "rain_chance",
  rainMin: "rain_amount_min",
  rainMax: "rain_amount_max",
  rainRange: "rain_range",
  uvCategory: "uv_category",
  uvMaxIndex: "uv_max_index",
  uvForecast: "uv_forecast",
  fireDanger: "fire_danger",
  astroSunrise: "sunrise",
  astroSunset: "sunset"
};

function normalizeEntityId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isUnavailableValue(value) {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "unknown" || normalized === "unavailable" || normalized === "none" || normalized === "null";
}

function bomLog(message, details = null) {
  if (CONFIG.weather?.debugBom !== true) return;
  if (details != null) {
    console.log(`[Weather BOM] ${message}`, details);
    return;
  }
  console.log(`[Weather BOM] ${message}`);
}

export function getEntityState(haStates, entityId, fallback = null) {
  const id = normalizeEntityId(entityId);
  if (!id) return fallback;
  const state = haStates?.[id]?.state;
  if (isUnavailableValue(state)) return fallback;
  return state;
}

export function getEntityAttr(haStates, entityId, attr, fallback = null) {
  const id = normalizeEntityId(entityId);
  if (!id || !attr) return fallback;
  const entity = haStates?.[id];
  if (!entity || isUnavailableValue(entity.state)) return fallback;
  const value = entity.attributes?.[attr];
  return isUnavailableValue(value) ? fallback : (value ?? fallback);
}

export function parseNumberSafe(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseTimeSafe(value, fallback = null) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function autoDetectEntityId(haStates, pattern) {
  if (!haStates) return "";
  const regex = new RegExp(pattern, "i");
  return Object.keys(haStates).find((id) => regex.test(id)) || "";
}

const DAY_SLOT_MAP = { 0: 5, 1: 6, 2: 7 };

function dayConfigFor(dayIndex, bomConfig, haStates) {
  const dayConfig = bomConfig?.daily ?? {};
  const mappedDay = DAY_SLOT_MAP[dayIndex] ?? dayIndex;
  const configForDay = dayConfig[mappedDay] || dayConfig[dayIndex] || (dayIndex === 0 ? dayConfig[5] || {} : {});
  const suffix = dayIndex === 0 ? "" : `_${dayIndex}`;
  const explicitSource = normalizeEntityId(configForDay.sourceEntityId);
  const resolvedConfig = {
    ...BOM_DEFAULT_DAY_MAP,
    ...configForDay,
    sourceEntityId: explicitSource || autoDetectEntityId(haStates, `bom.*forecast.*${dayIndex}|forecast${suffix}`)
  };
  bomLog("day mapping", {
    dayIndex,
    mappedDay,
    sourceEntityId: resolvedConfig.sourceEntityId || "(auto-detect-miss)",
    rainChance: resolvedConfig.rainChance || "",
    rainRange: resolvedConfig.rainRange || "",
    uvCategory: resolvedConfig.uvCategory || "",
    uvMaxIndex: resolvedConfig.uvMaxIndex || ""
  });
  return resolvedConfig;
}

function readField(haStates, sourceEntityId, mappingValue) {
  if (!mappingValue) return null;
  if (typeof mappingValue === "string" && mappingValue.startsWith("attribute:")) {
    return getEntityAttr(haStates, sourceEntityId, mappingValue.replace("attribute:", ""), null);
  }
  const explicitEntityId = normalizeEntityId(mappingValue);
  if (explicitEntityId.includes(".")) {
    return getEntityState(haStates, explicitEntityId, null);
  }
  return getEntityAttr(haStates, sourceEntityId, mappingValue, null);
}

function normalizeRainRange(rainMin, rainMax, supplied) {
  if (typeof supplied === "string" && supplied.trim()) return supplied.trim();
  if (rainMin == null && rainMax == null) return "";
  if (rainMin != null && rainMax != null) return `${rainMin}-${rainMax} mm`;
  if (rainMax != null) return `Up to ${rainMax} mm`;
  return `${rainMin} mm`;
}

export function normalizeUvCategory(rawCategory, uvMaxIndex) {
  if (rawCategory) return String(rawCategory);
  if (uvMaxIndex == null) return "";
  if (uvMaxIndex <= 2) return "Low";
  if (uvMaxIndex <= 5) return "Moderate";
  if (uvMaxIndex <= 7) return "High";
  if (uvMaxIndex <= 10) return "Very High";
  return "Extreme";
}

export function getBomForecastBundle(locationKey, dayIndex = 0, haStatesInput = null) {
  const haStates = haStatesInput || {};
  const bomConfig = CONFIG.weather?.bom || {};
  const dayConfig = dayConfigFor(dayIndex, bomConfig, haStates);
  const sourceEntityId = dayConfig.sourceEntityId;

  bomLog("configured entity ids", {
    dayIndex,
    sourceEntityId: sourceEntityId || "",
    rainChance: normalizeEntityId(dayConfig.rainChance),
    rainRange: normalizeEntityId(dayConfig.rainRange),
    uvCategory: normalizeEntityId(dayConfig.uvCategory),
    uvMaxIndex: normalizeEntityId(dayConfig.uvMaxIndex)
  });

  const tempMin = parseNumberSafe(readField(haStates, sourceEntityId, dayConfig.tempMin), null);
  const tempMax = parseNumberSafe(readField(haStates, sourceEntityId, dayConfig.tempMax), null);
  const rainChance = parseNumberSafe(readField(haStates, sourceEntityId, dayConfig.rainChance), null);
  const rainMin = parseNumberSafe(readField(haStates, sourceEntityId, dayConfig.rainMin), null);
  const rainMax = parseNumberSafe(readField(haStates, sourceEntityId, dayConfig.rainMax), null);
  const uvMaxIndex = parseNumberSafe(readField(haStates, sourceEntityId, dayConfig.uvMaxIndex), null);

  bomLog("forecast bundle", {
    locationKey: locationKey || bomConfig.locationName || "",
    dayIndex,
    sourceEntityId: sourceEntityId || "(auto-detect-miss)",
    rainChance,
    rainMin,
    rainMax,
    uvMaxIndex
  });

  return {
    locationKey: locationKey || bomConfig.locationName || "",
    dayIndex,
    tempMin,
    tempMax,
    iconDescriptor: readField(haStates, sourceEntityId, dayConfig.iconDescriptor) || "",
    mdiIcon: readField(haStates, sourceEntityId, dayConfig.mdiIcon) || "",
    shortText: readField(haStates, sourceEntityId, dayConfig.shortText) || "",
    extendedText: readField(haStates, sourceEntityId, dayConfig.extendedText) || "",
    rainChance,
    rainMin,
    rainMax,
    rainRange: normalizeRainRange(rainMin, rainMax, readField(haStates, sourceEntityId, dayConfig.rainRange)),
    uvCategory: normalizeUvCategory(readField(haStates, sourceEntityId, dayConfig.uvCategory), uvMaxIndex),
    uvMaxIndex,
    uvForecast: readField(haStates, sourceEntityId, dayConfig.uvForecast) || "",
    fireDanger: readField(haStates, sourceEntityId, dayConfig.fireDanger) || "",
    astroSunrise: parseTimeSafe(readField(haStates, sourceEntityId, dayConfig.astroSunrise), null),
    astroSunset: parseTimeSafe(readField(haStates, sourceEntityId, dayConfig.astroSunset), null)
  };
}

/* BOM's OWN severity and kind, carried alongside the title.
   Live shape, read off sensor.nudgee_warnings on 2026-09-06:

     { id: "QLD_MW013_IDQ20085", area_id: "QLD_MW013", state: "QLD",
       type: "marine_wind_warning", warning_group_type: "minor",
       title: "Marine Wind Warning for Queensland",
       issue_time: "…", expiry_time: "…", phase: "renewal" }

   Every one of those fields arrived at the wall and was thrown away one line
   later, because this reader flattened the array to `item.title`. That is how a
   MINOR MARINE warning covering the whole state reached the glass at interrupt
   score in an empty room — nothing downstream of here could tell it apart from
   a severe thunderstorm, since by then it was a bare string.

   A warning that arrives as a plain string (some integrations do) yields no
   detail at all, and that is deliberate: `null` means "no severity known", and
   candidateSources reads that as the un-demoted default. Absence stays safe. */
function warningDetail(item) {
  if (!item || typeof item !== "object") return null;
  const title = String(item.title || item.message || "").trim();
  if (!title) return null;
  return {
    title,
    type: String(item.type || "").trim().toLowerCase(),
    groupType: String(item.warning_group_type || "").trim().toLowerCase(),
    areaId: String(item.area_id || "").trim(),
    state: String(item.state || "").trim(),
    expiryTime: String(item.expiry_time || "").trim()
  };
}

export function getBomWarnings(haStatesInput = null) {
  const haStates = haStatesInput || {};
  const configured = normalizeEntityId(CONFIG.weather?.bom?.warningsEntityId);
  const warningsEntityId = configured || autoDetectEntityId(haStates, "warning|alert|bom");
  bomLog("warnings entity", { configured, resolved: warningsEntityId || "(none)" });
  const state = getEntityState(haStates, warningsEntityId, "");
  const attrWarnings = getEntityAttr(haStates, warningsEntityId, "warnings", []);
  const items = Array.isArray(attrWarnings) ? attrWarnings : [];
  const messages = items
    .map((item) => (typeof item === "string" ? item : item?.title || item?.message || ""))
    .filter(Boolean);
  /* ⚠ `details` is NOT index-aligned with `messages` — a string-form warning
     contributes a message and no detail. `top` is therefore the detail for the
     FIRST STRUCTURED warning, which is the one `summary` names in every shape
     the live entity actually produces. Read them as a pair, never by index. */
  const details = items.map(warningDetail).filter(Boolean);
  const summary = messages[0] || (state && state !== "0" ? String(state) : "");
  return {
    warningsEntityId,
    summary,
    count: messages.length || (summary ? 1 : 0),
    messages,
    details,
    top: details[0] ?? null
  };
}

export function getBomHourlySeries(haStatesInput = null) {
  const haStates = haStatesInput || {};
  const configured = normalizeEntityId(CONFIG.weather?.bom?.hourlyEntityId);
  const hourlyEntityId = configured || autoDetectEntityId(haStates, "hourly.*rain|rain.*hourly");
  bomLog("hourly entity", { configured, resolved: hourlyEntityId || "(none)" });
  const values = getEntityAttr(haStates, hourlyEntityId, "rainfall", []) || getEntityAttr(haStates, hourlyEntityId, "values", []);
  const hours = getEntityAttr(haStates, hourlyEntityId, "hours", []);
  if (!Array.isArray(values)) return [];
  return values.slice(0, 12).map((value, idx) => ({
    value: parseNumberSafe(value, 0) || 0,
    label: typeof hours?.[idx] === "string" ? hours[idx] : `${idx + 1}h`
  }));
}

export function getBomRelatedEntityIds(haStatesInput = null) {
  const haStates = haStatesInput || {};
  const bomConfig = CONFIG.weather?.bom || {};
  const ids = new Set();
  Object.values(bomConfig.daily || {}).forEach((dayCfg) => {
    const id = normalizeEntityId(dayCfg?.sourceEntityId);
    if (id) ids.add(id);

    Object.values(dayCfg || {}).forEach((mappedValue) => {
      const mappedEntityId = normalizeEntityId(mappedValue);
      if (mappedEntityId.includes(".")) ids.add(mappedEntityId);
    });
  });
  if (bomConfig.warningsEntityId) ids.add(bomConfig.warningsEntityId);
  if (bomConfig.hourlyEntityId) ids.add(bomConfig.hourlyEntityId);
  if (!ids.size) {
    Object.keys(haStates).forEach((id) => {
      if (/bom|weather|forecast|uv|fire|rain|warning/i.test(id)) ids.add(id);
    });
  }
  return ids;
}
