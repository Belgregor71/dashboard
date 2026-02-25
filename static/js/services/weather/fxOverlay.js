const RAIN_DROP_COUNT = 30;
const GLASS_DROPLET_COUNT = 15;

const randomBetween = (min, max) => min + Math.random() * (max - min);

const rainDrops = Array.from({ length: RAIN_DROP_COUNT }, () => ({
  left: `${randomBetween(0, 100).toFixed(2)}%`,
  duration: `${randomBetween(1.2, 2.6).toFixed(2)}s`,
  delay: `${randomBetween(-2.4, 0).toFixed(2)}s`,
  opacity: randomBetween(0.24, 0.7).toFixed(2)
}));

const glassDroplets = Array.from({ length: GLASS_DROPLET_COUNT }, () => ({
  left: `${randomBetween(2, 98).toFixed(2)}%`,
  top: `${randomBetween(4, 96).toFixed(2)}%`,
  scale: randomBetween(0.6, 1.2).toFixed(2),
  delay: `${randomBetween(-5, 0).toFixed(2)}s`,
  duration: `${randomBetween(4.2, 8.8).toFixed(2)}s`
}));

function getOverlayHost() {
  return document.getElementById("weather-fx-overlay");
}

function normalizeCondition(conditionStringOrLabel) {
  return `${conditionStringOrLabel ?? ""}`.toLowerCase();
}

function modeFromCondition(conditionStringOrLabel) {
  const condition = normalizeCondition(conditionStringOrLabel);
  if (condition.includes("rain") || condition.includes("drizzle")) return "rain";
  if (condition.includes("sun") || condition.includes("clear")) return "sun";
  if (condition.includes("cloud")) return "cloud";
  return "default";
}

function appendGradientLayer(host, mode) {
  const layer = document.createElement("div");
  layer.className = `weather-fx-layer weather-fx-layer--${mode}`;
  host.appendChild(layer);
}

function buildRainMode(host) {
  appendGradientLayer(host, "rain");

  const rainLayer = document.createElement("div");
  rainLayer.className = "weather-fx-rain";

  rainDrops.forEach(drop => {
    const el = document.createElement("div");
    el.className = "fx-rain-drop";
    el.style.left = drop.left;
    el.style.animationDuration = drop.duration;
    el.style.animationDelay = drop.delay;
    el.style.opacity = drop.opacity;
    rainLayer.appendChild(el);
  });

  const glassLayer = document.createElement("div");
  glassLayer.className = "weather-fx-glass";

  glassDroplets.forEach(droplet => {
    const el = document.createElement("div");
    el.className = "fx-glass-droplet";
    el.style.left = droplet.left;
    el.style.top = droplet.top;
    el.style.transform = `scale(${droplet.scale})`;
    el.style.animationDelay = droplet.delay;
    el.style.animationDuration = droplet.duration;
    glassLayer.appendChild(el);
  });

  host.appendChild(rainLayer);
  host.appendChild(glassLayer);
}

function buildSunMode(host) {
  appendGradientLayer(host, "sun");

  const flareA = document.createElement("div");
  flareA.className = "fx-sun-flare fx-sun-flare--a";

  const flareB = document.createElement("div");
  flareB.className = "fx-sun-flare fx-sun-flare--b";

  host.appendChild(flareA);
  host.appendChild(flareB);
}

function buildCloudMode(host) {
  appendGradientLayer(host, "cloud");

  const driftA = document.createElement("div");
  driftA.className = "fx-cloud-drift fx-cloud-drift--a";

  const driftB = document.createElement("div");
  driftB.className = "fx-cloud-drift fx-cloud-drift--b";

  host.appendChild(driftA);
  host.appendChild(driftB);
}

function buildDefaultMode(host) {
  appendGradientLayer(host, "default");
}

export function clearWeatherFxOverlay() {
  const host = getOverlayHost();
  if (!host) return;
  host.replaceChildren();
  delete host.dataset.mode;
}

export function setWeatherFxOverlay(conditionStringOrLabel) {
  const host = getOverlayHost();
  if (!host) return;

  const mode = modeFromCondition(conditionStringOrLabel);
  if (host.dataset.mode === mode) return;

  host.replaceChildren();
  host.dataset.mode = mode;

  if (mode === "rain") {
    buildRainMode(host);
    return;
  }

  if (mode === "sun") {
    buildSunMode(host);
    return;
  }

  if (mode === "cloud") {
    buildCloudMode(host);
    return;
  }

  buildDefaultMode(host);
}
