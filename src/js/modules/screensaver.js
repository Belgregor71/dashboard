import { getLastCameraTrigger } from "./cameraTiles.js";
import { switchView } from "../core/viewManager.js";
import { emit } from "../core/eventBus.js";
import { freezeLotties, unfreezeLotties } from "../helpers/lottie.js";
import { getTimes as getSunTimes } from "../vendor/suncalc.js";
import { WEATHER_LAT, WEATHER_LON } from "../config/constants.js";

const IDLE_MS    = 5 * 60 * 1000;  // 5 min of no motion → engage
const PHOTO_MS   = 30 * 1000;       // rotate photo every 30s
const INFO_MS    = 15 * 1000;       // refresh ambient info lines every 15s
const MOTION_RECENT_MS = 30 * 60 * 1000; // "last motion" line only while fresh
const DRIFT_MS   = 4 * 60 * 1000;   // reposition every 4 min — gentle OLED/burn-in protection

// ─── Night mode (sunset → sunrise) ────────────────────────────
// Overnight the panel drops to a heavily-dimmed clock so it doesn't light
// the room. It engages the moment the sun sets (not just after idle) and
// auto-returns to the dashboard at sunrise.
const NIGHT_PHOTO_MS = 2 * 60 * 1000; // slower rotation at night — dimmer + GPU-quiet
const NIGHT_IDLE_MS  = 30 * 1000;     // settle back to the dim clock quickly after interaction
const NIGHT_CHECK_MS = 60 * 1000;     // watch for the sunset / sunrise boundary

let nightTimer  = null;

// Small, slow transform-only offsets (GPU-cheap) — kept modest so the
// content never drifts close to the screen edges.
const DRIFT_OFFSETS = [
  { x: 0, y: 0 },
  { x: 4, y: -3 },
  { x: -4, y: 3 },
  { x: 3, y: 3 },
  { x: -3, y: -4 }
];

let el          = null;
let photoEl     = null;
let contentEl   = null;
let timeEl      = null;
let datelineEl  = null;
let infoEl      = null;
let footerEl    = null;

let idleTimer   = null;
let photoTimer  = null;
let infoTimer   = null;
let clockTimer  = null;
let driftTimer  = null;
let driftIndex  = 0;
let active      = false;
let photos      = [];

// ─── DOM build ────────────────────────────────────────────────

