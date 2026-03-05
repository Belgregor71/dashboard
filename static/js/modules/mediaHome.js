import { on } from "../core/eventBus.js";
import { CONFIG } from "../core/config.js";
import { getEntity } from "../services/homeAssistant/state.js";
import { callHAService } from "../services/homeAssistant/client.js";
import {
  createCooldownController,
  formatSpeed,
  parseEntityNumber,
  setTextIfChanged
} from "../helpers/media.js";

const IDS = {
  qbActive: "sensor.qbittorrent_active_torrents",
  qbErrors: "sensor.qbittorrent_errored_torrents",
  qbDown: "sensor.qbittorrent_download_speed",
  qbUp: "sensor.qbittorrent_upload_speed",
  sonarrQueue: "sensor.sonarr_queue",
  sonarrWanted: "sensor.sonarr_wanted",
  radarrQueue: "sensor.radarr_queue",
  altSpeedSwitch: "switch.qbittorrent_alternative_speed"
};

export function initMediaHome() {
  const pulse = document.getElementById("media-pulse");
  const pulseText = document.getElementById("media-pulse-text");
  const badgeSonarr = document.getElementById("media-badge-sonarr");
  const badgeRadarr = document.getElementById("media-badge-radarr");
  const badgeQbit = document.getElementById("media-badge-qbit");

  const pop = document.getElementById("media-downloads-pop");
  if (!pulse || !pop) return;

  const down = document.getElementById("media-pop-down");
  const up = document.getElementById("media-pop-up");
  const active = document.getElementById("media-pop-active");
  const sonarr = document.getElementById("media-pop-sonarr");
  const radarr = document.getElementById("media-pop-radarr");
  const errors = document.getElementById("media-pop-errors");
  const errorsWrap = document.getElementById("media-pop-errors-wrap");
  const turtle = document.getElementById("media-pop-turtle-toggle");

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
      altSpeedOn: getEntity(IDS.altSpeedSwitch)?.state === "on",
      active: qbActive > 0 || sonarrQueue > 0 || radarrQueue > 0
    };

    if (state.active) cooldown.markActive();
    return state;
  }

  function updatePulse(state) {
    const showSonarr = state.sonarrQueue > 0 || state.sonarrWanted > 0;
    const showRadarr = state.radarrQueue > 0;
    const showQbit = state.qbActive > 0;
    const any = showSonarr || showRadarr || showQbit;

    pulse.classList.toggle("hidden", !any);
    setTextIfChanged(pulseText, "Media active");

    badgeSonarr.hidden = !showSonarr;
    badgeRadarr.hidden = !showRadarr;
    badgeQbit.hidden = !showQbit;

    if (showSonarr) {
      const parts = [];
      if (state.sonarrQueue > 0) parts.push(`Q${state.sonarrQueue}`);
      if (state.sonarrWanted > 0) parts.push(`W${state.sonarrWanted}`);
      setTextIfChanged(badgeSonarr, `S:${parts.join(" ")}`);
    }
    if (showRadarr) {
      setTextIfChanged(badgeRadarr, `R:Q${state.radarrQueue}`);
    }
    if (showQbit) {
      setTextIfChanged(badgeQbit, `↓ ${formatSpeed(state.qbDown)} • ${state.qbActive}`);
    }
  }

  function updatePop(state) {
    const shouldShow = cooldown.shouldShow(state.active);
    pop.classList.toggle("is-visible", shouldShow);
    pop.setAttribute("aria-hidden", String(!shouldShow));

    setTextIfChanged(down, formatSpeed(state.qbDown));
    setTextIfChanged(up, formatSpeed(state.qbUp));
    setTextIfChanged(active, `${state.qbActive}`);
    setTextIfChanged(sonarr, `Sonarr: ${state.sonarrQueue} queue • ${state.sonarrWanted} wanted`);
    setTextIfChanged(radarr, `Radarr: ${state.radarrQueue} queue`);

    errorsWrap.hidden = state.qbErrors <= 0;
    if (state.qbErrors > 0) {
      setTextIfChanged(errors, `qBittorrent errors: ${state.qbErrors}`);
    }

    const showToggle = state.qbActive > 0;
    turtle.hidden = !showToggle;
    turtle.disabled = !haConnected;
    turtle.dataset.active = state.altSpeedOn ? "true" : "false";
    setTextIfChanged(turtle, state.altSpeedOn ? "Turtle mode: ON" : "Turtle mode: OFF");
  }

  function applyState(state) {
    updatePulse(state);
    updatePop(state);
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

  turtle?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!haConnected) return;
    turtle.disabled = true;
    try {
      await callHAService({
        domain: "switch",
        service: "toggle",
        serviceData: { entity_id: IDS.altSpeedSwitch }
      });
    } catch (error) {
      console.warn("Failed to toggle qBittorrent alt speed", error);
    } finally {
      setTimeout(() => {
        turtle.disabled = !haConnected;
        queueRender();
      }, 300);
    }
  });

  on("ha:connected", () => {
    haConnected = true;
    if (latestState) updatePop(latestState);
  });
  on("ha:disconnected", () => {
    haConnected = false;
    if (latestState) updatePop(latestState);
  });

  document.addEventListener("ha:state-updated", (event) => {
    if (!trackedEntityIds.has(event.detail?.entity_id)) return;
    queueRender();
  });

  queueRender();
}
