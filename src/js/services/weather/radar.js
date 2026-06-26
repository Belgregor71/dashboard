const OVERLAY_REFRESH_MS = 5 * 60 * 1000;

let tileGrid = null; // { z, tiles: [{x,y}] }
let refreshTimer = null;

function buildCell(z, tile) {
  const cell = document.createElement("div");
  cell.className = "weather-radar__cell";

  const base = document.createElement("img");
  base.className = "weather-radar__tile weather-radar__tile--base";
  base.alt = "";
  base.src = `/api/weather/radar/basemap/${z}/${tile.x}/${tile.y}`;

  const overlay = document.createElement("img");
  overlay.className = "weather-radar__tile weather-radar__tile--overlay";
  overlay.alt = "";
  overlay.dataset.z = z;
  overlay.dataset.x = tile.x;
  overlay.dataset.y = tile.y;

  cell.appendChild(base);
  cell.appendChild(overlay);
  return cell;
}

function refreshOverlays() {
  if (!tileGrid) return;
  const cacheBust = Date.now();
  document.querySelectorAll(".weather-radar__tile--overlay").forEach(img => {
    const { z, x, y } = img.dataset;
    img.src = `/api/weather/radar/overlay/${z}/${x}/${y}?t=${cacheBust}`;
  });
}

function updateTimestamp(frameTime) {
  const el = document.getElementById("weather-radar-updated");
  if (!el || !frameTime) return;
  const date = new Date(frameTime * 1000);
  el.textContent = `updated ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase().replace(/\s/g, "")}`;
}

export async function initWeatherRadar() {
  const grid = document.getElementById("weather-radar-grid");
  if (!grid) return;

  try {
    const res = await fetch("/api/weather/radar/meta");
    if (!res.ok) return;
    const meta = await res.json();
    if (!meta?.tiles?.length) return;

    tileGrid = meta;
    grid.innerHTML = "";
    meta.tiles.forEach(tile => grid.appendChild(buildCell(meta.z, tile)));
    refreshOverlays();
    updateTimestamp(meta.frameTime);
  } catch {
    // Non-fatal — radar panel just stays empty
    return;
  }

  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    try {
      const res = await fetch("/api/weather/radar/meta");
      if (res.ok) {
        const meta = await res.json();
        if (meta?.frameTime) updateTimestamp(meta.frameTime);
      }
    } catch { /* keep showing the last frame */ }
    refreshOverlays();
  }, OVERLAY_REFRESH_MS);
}
