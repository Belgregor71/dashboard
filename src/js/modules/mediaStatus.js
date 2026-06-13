import { on } from "../core/eventBus.js";
import { CONFIG } from "../core/config.js";
import { getEntity } from "../services/homeAssistant/state.js";
import { callHAService } from "../services/homeAssistant/client.js";
import {
  formatDataSize,
  formatRelativeTime,
  formatSpeed,
  parseDiskAttributes,
  parseEntityNumber,
  setTextIfChanged
} from "../helpers/media.js";

/**
 * Media Automation integration notes
 * - Entity IDs are centralized in IDS and can be overridden from CONFIG.homeAssistant.mediaAutomation.entities.
 * - Thresholds and cooldown live in CONFIG.homeAssistant.mediaAutomation: diskWarnPct, diskErrorPct, homeCooldownMs.
 * - Optional deep links are CONFIG.homeAssistant.mediaAutomation.urls.{qbittorrent,sonarr,radarr}; links are hidden when unset.
 */
const DEFAULT_IDS = {
  qbStatus: "sensor.qbittorrent_status",
  qbConnection: "sensor.qbittorrent_connection_status",
  qbDown: "sensor.qbittorrent_download_speed",
  qbUp: "sensor.qbittorrent_upload_speed",
  qbDownLimit: "sensor.qbittorrent_download_speed_limit",
  qbUpLimit: "sensor.qbittorrent_upload_speed_limit",
  qbGlobalRatio: "sensor.qbittorrent_global_ratio",
  qbAllTorrents: "sensor.qbittorrent_all_torrents",
  qbActive: "sensor.qbittorrent_active_torrents",
  qbPaused: "sensor.qbittorrent_paused_torrents",
  qbErrored: "sensor.qbittorrent_errored_torrents",
  qbAltSpeed: "switch.qbittorrent_alternative_speed",
  radarrHealth: "binary_sensor.radarr_health",
  radarrQueue: "sensor.radarr_queue",
  radarrMovies: "sensor.radarr_movies",
  radarrDiskA: "sensor.radarr_disk_space_movies",
  radarrDiskB: "sensor.radarr_disk_space_movies_2",
  radarrStart: "sensor.radarr_start_time",
  sonarrQueue: "sensor.sonarr_queue",
  sonarrWanted: "sensor.sonarr_wanted",
  sonarrShows: "sensor.sonarr_shows",
  sonarrUpcoming: "sensor.sonarr_upcoming",
  sonarrCommands: "sensor.sonarr_commands"
};

