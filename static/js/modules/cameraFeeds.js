import { CONFIG } from "../core/config.js";
import { getEntity } from "../services/homeAssistant/state.js";

function resolveUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `${CONFIG.homeAssistant?.url ?? ""}${url}`;
  return url;
}

function resolveStreamUrl(config, cameraEntity) {
  if (config?.streamUrl) return resolveUrl(config.streamUrl);
  if (config?.streamPath) return resolveUrl(config.streamPath);
  const entityPicture = cameraEntity?.attributes?.entity_picture;
  if (entityPicture) return resolveUrl(entityPicture);
  if (config?.entityId) {
    return resolveUrl(`/api/camera_proxy_stream/${config.entityId}`);
  }
  return "";
}

function normalizeCameraFeeds(cameraFeeds) {
  if (!Array.isArray(cameraFeeds)) return [];
  return cameraFeeds.filter((camera) => camera?.entityId);
}

export function initCameraFeeds() {
  const cameraFeeds = normalizeCameraFeeds(CONFIG.homeAssistant?.cameraFeeds);
  if (!cameraFeeds.length) return;

  const camerasByEntityId = new Map(
    cameraFeeds.map((camera) => [camera.entityId, camera])
  );

  const cards = document.querySelectorAll("[data-camera-id]");
  if (!cards.length) return;

  const elementsByEntityId = new Map();

  cards.forEach((card) => {
    const entityId = card.getAttribute("data-camera-id");
    if (!entityId) return;
    const cameraConfig = camerasByEntityId.get(entityId);
    if (!cameraConfig) return;

    const imageEl = card.querySelector(".camera-card__image");
    const labelEl = card.querySelector(".camera-card__name");
    if (labelEl && cameraConfig.label) {
      labelEl.textContent = cameraConfig.label;
    }

    if (imageEl) {
      elementsByEntityId.set(entityId, imageEl);
      const entity = getEntity(entityId);
      imageEl.src = resolveStreamUrl(cameraConfig, entity);
      imageEl.alt = cameraConfig.label || entityId;
    }
  });

  if (!elementsByEntityId.size) return;

  document.addEventListener("ha:state-updated", (event) => {
    const entityId = event.detail?.entity_id;
    if (!entityId) return;
    const imageEl = elementsByEntityId.get(entityId);
    if (!imageEl) return;
    const cameraConfig = camerasByEntityId.get(entityId);
    if (!cameraConfig) return;
    imageEl.src = resolveStreamUrl(cameraConfig, event.detail);
  });
}
