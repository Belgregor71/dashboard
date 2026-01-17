const PANEL_ID = "server-status-panel";
const CONTAINER_ID = "plex-status";

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
  const thumb =
    session.thumb || session.parentThumb || session.grandparentThumb || session.art;
  if (!thumb) return null;
  return {
    title:
      session.title ||
      session.grandparentTitle ||
      session.parentTitle ||
      "Plex Stream",
    thumb
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
      const emptyMessage = data.configMissing
        ? "Plex not configured"
        : data.error
          ? data.error
          : "No active Plex streams";
      renderSessions(container, sessions, emptyMessage);
    } catch (err) {
      console.error("Plex sessions error:", err);
      renderSessions(container, [], "Plex unavailable");
    }
  };

  load();
  setInterval(load, refreshMs);
}