export function initMediaStatus() {
  const root = document.getElementById("media-automation-section");
  if (!root) return;

  const cfg = CONFIG.homeAssistant?.mediaAutomation || {};
  const IDS = { ...DEFAULT_IDS, ...(cfg.entities || {}) };
  const diskWarnPct = cfg.diskWarnPct ?? 15;
  const diskErrorPct = cfg.diskErrorPct ?? 8;
  const urls = cfg.urls || {};

  let haConnected = false;
  let pendingFrame = 0;
  let tickTimer = null;

  const el = {
    qbDown: document.getElementById("media-status-qb-down"),
    qbUp: document.getElementById("media-status-qb-up"),
    qbStatus: document.getElementById("media-status-qb-status"),
    qbConnection: document.getElementById("media-status-qb-connection"),
    qbCounts: document.getElementById("media-status-qb-counts"),
    qbRatio: document.getElementById("media-status-qb-ratio"),
    qbLimits: document.getElementById("media-status-qb-limits"),
    qbToggle: document.getElementById("media-status-qb-toggle"),
    sonarrQueue: document.getElementById("media-status-sonarr-queue"),
    sonarrWanted: document.getElementById("media-status-sonarr-wanted"),
    sonarrShows: document.getElementById("media-status-sonarr-shows"),
    sonarrUpcoming: document.getElementById("media-status-sonarr-upcoming"),
    sonarrCommands: document.getElementById("media-status-sonarr-commands"),
    sonarrUpdated: document.getElementById("media-status-sonarr-updated"),
    radarrHealth: document.getElementById("media-status-radarr-health"),
    radarrQueue: document.getElementById("media-status-radarr-queue"),
    radarrMovies: document.getElementById("media-status-radarr-movies"),
    radarrDiskA: document.getElementById("media-status-radarr-disk-a"),
    radarrDiskABar: document.getElementById("media-status-radarr-disk-a-bar"),
    radarrDiskBWrap: document.getElementById("media-status-radarr-disk-b-wrap"),
    radarrDiskB: document.getElementById("media-status-radarr-disk-b"),
    radarrDiskBBar: document.getElementById("media-status-radarr-disk-b-bar"),
    radarrStart: document.getElementById("media-status-radarr-start"),
    healthOverall: document.getElementById("media-status-health-overall"),
    healthSummary: document.getElementById("media-status-health-summary")
  };

  const cards = {
    qbit: document.getElementById("media-card-qbit"),
    sonarr: document.getElementById("media-card-sonarr"),
    radarr: document.getElementById("media-card-radarr"),
    health: document.getElementById("media-card-health")
  };

  const modal = {
    root: document.getElementById("media-details-modal"),
    title: document.getElementById("media-details-title"),
    body: document.getElementById("media-details-body"),
    qb: document.getElementById("media-link-qbit"),
    sonarr: document.getElementById("media-link-sonarr"),
    radarr: document.getElementById("media-link-radarr"),
    close: document.getElementById("media-details-close")
  };

  function setStatusLevel(card, level) {
    if (!card) return;
    if (!level) {
      card.removeAttribute("data-status-level");
      return;
    }
    card.dataset.statusLevel = level;
  }

  function healthState() {
    const qbConn = String(getEntity(IDS.qbConnection)?.state || "").toLowerCase();
    const qbStatus = String(getEntity(IDS.qbStatus)?.state || "").toLowerCase();
    const qbErrors = parseEntityNumber(getEntity(IDS.qbErrored));
    const radarrHealthy = String(getEntity(IDS.radarrHealth)?.state || "off") === "on";

    const diskA = parseDiskAttributes(getEntity(IDS.radarrDiskA));
    const diskB = parseDiskAttributes(getEntity(IDS.radarrDiskB));
    const diskPcts = [diskA.freePct, diskB.freePct].filter((v) => Number.isFinite(v));
    const diskMin = diskPcts.length ? Math.min(...diskPcts) : null;

    let overall = "ok";
    if (!radarrHealthy || qbConn.includes("disconnect") || qbStatus.includes("down")) {
      overall = "error";
    } else if (qbErrors > 0) {
      overall = "warn";
    }
    if (diskMin != null && diskMin < diskWarnPct) {
      overall = diskMin < diskErrorPct ? "error" : overall === "error" ? "error" : "warn";
    }

    return { overall, radarrHealthy, qbErrors, diskA, diskB, diskMin };
  }

  function renderDisks(disk, textEl, barEl) {
    if (!textEl || !barEl) return;
    if (!disk.total) {
      setTextIfChanged(textEl, "Disk data unavailable");
      barEl.style.width = "0%";
      return;
    }
    const freePct = Math.max(0, Math.min(100, disk.freePct || 0));
    setTextIfChanged(textEl, `${formatDataSize(disk.free)} free / ${formatDataSize(disk.total)} (${freePct.toFixed(1)}%)`);
    barEl.style.width = `${100 - freePct}%`;
  }

  function render() {
    const qbActive = parseEntityNumber(getEntity(IDS.qbActive));
    const qbPaused = parseEntityNumber(getEntity(IDS.qbPaused));
    const qbErrored = parseEntityNumber(getEntity(IDS.qbErrored));
    const qbDown = parseEntityNumber(getEntity(IDS.qbDown));
    const qbUp = parseEntityNumber(getEntity(IDS.qbUp));

    setTextIfChanged(el.qbDown, formatSpeed(qbDown));
    setTextIfChanged(el.qbUp, formatSpeed(qbUp));
    setTextIfChanged(el.qbStatus, getEntity(IDS.qbStatus)?.state || "Unknown");
    setTextIfChanged(el.qbConnection, getEntity(IDS.qbConnection)?.state || "Unknown");
    setTextIfChanged(el.qbCounts, `${qbActive} active • ${qbPaused} paused • ${qbErrored} errored`);
    setTextIfChanged(el.qbRatio, `Global ratio ${parseEntityNumber(getEntity(IDS.qbGlobalRatio)).toFixed(2)}`);
    setTextIfChanged(
      el.qbLimits,
      `Limits ↓ ${formatSpeed(parseEntityNumber(getEntity(IDS.qbDownLimit)))} • ↑ ${formatSpeed(parseEntityNumber(getEntity(IDS.qbUpLimit)))}`
    );

    const altSpeedOn = getEntity(IDS.qbAltSpeed)?.state === "on";
    el.qbToggle.hidden = qbActive <= 0;
    el.qbToggle.disabled = !haConnected;
    setTextIfChanged(el.qbToggle, altSpeedOn ? "Turtle mode: ON" : "Turtle mode: OFF");

    setTextIfChanged(el.sonarrQueue, `${parseEntityNumber(getEntity(IDS.sonarrQueue))}`);
    setTextIfChanged(el.sonarrWanted, `${parseEntityNumber(getEntity(IDS.sonarrWanted))}`);
    setTextIfChanged(el.sonarrShows, `${parseEntityNumber(getEntity(IDS.sonarrShows))}`);
    const upcoming = getEntity(IDS.sonarrUpcoming);
    setTextIfChanged(el.sonarrUpcoming, upcoming?.state && upcoming.state !== "unknown" ? upcoming.state : "No upcoming");
    const commands = getEntity(IDS.sonarrCommands);
    setTextIfChanged(el.sonarrCommands, commands?.state || "No recent command");
    setTextIfChanged(el.sonarrUpdated, commands?.last_changed ? `updated ${formatRelativeTime(commands.last_changed)}` : "");

    const radarrHealthy = getEntity(IDS.radarrHealth)?.state === "on";
    setTextIfChanged(el.radarrHealth, radarrHealthy ? "Healthy" : "Unhealthy");
    setTextIfChanged(el.radarrQueue, `${parseEntityNumber(getEntity(IDS.radarrQueue))}`);
    setTextIfChanged(el.radarrMovies, `${parseEntityNumber(getEntity(IDS.radarrMovies))}`);

    const diskA = parseDiskAttributes(getEntity(IDS.radarrDiskA));
    const diskB = parseDiskAttributes(getEntity(IDS.radarrDiskB));
    renderDisks(diskA, el.radarrDiskA, el.radarrDiskABar);
    el.radarrDiskBWrap.hidden = !diskB.total;
    if (diskB.total) renderDisks(diskB, el.radarrDiskB, el.radarrDiskBBar);

    const startEntity = getEntity(IDS.radarrStart);
    setTextIfChanged(el.radarrStart, startEntity?.state && startEntity.state !== "unknown" ? startEntity.state : "—");

    const health = healthState();
    const qbDownState = String(getEntity(IDS.qbStatus)?.state || "").toLowerCase().includes("down");
    const qbConnBad = String(getEntity(IDS.qbConnection)?.state || "").toLowerCase().includes("disconnect");
    setStatusLevel(cards.qbit, qbDownState || qbConnBad ? "error" : qbErrored > 0 ? "warn" : "ok");
    setStatusLevel(cards.radarr, health.radarrHealthy ? "ok" : "error");
    setStatusLevel(cards.health, health.overall);

    if (health.overall === "ok") {
      setTextIfChanged(el.healthOverall, "OK");
      setTextIfChanged(el.healthSummary, "No active media automation issues");
    } else {
      const diskMsg = health.diskMin == null ? "disk n/a" : `disk ${health.diskMin.toFixed(1)}% free`;
      setTextIfChanged(el.healthOverall, health.overall === "error" ? "Attention" : "Warning");
      setTextIfChanged(el.healthSummary, `Radarr health ${health.radarrHealthy ? "OK" : "bad"} • qBit errors ${health.qbErrors} • ${diskMsg}`);
    }

    document.dispatchEvent(new Event("status:refresh-alerts"));
  }

  function queueRender() {
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      render();
    });
  }

  el.qbToggle?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!haConnected) return;
    el.qbToggle.disabled = true;
    try {
      await callHAService({
        domain: "switch",
        service: "toggle",
        serviceData: { entity_id: IDS.qbAltSpeed }
      });
    } catch (error) {
      console.warn("Unable to toggle qBittorrent alt speed", error);
    } finally {
      setTimeout(() => {
        el.qbToggle.disabled = !haConnected;
        queueRender();
      }, 300);
    }
  });

  function openModal(type) {
    if (!modal.root) return;
    modal.root.classList.add("is-active");
    modal.root.setAttribute("aria-hidden", "false");
    const titleMap = {
      qbit: "qBittorrent details",
      sonarr: "Sonarr details",
      radarr: "Radarr details",
      health: "Media health details"
    };
    setTextIfChanged(modal.title, titleMap[type] || "Media details");
    const bodyMap = {
      qbit: `${el.qbCounts?.textContent || ""} • ${el.qbLimits?.textContent || ""}`,
      sonarr: `Queue ${el.sonarrQueue?.textContent || "0"} • Wanted ${el.sonarrWanted?.textContent || "0"}`,
      radarr: `Queue ${el.radarrQueue?.textContent || "0"} • Movies ${el.radarrMovies?.textContent || "0"}`,
      health: el.healthSummary?.textContent || "No additional details"
    };
    setTextIfChanged(modal.body, bodyMap[type] || "");

    const linkMap = [
      [modal.qb, urls.qbittorrent],
      [modal.sonarr, urls.sonarr],
      [modal.radarr, urls.radarr]
    ];
    linkMap.forEach(([linkEl, href]) => {
      if (!linkEl) return;
      if (href) {
        linkEl.hidden = false;
        linkEl.href = href;
      } else {
        linkEl.hidden = true;
      }
    });
  }

  function closeModal(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    modal.root?.classList.remove("is-active");
    modal.root?.setAttribute("aria-hidden", "true");
  }

  Object.entries(cards).forEach(([type, card]) => {
    card?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openModal(type);
    });
  });

  modal.close?.addEventListener("click", closeModal);
  modal.root?.addEventListener("click", (event) => {
    if (event.target === modal.root) closeModal(event);
  });

  document.addEventListener("ha:state-updated", queueRender);
  on("ha:connected", () => {
    haConnected = true;
    queueRender();
  });
  on("ha:disconnected", () => {
    haConnected = false;
    queueRender();
  });

  tickTimer = setInterval(queueRender, 10_000);
  queueRender();

  return () => {
    if (tickTimer) clearInterval(tickTimer);
  };
}
