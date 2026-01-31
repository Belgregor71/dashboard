import { CONFIG } from "../core/config.js";
import { on } from "../core/eventBus.js";
import { getEntity } from "../services/homeAssistant/state.js";

const PANEL_IDS = ["media-panel-1", "media-panel-2"];

function hidePanel(panel) {
  if (!panel || panel.classList.contains("is-hidden")) return;
  panel.classList.add("is-hidden");
  panel.addEventListener(
    "transitionend",
    () => {
      if (panel.classList.contains("is-hidden")) {
        panel.classList.add("is-collapsed");
      }
    },
    { once: true }
  );
}

function showPanel(panel) {
  if (!panel) return;
  panel.classList.remove("is-collapsed");
  requestAnimationFrame(() => {
    panel.classList.remove("is-hidden");
  });
}

function resolveMediaImage(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `${CONFIG.homeAssistant?.url ?? ""}${url}`;
  return url;
}

function getMediaConfigs() {
  return CONFIG.homeAssistant?.mediaPlayers ?? [];
}

function formatSubtitle(attributes) {
  return (
    attributes.media_artist ||
    attributes.media_album_name ||
    attributes.media_content_type ||
    ""
  );
}

function updateProgress(panel, attributes) {
  const progressEl = panel.querySelector(".media-panel__progress");
  const barEl = panel.querySelector(".media-panel__progress-bar");
  const duration = Number(attributes.media_duration);
  const position = Number(attributes.media_position);

  if (!duration || Number.isNaN(duration) || Number.isNaN(position)) {
    progressEl.classList.add("is-hidden");
    barEl.style.width = "0%";
    return;
  }

  const progress = Math.min(Math.max(position / duration, 0), 1);
  barEl.style.width = `${(progress * 100).toFixed(1)}%`;
  progressEl.classList.remove("is-hidden");
}

function renderPanel(panel, entity, config) {
  if (!panel) return;
  if (!entity || entity.state !== "playing") {
    hidePanel(panel);
    return;
  }

  const attributes = entity.attributes || {};
  const imageUrl = resolveMediaImage(attributes.entity_picture);
  const artEl = panel.querySelector(".media-panel__image");
  const sourceEl = panel.querySelector(".media-panel__source");
  const titleEl = panel.querySelector(".media-panel__title");
  const subtitleEl = panel.querySelector(".media-panel__subtitle");

  showPanel(panel);
  panel.style.setProperty(
    "--media-panel-art",
    imageUrl ? `url("${imageUrl}")` : "rgba(0, 0, 0, 0.35)"
  );

  sourceEl.textContent =
    config?.label || attributes.friendly_name || "Media";
  titleEl.textContent = attributes.media_title || "Now Playing";
  subtitleEl.textContent = formatSubtitle(attributes);
  artEl.src = imageUrl || "";
  artEl.alt = attributes.media_title || "Media artwork";
  artEl.classList.toggle("is-hidden", !imageUrl);

  updateProgress(panel, attributes);
}

export function initMediaPanels() {
  const panelMap = new Map();
  const panels = PANEL_IDS.map(id => document.getElementById(id)).filter(Boolean);
  const configs = getMediaConfigs();

  panels.forEach((panel, index) => {
    const config = configs[index];
    if (!config?.entityId) {
      panel.classList.add("is-hidden", "is-collapsed");
      return;
    }

    panel.dataset.entityId = config.entityId;
    panelMap.set(config.entityId, { panel, config });
  });

  function refresh(entityId) {
    if (!entityId || !panelMap.has(entityId)) return;
    const entry = panelMap.get(entityId);
    const entity = getEntity(entityId);
    renderPanel(entry.panel, entity, entry.config);
  }

  function refreshAll() {
    panelMap.forEach((_, entityId) => refresh(entityId));
  }

  document.addEventListener("ha:state-updated", (event) => {
    refresh(event.detail?.entity_id);
  });

  document.addEventListener("ha:connected", () => {
    refreshAll();
  });

  on("view:changed", () => refreshAll());
  refreshAll();
}
