const PANEL_ID = "server-status-panel";
const CONTAINER_ID = "plex-status";

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

function createTile(session) {
  const tile = document.createElement("div");
  tile.className = "plex-status__tile";
  const imageUrl = `/api/plex/image?path=${encodeURIComponent(session.thumb)}`;
  tile.style.backgroundImage = `url("${imageUrl}")`;

  const title = document.createElement("div");
  title.className = "plex-status__title";
  title.textContent = session.title || "Plex Stream";

  tile.appendChild(title);
  return tile;
}

function normalizeSessions(data) {
  if (Array.isArray(data.sessions)) return data.sessions;
  if (Array.isArray(data.MediaContainer?.Metadata)) return data.MediaContainer.Metadata;
  if (Array.isArray(data.Metadata)) return data.Metadata;
  return [];
}

function mapSession(session) {
  if (!session) return null;
  const isSeries =
    session.type === "episode" || session.type === "show" || session.type === "season";
  const seriesTitle = session.grandparentTitle || session.parentTitle;
  const episodeTitle = session.title;
  const thumb = isSeries
    ? session.parentThumb ||
      session.grandparentThumb ||
      session.thumb ||
      session.art
    : session.thumb ||
      session.art ||
      session.parentThumb ||
      session.grandparentThumb;
  if (!thumb) return null;
  const title = isSeries && seriesTitle && episodeTitle
    ? `${seriesTitle}: ${episodeTitle}`
    : episodeTitle || seriesTitle || "Plex Stream";
  return {
    title,
    thumb,
    sessionKey: session.sessionKey || null
  };
}

function renderSessions(container, sessions, emptyMessage) {
  const grid = container.querySelector(".plex-status__grid");
  const empty = container.querySelector(".plex-status__empty");
  if (!grid || !empty) return;

  const visibleSessions = sessions.slice(0, 2);
  grid.innerHTML = "";
  if (emptyMessage) {
    empty.textContent = emptyMessage;
  }
  empty.classList.toggle("is-hidden", visibleSessions.length > 0);
  grid.classList.toggle("is-hidden", visibleSessions.length === 0);

  grid.classList.remove("plex-status__grid--single", "plex-status__grid--double");
  if (visibleSessions.length === 1) {
    grid.classList.add("plex-status__grid--single");
  } else if (visibleSessions.length === 2) {
    grid.classList.add("plex-status__grid--double");
  }

  visibleSessions.forEach((session) => {
    grid.appendChild(createTile(session));
  });
}

async function fetchSessions() {
  const response = await fetch("/api/plex/sessions");
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { error: `Plex HTTP ${response.status}` };
  if (!response.ok) {
    return { ...data, error: data.error || `Plex HTTP ${response.status}` };
  }
  return data;
}

export function initPlexStatus({ refreshMs = 30_000, enabled = true } = {}) {
  const panel = document.getElementById(PANEL_ID);
  const container = document.getElementById(CONTAINER_ID);
  if (!panel || !container || !enabled) return;

  const load = async () => {
    try {
      const data = await fetchSessions();
      const sessions = normalizeSessions(data)
        .map(mapSession)
        .filter(Boolean);
      const seenSessions = new Set();
      const uniqueSessions = sessions.filter((session) => {
        const key = session.sessionKey || `${session.title}|${session.thumb}`;
        if (seenSessions.has(key)) return false;
        seenSessions.add(key);
        return true;
      });
      const detailSuffix = data.detail ? `: ${data.detail}` : "";
      const emptyMessage = data.configMissing
        ? "Plex not configured"
        : data.error
          ? `${data.error}${detailSuffix}`
          : "No active Plex streams";
      renderSessions(container, uniqueSessions, emptyMessage);
      if (uniqueSessions.length > 0) {
        showPanel(panel);
      } else {
        hidePanel(panel);
      }
    } catch (err) {
      console.error("Plex sessions error:", err);
      renderSessions(container, [], "Plex unavailable");
      hidePanel(panel);
    }
  };

  load();
  setInterval(load, refreshMs);
}
