const ARR_REFRESH_MS = 10_000;
const SERVICES = ["sonarr", "radarr", "lidarr"];

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatServiceName(service) {
  if (service === "sonarr") return "TV";
  if (service === "radarr") return "Movies";
  if (service === "lidarr") return "Music";
  return service;
}

function renderArrPanel(data) {
  const panel = document.getElementById("arr-download-panel");
  const container = document.getElementById("arr-content");
  if (!panel || !container) return;

  if (!data?.active) {
    panel.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  container.innerHTML = "";

  SERVICES.forEach((service) => {
    const queue = safeArray(data[service]);
    if (!queue.length) return;

    const label = document.createElement("div");
    label.className = "arr-service-label";
    label.textContent = formatServiceName(service);
    container.appendChild(label);

    queue.forEach((item) => {
      const progress = Number(item?.progress) || 0;
      const row = document.createElement("div");
      row.className = "arr-row";
      row.innerHTML = `
        <div class="arr-title">${item?.title || "Unknown title"}</div>
        <div class="arr-progress">
          <div class="arr-bar" style="width:${Math.max(0, Math.min(progress, 100))}%"></div>
        </div>
        <div class="arr-meta">
          ${progress.toFixed(0)}%${item?.timeLeft ? ` • ETA ${item.timeLeft}` : ""}
        </div>
      `;
      container.appendChild(row);
    });
  });
}

function renderArrStrip(data) {
  const strip = document.getElementById("arr-summary-strip");
  const text = document.getElementById("arr-summary-text");
  if (!strip || !text) return;

  if (!data?.active) {
    strip.classList.add("hidden");
    return;
  }

  const counts = [
    `TV: ${safeArray(data.sonarr).length}`,
    `Movies: ${safeArray(data.radarr).length}`,
    `Music: ${safeArray(data.lidarr).length}`
  ];

  text.textContent = `Active Downloads — ${counts.join(" • ")}`;
  strip.classList.remove("hidden");
}

async function loadArrData() {
  try {
    const response = await fetch("/api/arr/summary", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    renderArrPanel(data);
    renderArrStrip(data);
  } catch (err) {
    console.error("ARR load error", err);
  }
}

export function initArrActivity() {
  loadArrData();
  setInterval(loadArrData, ARR_REFRESH_MS);
}
