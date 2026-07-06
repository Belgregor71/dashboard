import { getLastCameraTrigger } from "./cameraTiles.js";
import { switchView } from "../core/viewManager.js";
import { syncLottiePlayback } from "../helpers/lottie.js";

const IDLE_MS    = 5 * 60 * 1000;  // 5 min of no motion → engage
const PHOTO_MS   = 30 * 1000;       // rotate photo every 30s
const INFO_MS    = 15 * 1000;       // refresh ambient info lines every 15s
const MOTION_RECENT_MS = 30 * 60 * 1000; // "last motion" line only while fresh
const DRIFT_MS   = 4 * 60 * 1000;   // reposition every 4 min — gentle OLED/burn-in protection

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

function showNextPhoto() {
  if (!photoEl || photos.length === 0) return;
  const src = photos[Math.floor(Math.random() * photos.length)];
  photoEl.classList.remove("screensaver__photo--visible");
  photoEl.src = src;
  photoEl.onload = () => photoEl.classList.add("screensaver__photo--visible");
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

  driftIndex = 0;
  if (contentEl) contentEl.style.transform = "translate(0, 0)";

  tickClock();
  updateInfo();
  showNextPhoto();

  el.classList.add("is-active");
  document.body.classList.add("screensaver-active");
  syncLottiePlayback(); // icons under the overlay would keep burning GPU

  clockTimer = setInterval(tickClock, 1000);
  infoTimer  = setInterval(updateInfo, INFO_MS);
  driftTimer = setInterval(applyDrift, DRIFT_MS);
  if (photos.length > 0) {
    photoTimer = setInterval(showNextPhoto, PHOTO_MS);
  }
}

function exit() {
  if (!active) return;
  active = false;

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
  syncLottiePlayback();

  switchView("home");
  resetIdleTimer();
}

// ─── Idle timer ───────────────────────────────────────────────

export function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (active) return;
  idleTimer = setTimeout(enter, IDLE_MS);
}

// ─── Init ─────────────────────────────────────────────────────

export async function initScreensaver() {
  await loadPhotos();
  build();
  resetIdleTimer();

  // Any direct user interaction (click / tap / keypress) wakes screensaver
  ["click", "touchstart", "keydown"].forEach(evt =>
    document.addEventListener(evt, () => {
      if (active) exit();
      else resetIdleTimer();
    }, { passive: true })
  );
}
