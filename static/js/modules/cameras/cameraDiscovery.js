import { CAMERA_OVERRIDES } from "./cameraOverrides.js";

function getEntries(statesMap) {
  if (!statesMap) return [];
  if (statesMap instanceof Map) return Array.from(statesMap.entries());
  if (typeof statesMap === "object") return Object.entries(statesMap);
  return [];
}

function getState(statesMap, entityId) {
  if (!statesMap || !entityId) return null;
  if (statesMap instanceof Map) return statesMap.get(entityId) ?? null;
  if (typeof statesMap === "object") return statesMap[entityId] ?? null;
  return null;
}

function titleize(value) {
  if (!value) return "";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function buildCameraConfig(statesMap) {
  const entries = getEntries(statesMap);
  const cameraIds = entries
    .map(([entityId]) => entityId)
    .filter((entityId) => entityId?.startsWith("camera."));

  const prefixes = new Set(cameraIds.map((entityId) => entityId.replace("camera.", "")));

  const cameras = [];

  prefixes.forEach((prefix) => {
    const overrides = CAMERA_OVERRIDES?.[prefix] ?? {};
    const entityId = `camera.${prefix}`;
    const cameraEntity = getState(statesMap, entityId);
    const defaultName = cameraEntity?.attributes?.friendly_name || titleize(prefix);

    const camera = {
      id: prefix,
      entityId,
      name: overrides.name || defaultName || prefix,
      area: overrides.area,
      order: overrides.order,
      hidden: Boolean(overrides.hidden),
      pinnedHero: Boolean(overrides.pinnedHero),
      eventImageEntity: getState(statesMap, `image.${prefix}_event_image`)
        ? `image.${prefix}_event_image`
        : null,
      motionEntity: getState(statesMap, `binary_sensor.${prefix}_motion_detected`)
        ? `binary_sensor.${prefix}_motion_detected`
        : null,
      personEntity: getState(statesMap, `binary_sensor.${prefix}_person_detected`)
        ? `binary_sensor.${prefix}_person_detected`
        : null,
      petEntity: getState(statesMap, `binary_sensor.${prefix}_pet_detected`)
        ? `binary_sensor.${prefix}_pet_detected`
        : null,
      soundEntity: getState(statesMap, `binary_sensor.${prefix}_sound_detected`)
        ? `binary_sensor.${prefix}_sound_detected`
        : null,
      cryingEntity: getState(statesMap, `binary_sensor.${prefix}_crying_detected`)
        ? `binary_sensor.${prefix}_crying_detected`
        : null,
      ringingEntity: getState(statesMap, `binary_sensor.${prefix}_ringing`)
        ? `binary_sensor.${prefix}_ringing`
        : null,
      personNameEntity: getState(statesMap, `sensor.${prefix}_person_name`)
        ? `sensor.${prefix}_person_name`
        : null,
      enabledEntity: getState(statesMap, `switch.${prefix}_camera_enabled`)
        ? `switch.${prefix}_camera_enabled`
        : null,
      debugDeviceEntity: getState(statesMap, `binary_sensor.${prefix}_debug_device`)
        ? `binary_sensor.${prefix}_debug_device`
        : null,
      debugStationEntity: getState(statesMap, `binary_sensor.${prefix}_debug_station`)
        ? `binary_sensor.${prefix}_debug_station`
        : null,
      rtspEnabledEntity: getState(statesMap, `switch.${prefix}_rtsp_stream`)
        ? `switch.${prefix}_rtsp_stream`
        : null,
      supportsLive: false
    };

    cameras.push(camera);
  });

  cameras.sort((a, b) => {
    const orderA = Number.isFinite(a.order) ? a.order : Number.POSITIVE_INFINITY;
    const orderB = Number.isFinite(b.order) ? b.order : Number.POSITIVE_INFINITY;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });

  return cameras;
}

export function getPinnedHeroId(cameras) {
  if (!Array.isArray(cameras)) return "doorbell";
  const pinned = cameras.find((camera) => camera.pinnedHero);
  return pinned?.id || "doorbell";
}

export function buildMediaProxyUrl(entityId, bustCache = true) {
  if (!entityId || typeof entityId !== "string") return null;
  const encoded = encodeURIComponent(entityId);
  let url;
  if (entityId.startsWith("image.")) {
    url = `/api/image_proxy/${encoded}`;
  } else if (entityId.startsWith("camera.")) {
    url = `/api/camera_proxy/${encoded}`;
  } else {
    return null;
  }

  if (!bustCache) return url;
  const cacheBust = `time=${Date.now()}`;
  return url.includes("?") ? `${url}&${cacheBust}` : `${url}?${cacheBust}`;
}
