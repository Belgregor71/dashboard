import { on } from "../core/eventBus.js";
import { CONFIG } from "../core/config.js";
import { getEntity } from "../services/homeAssistant/state.js";
import {
  createCooldownController,
  formatSpeed,
  parseEntityNumber
} from "../helpers/media.js";

const IDS = {
  qbActive: "sensor.qbittorrent_active_torrents",
  qbErrors: "sensor.qbittorrent_errored_torrents",
  qbDown: "sensor.qbittorrent_download_speed",
  qbUp: "sensor.qbittorrent_upload_speed",
  sonarrQueue: "sensor.sonarr_queue",
  sonarrWanted: "sensor.sonarr_wanted",
  radarrQueue: "sensor.radarr_queue"
};

function buildTickerItems(state) {
  const items = [];

  if (state.sonarrQueue > 0 || state.sonarrWanted > 0) {
    items.push(`Sonarr queue ${state.sonarrQueue}`);
    items.push(`Sonarr wanted ${state.sonarrWanted}`);
  }

  if (state.radarrQueue > 0) {
    items.push(`Radarr queue ${state.radarrQueue}`);
  }

  if (state.qbActive > 0) {
    items.push(`qBittorrent active ${state.qbActive}`);
    items.push(`Down ${formatSpeed(state.qbDown)}`);
    items.push(`Up ${formatSpeed(state.qbUp)}`);
  }

  if (state.qbErrors > 0) {
    items.push(`qBittorrent errors ${state.qbErrors}`);
  }

  return items;
}

export function initMediaHome() {
  const ticker = document.getElementById("media-activity-ticker");
  const tickerTrack = document.getElementById("media-activity-ticker-track");
  if (!ticker || !tickerTrack) return;

  const cfg = CONFIG.homeAssistant?.mediaAutomation || {};
  const activeRefreshMs = cfg.activeRefreshMs ?? 3000;
  const idleRefreshMs = cfg.idleRefreshMs ?? 20000;
  const cooldown = createCooldownController(cfg.homeCooldownMs ?? 90_000);
  const trackedEntityIds = new Set(Object.values(IDS));

  let haConnected = false;
  let timer = null;
  let pendingFrame = 0;
  let latestState = null;
  let currentRefreshMs = 0;
  let lastTickerSignature = "";

  const schedule = (ms) => {
    if (currentRefreshMs === ms && timer) return;
    currentRefreshMs = ms;
    if (timer) clearInterval(timer);
    timer = setInterval(queueRender, ms);
  };

  function collectState() {
    const qbActive = parseEntityNumber(getEntity(IDS.qbActive));
    const sonarrQueue = parseEntityNumber(getEntity(IDS.sonarrQueue));
    const radarrQueue = parseEntityNumber(getEntity(IDS.radarrQueue));
    const qbErrors = parseEntityNumber(getEntity(IDS.qbErrors));
    const state = {
      qbActive,
      qbErrors,
      qbDown: parseEntityNumber(getEntity(IDS.qbDown)),
      qbUp: parseEntityNumber(getEntity(IDS.qbUp)),
      sonarrQueue,
      sonarrWanted: parseEntityNumber(getEntity(IDS.sonarrWanted)),
      radarrQueue,
      active: qbActive > 0 || sonarrQueue > 0 || radarrQueue > 0
    };

    if (state.active) cooldown.markActive();
    return state;
  }

  function setTickerRows(items) {
    const signature = items.join("|");
    if (signature === lastTickerSignature) return;
    lastTickerSignature = signature;

    const content = items
      .map((item) => `<span class="media-activity-ticker__item">${item}</span>`)
      .join('<span class="media-activity-ticker__divider" aria-hidden="true">•</span>');

    tickerTrack.innerHTML = `<div class="media-activity-ticker__row">${content}</div><div class="media-activity-ticker__row" aria-hidden="true">${content}</div>`;
  }

  function updateTicker(state) {
    const shouldShow = cooldown.shouldShow(state.active);
    const tickerItems = buildTickerItems(state);
    const showTicker = shouldShow && tickerItems.length > 0;

    ticker.classList.toggle("hidden", !showTicker);
    ticker.setAttribute("aria-hidden", String(!showTicker));

    if (!showTicker) {
      tickerTrack.innerHTML = "";
      lastTickerSignature = "";
      return;
    }

    setTickerRows(tickerItems);
    ticker.classList.toggle("is-offline", !haConnected);
  }


  function applyState(state) {
    updateTicker(state);
    schedule(state.active ? activeRefreshMs : idleRefreshMs);
    latestState = state;
  }

  function queueRender() {
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      applyState(collectState());
    });
  }


  on("ha:connected", () => {
    haConnected = true;
    if (latestState) applyState(latestState);
  });
  on("ha:disconnected", () => {
    haConnected = false;
    if (latestState) applyState(latestState);
  });

  document.addEventListener("ha:state-updated", (event) => {
    if (!trackedEntityIds.has(event.detail?.entity_id)) return;
    queueRender();
  });

  queueRender();
}