function build() {
  el = document.createElement("div");
  el.id = "screensaver";
  el.className = "screensaver";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="screensaver__photo-bg">
      <img class="screensaver__photo" alt="" />
    </div>
    <div class="screensaver__overlay"></div>
    <div class="screensaver__content">
      <div class="screensaver__time"></div>
      <div class="screensaver__dateline"></div>
      <div class="screensaver__info"></div>
      <div class="screensaver__footer"></div>
    </div>
  `;
  document.body.appendChild(el);
  photoEl    = el.querySelector(".screensaver__photo");
  contentEl  = el.querySelector(".screensaver__content");
  timeEl     = el.querySelector(".screensaver__time");
  datelineEl = el.querySelector(".screensaver__dateline");
  infoEl     = el.querySelector(".screensaver__info");
  footerEl   = el.querySelector(".screensaver__footer");
}

async function loadPhotos() {
  try {
    const res   = await fetch("/api/photos");
    const files = await res.json();
    if (Array.isArray(files) && files.length > 0) {
      photos = files.map(f => {
        const name = String(f).replace(/^\/?photos\//, "");
        return `/photos/${encodeURIComponent(name)}`;
      });
    }
  } catch { /* non-fatal — screensaver works without photos */ }
}

// ─── Clock + dateline ───────────────────────────────────────────

function tickClock() {
  if (!timeEl || !datelineEl) return;
  const now = new Date();
  timeEl.textContent = now.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const weekday = now.toLocaleDateString("en-AU", { weekday: "long" });
  const temp = document.getElementById("current-temp")?.textContent?.trim();
  const cond = document.getElementById("current-conditions")?.textContent?.trim();
  datelineEl.textContent = [weekday, [temp, cond].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");
}

// ─── Ambient info lines ───────────────────────────────────────

function readPanelText(panelId, ...textSelectors) {
  const panel = document.getElementById(panelId);
  if (!panel || panel.classList.contains("is-collapsed") || panel.classList.contains("is-hidden")) {
    return null;
  }
  const parts = textSelectors
    .map(sel => document.querySelector(sel)?.textContent?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(" — ") : null;
}

function readCommuteLine() {
  const panel = document.getElementById("commute-panel");
  if (!panel || panel.classList.contains("is-collapsed") || panel.classList.contains("is-hidden")) {
    return null;
  }
  const parts = [
    document.getElementById("commute-greg")?.textContent?.trim(),
    document.getElementById("commute-brett")?.textContent?.trim()
  ].filter(Boolean);
  return parts.length ? `Commute: ${parts.join(" · ")}` : null;
}

function readNextEventLine() {
  const panel = document.getElementById("next-event-panel");
  if (!panel || panel.classList.contains("is-collapsed") || panel.classList.contains("is-hidden")) {
    return null;
  }
  const name = document.getElementById("next-event-name")?.textContent?.trim();
  const meta = document.getElementById("next-event-meta")?.textContent?.trim();
  return name ? [name, meta].filter(Boolean).join(" · ") : null;
}

function readNowPlayingLine() {
  for (const id of ["media-panel-1", "media-panel-2"]) {
    const panel = document.getElementById(id);
    if (!panel || panel.classList.contains("is-collapsed") || panel.classList.contains("is-hidden")) continue;
    const source = panel.querySelector(".media-panel__source")?.textContent?.trim();
    const title = panel.querySelector(".media-panel__title")?.textContent?.trim();
    if (title) return `Now playing: ${[source, title].filter(Boolean).join(" — ")}`;
  }
  return null;
}

function formatRelativeTime(timestamp) {
  const deltaMs = Date.now() - timestamp;
  const minutes = Math.round(deltaMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

function readLastMotionLine() {
  const trigger = getLastCameraTrigger();
  if (!trigger?.cameraName || !trigger?.timestamp) return null;
  if (Date.now() - trigger.timestamp > MOTION_RECENT_MS) return null;
  return `${trigger.cameraName}: motion ${formatRelativeTime(trigger.timestamp)}`;
}

function readTodayCountLine() {
  const events = window.__CAL_EVENTS__;
  if (!Array.isArray(events)) return null;
  const now = new Date();
  const count = events.filter(ev => ev?.start && new Date(ev.start).toDateString() === now.toDateString()).length;
  if (!count) return null;
  return count === 1 ? "1 event today" : `${count} events today`;
}

function updateInfo() {
  if (!infoEl || !footerEl) return;

  const lines = [
    readLastMotionLine(),
    readCommuteLine(),
    readNextEventLine(),
    readNowPlayingLine()
  ].filter(Boolean).slice(0, 3);

  infoEl.innerHTML = lines.map(line => `<div class="screensaver__info-line">${line}</div>`).join("");

  const footer = readTodayCountLine();
  footerEl.textContent = footer || "";
}

// ─── Content drift (burn-in protection) ────────────────────────

function applyDrift() {
  if (!contentEl) return;
  driftIndex = (driftIndex + 1) % DRIFT_OFFSETS.length;
  const { x, y } = DRIFT_OFFSETS[driftIndex];
  contentEl.style.transform = `translate(${x}vw, ${y}vh)`;
}

// ─── Photo rotation ───────────────────────────────────────────

// Ken Burns move classes (defined in screensaver.css). A fresh one is
// applied per photo so the slideshow doesn't repeat the same motion; the
// class is removed then re-added across a reflow to replay the animation
// (a CSS animation on the reused <img> won't restart on a src swap alone).
const KB_VARIANTS = ["ss-kb-1", "ss-kb-2", "ss-kb-3", "ss-kb-4", "ss-kb-5"];
let lastKbVariant = null;

function pickKbVariant() {
  let variant = lastKbVariant;
  while (variant === lastKbVariant) {
    variant = KB_VARIANTS[Math.floor(Math.random() * KB_VARIANTS.length)];
  }
  lastKbVariant = variant;
  return variant;
}

function showNextPhoto() {
  if (!photoEl || photos.length === 0) return;
  const src = photos[Math.floor(Math.random() * photos.length)];
  photoEl.classList.remove("screensaver__photo--visible", ...KB_VARIANTS);
  photoEl.src = src;
  photoEl.onload = () => {
    void photoEl.offsetWidth; // reflow so the re-added class replays from frame 0
    photoEl.classList.add("screensaver__photo--visible", pickKbVariant());
  };
}

// ─── Night mode ───────────────────────────────────────────────

// True between local sunset and sunrise (suncalc, dashboard coordinates).
// getSunTimes returns this calendar day's rise/set, so comparing against
// both bounds covers the whole night without needing adjacent days.
function isNight(now = new Date()) {
  const { sunrise, sunset } = getSunTimes(now, WEATHER_LAT, WEATHER_LON);
  if (!(sunrise instanceof Date) || !(sunset instanceof Date)) return false;
  if (Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime())) return false;
  return now < sunrise || now >= sunset;
}

function applyNight(night) {
  if (!el) return;
  el.classList.toggle("screensaver--night", night);
  el.dataset.night = night ? "1" : "0";
}

function startPhotoTimer(night) {
  clearInterval(photoTimer);
  photoTimer = null;
  if (photos.length > 0) {
    photoTimer = setInterval(showNextPhoto, night ? NIGHT_PHOTO_MS : PHOTO_MS);
  }
}

// Watches the sunset/sunrise boundary once a minute: engage the dim clock the
// moment night falls, and hand back to the dashboard at first light.
function syncNight() {
  const night = isNight();
  if (!active) {
    if (night) engageScreensaver();
    return;
  }
  const wasNight = el.dataset.night === "1";
  if (night === wasNight) return;
  if (night) {
    applyNight(true);        // sunset while already idling — dim in place
    startPhotoTimer(true);
  } else {
    exit();                  // sunrise — return to the dashboard
  }
}

// ─── Enter / Exit ─────────────────────────────────────────────

export function isScreensaverActive() {
  return active;
}

export function wakeScreensaver() {
  if (!active) return;
  exit();
}

// Force-enter immediately, bypassing the idle timer.
export function engageScreensaver() {
  clearTimeout(idleTimer);
  enter();
}

function enter() {
  if (active) return;
  active = true;

  el.dataset.mode = photos.length > 0 ? "photo" : "minimal";
  const night = isNight();
  applyNight(night);

  driftIndex = 0;
  if (contentEl) contentEl.style.transform = "translate(0, 0)";

  tickClock();
  updateInfo();
  showNextPhoto();

  el.classList.add("is-active");
  document.body.classList.add("screensaver-active");
  // Nobody is watching: freeze every lottie + (via CSS on .screensaver-active)
  // the marquee/aurora/stars. Any running animation composites the whole
  // dashboard at 60fps = ~1 GPU core on the Pi; this drops it to ~0.
  freezeLotties();

  clockTimer = setInterval(tickClock, 1000);
  infoTimer  = setInterval(updateInfo, INFO_MS);
  driftTimer = setInterval(applyDrift, DRIFT_MS);
  startPhotoTimer(night);

  // Mode 0 boundary for the presence FSM (screensaver stays the authority).
  emit("screensaver:changed", { active: true });
}

function exit() {
  if (!active) return;
  active = false;

  // Mode 0 → awake boundary for the presence FSM.
  emit("screensaver:changed", { active: false });

  clearInterval(clockTimer);
  clearInterval(infoTimer);
  clearInterval(photoTimer);
  clearInterval(driftTimer);
  clockTimer = null;
  infoTimer  = null;
  photoTimer = null;
  driftTimer = null;

  el.classList.remove("is-active");
  document.body.classList.remove("screensaver-active");
  unfreezeLotties();

  switchView("home");
  resetIdleTimer();
}

// ─── Idle timer ───────────────────────────────────────────────

export function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (active) return;
  // At night, settle back to the dim clock quickly rather than waiting 5 min.
  idleTimer = setTimeout(enter, isNight() ? NIGHT_IDLE_MS : IDLE_MS);
}

// ─── Init ─────────────────────────────────────────────────────

export async function initScreensaver() {
  await loadPhotos();
  build();
  resetIdleTimer();

  // Engage the dim clock straight away if it's already night, then watch the
  // sunset/sunrise boundary from here on.
  syncNight();
  nightTimer = setInterval(syncNight, NIGHT_CHECK_MS);

  // Debug/verification hooks (match __switchView, __forceInsight conventions).
  window.__engageScreensaver = engageScreensaver;
  window.__wakeScreensaver = wakeScreensaver;
  window.__ssNextPhoto = showNextPhoto;
  window.__isNight = isNight;

  // Any direct user interaction (click / tap / keypress) wakes screensaver
  ["click", "touchstart", "keydown"].forEach(evt =>
    document.addEventListener(evt, () => {
      if (active) exit();
      else resetIdleTimer();
    }, { passive: true })
  );
}
