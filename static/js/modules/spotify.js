// static/js/modules/spotify.js

let spotifyTimer = null;

export function initSpotify({ intervalMs = 10_000 } = {}) {
  // prevent double init
  if (spotifyTimer) return;

  refreshSpotify();
  spotifyTimer = setInterval(refreshSpotify, intervalMs);
}

export async function refreshSpotify() {
  try {
    const res = await fetch("/api/spotify/now-playing");
    const data = await res.json();

    const panel = document.getElementById("spotify-panel");
    if (!panel) return;

    if (!data.isPlaying) {
      panel.style.display = "none";
      return;
    }

    panel.style.display = "grid";

    const art = document.getElementById("spotify-art");
    const track = document.getElementById("spotify-track");
    const artist = document.getElementById("spotify-artist");
    const bar = document.getElementById("spotify-progress-inner");

    if (art) art.src = data.albumArt || "";
    if (track) track.textContent = data.track || "";
    if (artist) artist.textContent = data.artist || "";

    if (bar && data.durationMs > 0) {
      const pct = (data.progressMs / data.durationMs) * 100;
      bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    }
  } catch (err) {
    console.error("Spotify error:", err);
    const panel = document.getElementById("spotify-panel");
    if (panel) panel.style.display = "none";
  }
}
