import { getLastCameraTrigger } from "./cameraTiles.js";
import { switchView } from "../core/viewManager.js";
import { emit } from "../core/eventBus.js";
import { escapeHtml } from "../core/escapeHtml.js";
import { freezeLotties, unfreezeLotties } from "../helpers/lottie.js";
import { getTimes as getSunTimes, getPosition as getSunPosition } from "../vendor/suncalc.js";
import { WEATHER_LAT, WEATHER_LON } from "../config/config.js";
import { get as getContext, set as setContext, subscribe as subscribeContext } from "../core/contextStore.js";
import { atmosphereFor, ATMOSPHERE_TOKENS, skyWarmthFor } from "../services/atmosphere.js";
import { collectAmbientMemory, spendMemoryBudget } from "../core/memoryRuntime.js";
import { photosForToday } from "../services/photoMemory.js";
import {
  initAmbientArchive,
  startAmbientArchive,
  stopAmbientArchive,
  setArchiveMemory,
  archiveProbe
} from "./ambientArchive.js";

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
let tenderMarkEl = null; // study 01 (WP4): the faint 🕯, present only when the flag is on
let memoryEl = null;      // rollout WP-E: the captioned "on this day" whisper (flag-gated)
let memoryTitleEl = null;
let placeEl = null;        // Daily Memories: bottom-left year+location cluster (flag-gated)
let placeMapEl = null;     // the small travel map tile (non-AU photos only)
let placeCaptionEl = null;

let idleTimer   = null;
let photoTimer  = null;
let infoTimer   = null;
let clockTimer  = null;
let driftTimer  = null;
let tenderTimer = null; // WP4: holds a tender memory's photo, then resumes rotation
let driftIndex  = 0;
let active      = false;
let photos      = [];

// ─── Ambient atmosphere (Phase 5, flag-gated) ─────────────────
// When on, the Mode 0 scene carries a slow-settling tint driven by the real
// weather + light. Flag off → this whole block is inert and Mode 0 is unchanged.
let atmosphereEnabled = false;
// ─── Ambient substrate (Phase 7, flag-gated) ──────────────────
// When on, the atmo-* token is *also* written to a shared app root (the <body>)
// so the weather/light mood persists into the awake dashboard (GLANCE/DWELL),
// not just Mode 0. The screensaver keeps its own token for its overlay; the
// body token drives the awake tint (body.substrate::before, background.css).
// Flag off → body is never touched and Mode 0 is exactly the Phase 5/6 scene.
let substrateEnabled = false;
// ─── Immich photo source (Phase 9.5, flag-gated) ──────────────
// When on, the ambient rotation draws from the household's Immich library
// (whole-library random + today's on-this-day photos, server-proxied +
// downscaled). Flag off → this block is inert and photos come from static/photos.
let immichEnabled = false;
const ANNIVERSARY_RE = /\b(birthday|bday|anniversary)\b/i; // "on this day" earned memory
// ─── Daily Memories (features.dailyMemories, flag-gated) ──────
// When on, the ambient rotation is the FROZEN per-day "on this day" set from the
// server (/api/immich/daily-set) — stable all day, each frame carrying a subtle
// year+location caption (+ a small map tile for travel photos) shown bottom-left.
// Off → this block is inert and photos come from the immichPhotos blend / static.
let dailyMemoriesEnabled = false;
let loadedDay = null; // the toDateString() the current pool was built for (day-stable reload)

// ─── Ambient clock (study 05, flag-gated) ─────────────────────
// When on, the Mode 0 clock gets the study-05 treatment: tabular figures + a
// quieter meridiem, and its brightness tracks the *sun altitude* on a smooth
// curve (dims with the sky, never a hard sunset switch) rather than the binary
// night class. Flag off → this block is inert and the clock is unchanged.
let ambientClockEnabled = false;
// Study 01 (WP4): the tender ambient memory lane. When on, a tender memory
// surfaces wordlessly in Mode 0 (its photo + the 🕯 mark, held longer). Off →
// tender memories stay dropped (memoryRuntime), no mark element, byte-identical.
let ambientMemoryEnabled = false;
// Rollout WP-E: the captioned "on this day" memory whisper (bottom-right, eyebrow
// + title). Elevates the footer on-this-day line to the study-01 whisper. Off →
// no whisper element, the footer keeps the line, byte-identical.
let memoryWhisperEnabled = false;
// ─── Sky ramp (Living Window Phase 3, flag-gated) ─────────────
// When on, syncNight() steps --sky-warmth on <body> once a minute from the sun
// altitude (the --clock-dim pattern: a data-driven level the substrate's 60s
// settle eases toward — zero loops); background.css mixes it into the substrate
// tint so sunrise/sunset warm the room gradually, not on the hour-band edge.
let skyRampEnabled = false;
// Phase 3 nightSky: opts the atmosphere mapper into the atmo-night-clear token
// on clear nights (the starfield's resting state — atmoFx/runtime.js paints it).
let nightSkyEnabled = false;
// ─── Ambient Archive (features.ambientArchive, flag-gated) ────
// When on, Mode 0 stops being "a photo with a clock on it" and becomes the
// archive: the memory as a lit card in a deep instrument space, over the
// temporal spine's day rendered in three dimensions (docs/design/AMBIENT-ARCHIVE.md).
// The screensaver keeps owning the photo pool, the tender lane, the night curve
// and the clock — the archive is a RENDERER for what this module already holds.
// Off → no archive element, no body class, no hook: Mode 0 is byte-identical.
let archiveEnabled = false;
const CLOCK_DIM_DAY   = 0.9;  // sun well up → full ambient brightness
const CLOCK_DIM_NIGHT = 0.3;  // the small-hours floor — dim, never off
const CLOCK_ALT_DAY   = 6;    // ° above horizon mapped to CLOCK_DIM_DAY
const CLOCK_ALT_NIGHT = -18;  // ° (astronomical twilight) mapped to CLOCK_DIM_NIGHT

function sunAltitudeDeg(now = new Date()) {
  return (getSunPosition(now, WEATHER_LAT, WEATHER_LON).altitude * 180) / Math.PI;
}

// Map sun altitude → clock opacity along a smooth line clamped to the
// [night, day] floor/ceiling. Written as a custom property the CSS reads, so the
// value is continuous (a data-driven ambient level, not a per-frame animation)
// and the 2s opacity transition eases each minute's step.
function applyClockDim() {
  if (!ambientClockEnabled || !el) return;
  const t = Math.min(1, Math.max(0, (sunAltitudeDeg() - CLOCK_ALT_NIGHT) / (CLOCK_ALT_DAY - CLOCK_ALT_NIGHT)));
  const dim = CLOCK_DIM_NIGHT + t * (CLOCK_DIM_DAY - CLOCK_DIM_NIGHT);
  el.style.setProperty("--clock-dim", dim.toFixed(3));
}

// Phase 3 skyRamp: step the sun-altitude warmth onto the shared root. Runs on
// every syncNight tick (awake or not — the substrate is an awake surface too).
function applySkyWarmth() {
  if (!skyRampEnabled) return;
  document.body.style.setProperty("--sky-warmth", skyWarmthFor(sunAltitudeDeg()).toFixed(3));
}

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
    ${ambientMemoryEnabled ? `<div class="screensaver__tender-mark" aria-hidden="true">🕯</div>` : ""}
    ${memoryWhisperEnabled ? `<div class="screensaver__memory"><span class="screensaver__memory-eyebrow"><span class="ic">🕰</span> On this day</span><div class="screensaver__memory-title"></div></div>` : ""}
    ${dailyMemoriesEnabled ? `<div class="screensaver__place"><img class="screensaver__place-map" alt="" /><div class="screensaver__place-caption"></div></div>` : ""}
  `;
  document.body.appendChild(el);
  photoEl    = el.querySelector(".screensaver__photo");
  contentEl  = el.querySelector(".screensaver__content");
  timeEl     = el.querySelector(".screensaver__time");
  datelineEl = el.querySelector(".screensaver__dateline");
  infoEl     = el.querySelector(".screensaver__info");
  footerEl   = el.querySelector(".screensaver__footer");
  tenderMarkEl = el.querySelector(".screensaver__tender-mark"); // null when flag off
  memoryEl      = el.querySelector(".screensaver__memory");        // null when flag off
  memoryTitleEl = el.querySelector(".screensaver__memory-title");
  placeEl        = el.querySelector(".screensaver__place");         // null when flag off
  placeMapEl     = el.querySelector(".screensaver__place-map");
  placeCaptionEl = el.querySelector(".screensaver__place-caption");
}

const immichThumb = (id) => `/api/immich/asset/${encodeURIComponent(id)}/thumb`;
// A Live Photo's motion part, already normalised to a small faststart H.264 clip
// on the server. Built here rather than in ambientArchive.js for the same reason
// as `src` and `mapUrl`: the archive is a RENDERER for what this module holds,
// so it is handed URLs, never ids.
const immichClip = (id) => `/api/immich/asset/${encodeURIComponent(id)}/clip`;

// Phase 9.5: pull the ambient pool from Immich — today's on-this-day photos
// (boosted so they're likely to show) plus a whole-library random draw. Returns
// [] when Immich is unconfigured/unreachable so the caller falls back to static.
async function loadImmichPhotos() {
  try {
    const [otdRes, rndRes] = await Promise.all([
      fetch("/api/immich/on-this-day"),
      fetch("/api/immich/random?count=40")
    ]);
    const otd = otdRes.ok ? (await otdRes.json()).assets ?? [] : [];
    const rnd = rndRes.ok ? (await rndRes.json()).assets ?? [] : [];

    const onThisDay = photosForToday(otd, new Date()).map((p) => immichThumb(p.id));
    const random = rnd.map((a) => immichThumb(a.id));

    // De-dupe, on-this-day first (it also biases the random shuffle toward them).
    return [...new Set([...onThisDay, ...random])];
  } catch {
    return [];
  }
}

// Daily Memories: the frozen per-day set. Each frame is an object carrying its
// caption + optional travel-map URL (unlike the blend's bare src strings). Empty
// when the server has no set (Immich down / no memories) → caller falls back.
async function loadDailyMemories() {
  try {
    const res = await fetch("/api/immich/daily-set");
    if (!res.ok) return [];
    const items = (await res.json()).photos ?? [];
    if (!Array.isArray(items) || items.length === 0) return [];
    return items.map((p) => ({
      src: immichThumb(p.id),
      caption: p.caption || null,
      // The wall-clock hour it was taken. Only the Ambient Archive reads it (it
      // places the lit year-mark there); a frozen set built before the field
      // existed simply has none, and the year-line stays a plain lit line.
      hour: Number.isFinite(p.hour) ? p.hour : null,
      mapUrl: p.map ? `/api/immich/map?lat=${encodeURIComponent(p.lat)}&lng=${encodeURIComponent(p.lng)}` : null,
      // `motion` is the server's stat() of a finished clip, not anything Immich
      // claimed — so this is only ever set when the file is genuinely there and
      // playable, and the archive can never request a clip that 404s.
      clipSrc: p.motion ? immichClip(p.id) : null
    }));
  } catch {
    return [];
  }
}

async function loadStaticPhotos() {
  try {
    const res = await fetch("/api/photos");
    const files = await res.json();
    if (Array.isArray(files) && files.length > 0) {
      return files.map((f) => {
        const name = String(f).replace(/^\/?photos\//, "");
        return `/photos/${encodeURIComponent(name)}`;
      });
    }
  } catch { /* non-fatal — screensaver works without photos */ }
  return [];
}

async function loadPhotos() {
  // Claimed synchronously, before the first await: that is what makes
  // syncNight's day check an in-flight guard rather than a race (audit SS1/M4
  // — see tests/photo-reload.spec.js). Trade-off: a rebuild that fails still
  // marks the day loaded, so the pool holds yesterday's photos until tomorrow.
  loadedDay = new Date().toDateString();
  if (dailyMemoriesEnabled) {
    const daily = await loadDailyMemories();
    if (daily.length > 0) { photos = daily; return; }
    // No frozen set today → fall through to the immichPhotos blend / static.
  }
  if (immichEnabled) {
    const immich = await loadImmichPhotos();
    if (immich.length > 0) { photos = immich; return; }
    // Immich down/empty → fall through to the static library (never a blank frame).
  }
  const staticPhotos = await loadStaticPhotos();
  if (staticPhotos.length > 0) photos = staticPhotos;
}

// ─── Clock + dateline ───────────────────────────────────────────

function tickClock() {
  if (!timeEl || !datelineEl) return;
  const now = new Date();
  const time = now.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  // Ambient clock: wrap the am/pm so it can be set quieter and smaller (study
  // 05). Digits + meridiem are model-generated (numbers + "am"/"pm"), no
  // injection surface. Flag off → the plain string, byte-identical.
  const meridiem = ambientClockEnabled && time.match(/\s*([ap]m)\s*$/i);
  if (meridiem) {
    timeEl.innerHTML = `${time.slice(0, meridiem.index).trim()}<span class="screensaver__meridiem">${meridiem[1]}</span>`;
  } else {
    timeEl.textContent = time;
  }

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

// Earned memory (Phase 5): the quiet "on this day" line for the near-silent
// Mode 0 frame — today's birthday/anniversary markers, same grounded source
// and regex as the onThisDay predictive candidate (briefingData.js). Only ever
// present on days that actually have one, so it reads as occasional by nature.
function readOnThisDayTitle() {
  const events = window.__CAL_EVENTS__;
  if (!Array.isArray(events)) return null;
  const todayStr = new Date().toDateString();
  const match = events.find(ev =>
    ev?.start &&
    new Date(ev.start).toDateString() === todayStr &&
    ANNIVERSARY_RE.test(String(ev.title ?? ev.summary ?? ""))
  );
  return String(match?.title ?? match?.summary ?? "").trim() || null;
}

function readOnThisDayLine() {
  const title = readOnThisDayTitle();
  return title ? `🎉 ${title}` : null;
}

// WP-E: the captioned "on this day" whisper (bottom-right, eyebrow + title). When
// on, it carries the on-this-day surface and the footer drops its line. Fades on
// the 60s settle; hidden when today has no anniversary (silence is the default).
function updateMemoryWhisper() {
  if (!memoryWhisperEnabled || !memoryEl || !memoryTitleEl) return;
  const title = readOnThisDayTitle();
  if (title) {
    memoryTitleEl.textContent = title;
    memoryEl.classList.add("is-visible");
  } else {
    memoryEl.classList.remove("is-visible");
  }
}

function updateInfo() {
  if (!infoEl || !footerEl) return;

  const lines = [
    readLastMotionLine(),
    readCommuteLine(),
    readNextEventLine(),
    readNowPlayingLine()
  ].filter(Boolean).slice(0, 3);

  // These lines are read back out of other panels' textContent, so an upstream
  // title that arrived as markup is sitting here as literal text — interpolating
  // it raw would re-parse it as HTML (audit S6/H6).
  infoEl.innerHTML = lines.map(line => `<div class="screensaver__info-line">${escapeHtml(line)}</div>`).join("");

  updateMemoryWhisper();

  // The earned memory takes the quiet footer slot when today has one; otherwise
  // the footer keeps its plain event-count line. WP-E: when the memory whisper is
  // on, the on-this-day moves there, so the footer stays on the count line.
  const showFooterMemory = atmosphereEnabled && !memoryWhisperEnabled;
  const footer = (showFooterMemory && readOnThisDayLine()) || readTodayCountLine();
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

// Update the bottom-left year+location cluster for a Daily Memories frame. A bare
// string (tender lane / blend) or a captionless frame clears it. Inert (placeEl
// null) when the flag is off. Night hiding is handled in CSS.
function updatePlace(frame) {
  if (!placeEl) return;
  const caption = frame && typeof frame === "object" ? frame.caption : null;
  const mapUrl  = frame && typeof frame === "object" ? frame.mapUrl : null;
  if (!caption) {
    placeEl.classList.remove("is-visible");
    placeMapEl.classList.remove("is-visible");
    return;
  }
  placeCaptionEl.textContent = caption;
  if (mapUrl) {
    // Only reveal the tile once it actually loads — a 404/502 (no key / unreachable)
    // hides it rather than showing a broken-image box; the caption still stands.
    placeMapEl.onload = () => placeMapEl.classList.add("is-visible");
    placeMapEl.onerror = () => placeMapEl.classList.remove("is-visible");
    placeMapEl.classList.remove("is-visible");
    placeMapEl.src = mapUrl;
  } else {
    placeMapEl.classList.remove("is-visible");
    placeMapEl.removeAttribute("src");
  }
  placeEl.classList.add("is-visible");
}

// Swap the frame to a specific image with a fresh Ken Burns move. Shared by the
// random slideshow and the tender-memory lane (WP4). `frame` is a src string or a
// Daily Memories object { src, caption, mapUrl }.
function setPhoto(frame) {
  if (!photoEl) return;
  const src = typeof frame === "string" ? frame : frame?.src;
  if (!src) return;
  // The archive owns the frame when it is on: the memory becomes the card, the
  // echo behind it and the plate beside it. The full-bleed <img> and the
  // bottom-left place caption are display:none under fx-archive-active, so
  // feeding them here would only buy a decode and a map-tile fetch nobody sees.
  if (archiveEnabled) {
    setArchiveMemory(frame);
    return;
  }
  photoEl.classList.remove("screensaver__photo--visible", ...KB_VARIANTS);
  photoEl.src = src;
  photoEl.onload = () => {
    void photoEl.offsetWidth; // reflow so the re-added class replays from frame 0
    photoEl.classList.add("screensaver__photo--visible", pickKbVariant());
  };
  updatePlace(frame);
}

function showNextPhoto() {
  if (!photoEl || photos.length === 0) return;
  setPhoto(photos[Math.floor(Math.random() * photos.length)]);
}

// ─── Tender ambient memory lane (study 01, WP4) ───────────────
// A tender memory surfaces ONLY here, in Mode 0, and ONLY wordlessly: its photo
// fills the frame + a faint 🕯 mark, held longer than an ordinary rotation, then
// the ambient slideshow resumes. No caption ever reaches the screen — the gating
// (ambientOnly/caption:null/longer hold) is enforced in memoryEngine.toSurface;
// this lane also refuses any non-tender surface, so the invariant holds no matter
// who calls it.

// Resolve a memory photo ref → a URL. Immich assets are { immich:id }; authored
// entries are string paths (absolute/rooted as-is, bare names under /photos/).
function memoryPhotoSrc(ref) {
  if (ref && typeof ref === "object" && ref.immich) return immichThumb(ref.immich);
  const s = String(ref ?? "");
  if (/^(https?:|\/)/.test(s)) return s;
  return `/photos/${s.split("/").map(encodeURIComponent).join("/")}`;
}

function showTenderMark() {
  if (tenderMarkEl) tenderMarkEl.classList.add("is-visible");
}

function hideTenderMark() {
  if (tenderMarkEl) tenderMarkEl.classList.remove("is-visible");
}

// Render a tender surface: its photo, wordlessly, held for holdMs, then resume
// the ambient slideshow. Refuses a non-tender surface (belt-and-braces with the
// engine gating). Spends the day's memory budget so nothing else surfaces today.
function surfaceTenderMemory(surface, night = isNight()) {
  if (!ambientMemoryEnabled || !surface || !surface.ambientOnly) return false;
  const ref = Array.isArray(surface.photos) ? surface.photos[0] : null;
  if (!ref) return false;

  clearInterval(photoTimer); photoTimer = null; // the lane owns the frame for the hold
  clearTimeout(tenderTimer);

  // `tender: true` is belt-and-braces with memoryEngine.toSurface's caption:null
  // — the archive refuses to build a plate for it either way, so a tender memory
  // reaches the wall wordless no matter which path put it there (§4.3).
  setPhoto({ src: memoryPhotoSrc(ref), tender: true });
  showTenderMark();
  spendMemoryBudget(new Date());

  const holdMs = Number.isFinite(surface.holdMs) ? surface.holdMs : 22_000;
  tenderTimer = setTimeout(() => {
    tenderTimer = null;
    hideTenderMark();
    showNextPhoto();
    startPhotoTimer(night); // hand the frame back to the ordinary slideshow
  }, holdMs);
  return true;
}

// On Mode-0 entry, offer the day's tender memory (if any) to the wordless lane.
function maybeSurfaceTenderMemory(night) {
  if (!ambientMemoryEnabled) return false;
  const surface = collectAmbientMemory({}, new Date()); // null unless the day fits a tender entry
  return surface ? surfaceTenderMemory(surface, night) : false;
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

// ─── Ambient atmosphere ───────────────────────────────────────
// Map real weather (contextStore) + light into one resting tint token and swap
// it onto the screensaver root. Class swap on an existing node — no new surface,
// no loop — so it settles to rest and stays off the GPU (project-gpu-idle-freeze).
function computeToken() {
  return atmosphereFor({
    condition: getContext().condition,
    isNight: isNight(),
    hour: new Date().getHours(),
    nightClear: nightSkyEnabled
  });
}

function applyAtmosphere() {
  if (!atmosphereEnabled || !el) return;
  const token = computeToken();
  el.classList.remove(...ATMOSPHERE_TOKENS);
  el.classList.add(token);
  // Phase 7: mirror the resting token onto the shared root so it survives the
  // exit into GLANCE/DWELL — a class swap on <body>, no new surface, no loop.
  if (substrateEnabled) applySubstrateToken(token);
}

// Write the atmosphere token to the shared app root (<body>). Only ever touched
// while the substrate flag is on, so flag-off behaviour is byte-identical.
function applySubstrateToken(token) {
  document.body.classList.remove(...ATMOSPHERE_TOKENS);
  document.body.classList.add(token);
}

function clearAtmosphere() {
  if (!el) return;
  el.classList.remove(...ATMOSPHERE_TOKENS);
  // The body token is deliberately NOT cleared on exit — the awake dashboard
  // keeps the mood. Re-settle it to the current state in case the day/night
  // boundary moved while Mode 0 was up.
  if (substrateEnabled) applySubstrateToken(computeToken());
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
  // Daily Memories: rebuild the frozen set once the calendar day rolls over
  // (stable within a day, never the 6-hour reshuffle). Fire-and-forget.
  if (dailyMemoriesEnabled && new Date().toDateString() !== loadedDay) loadPhotos();
  // Publish the day/night boundary to the shared store so consumers (Phase 6
  // House Model) read one authoritative value instead of recomputing suncalc.
  // syncNight runs at init + every minute + on the boundary, so the slice stays
  // current. (The slice was declared in Phase 5 but never actually written.)
  setContext({ isNight: night });
  applySkyWarmth(); // steps once a minute, awake or not (flag-gated inside)
  if (!active) {
    if (night) engageScreensaver();
    return;
  }
  applyClockDim(); // graded dim tracks the sky every minute while engaged (flag-gated inside)
  const wasNight = el.dataset.night === "1";
  if (night === wasNight) return;
  if (night) {
    applyNight(true);        // sunset while already idling — dim in place
    applyAtmosphere();       // and settle the tint to its night state
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
  applyAtmosphere();
  // Mode 0 is the archive's whole cause: `body.fx-archive-active` goes on here
  // and comes off in exit(), and every loop in ambient-archive.css hangs off it.
  startAmbientArchive();

  driftIndex = 0;
  if (contentEl) contentEl.style.transform = "translate(0, 0)";

  tickClock();
  applyClockDim();
  updateInfo();
  // WP4: a tender memory (if the day fits one) takes the frame wordlessly and
  // manages its own hold+resume; otherwise the ordinary slideshow starts.
  const tender = maybeSurfaceTenderMemory(night);
  if (!tender) showNextPhoto();

  el.classList.add("is-active");
  document.body.classList.add("screensaver-active");
  // Nobody is watching: freeze every lottie + (via CSS on .screensaver-active)
  // the marquee/aurora/stars. Any running animation composites the whole
  // dashboard at 60fps = ~1 GPU core on the Pi; this drops it to ~0.
  freezeLotties();

  clockTimer = setInterval(tickClock, 1000);
  infoTimer  = setInterval(updateInfo, INFO_MS);
  driftTimer = setInterval(applyDrift, DRIFT_MS);
  if (!tender) startPhotoTimer(night); // the tender lane resumes the slideshow after its hold

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
  clearTimeout(tenderTimer); // WP4: drop any in-flight tender hold + its mark
  clockTimer = null;
  infoTimer  = null;
  photoTimer = null;
  driftTimer = null;
  tenderTimer = null;
  hideTenderMark();

  el.classList.remove("is-active");
  document.body.classList.remove("screensaver-active");
  stopAmbientArchive(); // the cause ends, so the motion ends — not merely hidden
  clearAtmosphere();
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

export async function initScreensaver(options = {}) {
  atmosphereEnabled = options.atmosphereEnabled === true;
  // Phase 7: the substrate only makes sense with the atmosphere mapper feeding
  // it a token, so it rides on top of the Phase 5 flag.
  substrateEnabled = atmosphereEnabled && options.substrateEnabled === true;
  // Phase 9.5: source the ambient photo pool from Immich when enabled.
  immichEnabled = options.immichEnabled === true;
  // Daily Memories: the frozen per-day "on this day" set + bottom-left year/location
  // caption (set before build() so the place element only exists when the flag is
  // on → flag-off is byte-identical).
  dailyMemoriesEnabled = options.dailyMemories === true;
  // Study 05: the ambient-clock treatment (tabular face + sun-altitude dim).
  ambientClockEnabled = options.ambientClockEnabled === true;
  // Study 01 (WP4): the tender ambient memory lane (set before build() so the
  // mark element is only ever in the DOM when the flag is on → flag-off is
  // byte-identical).
  ambientMemoryEnabled = options.ambientMemoryEnabled === true;
  // Rollout WP-E: the captioned "on this day" whisper (also set before build()
  // so its element only exists when the flag is on).
  memoryWhisperEnabled = options.memoryWhisperEnabled === true;
  // Living Window Phase 3: sun-altitude substrate warmth + the clear-night token.
  skyRampEnabled = options.skyRampEnabled === true;
  nightSkyEnabled = options.nightSkyEnabled === true;

  build();
  // The Ambient Archive mounts INSIDE #screensaver, so the blank rule
  // (`body.screensaver-active > *:not(#screensaver)…`, which selects body
  // children) never reaches it — the trap that shipped the spine invisible in
  // the one mode it exists for. Flag-off builds nothing at all.
  archiveEnabled = initAmbientArchive({
    enabled: options.archiveEnabled === true,
    liveMotion: options.archiveMotionEnabled === true,
    mount: el
  });
  // Feature marker — the study-05 CSS engages only under this class, so flag-off
  // is byte-identical (no class, no --clock-dim, plain clock string).
  if (ambientClockEnabled) el.classList.add("screensaver--ambient-clock");

  // Debug/verification hooks — registered right after the DOM exists but BEFORE
  // the async photo load, so they're available regardless of photo-fetch latency
  // (the presence/dissolve specs drive __engageScreensaver straight after boot;
  // engage/wake/showNextPhoto all handle an empty pool, which loadPhotos fills in
  // just below). Match __switchView / __forceInsight conventions.
  window.__engageScreensaver = engageScreensaver;
  window.__wakeScreensaver = wakeScreensaver;
  window.__ssNextPhoto = showNextPhoto;
  // Put a SPECIFIC frame up — a src string, or the `{ src, caption, hour }`
  // shape the Daily Memories set serves. The Pi has no way to wait for a
  // particular memory to come round, so this is how the archive's plate, ghost
  // year and lit year-line get checked live over CDP.
  window.__ssSetFrame = (frame) => { setPhoto(frame); return true; };
  window.__isNight = isNight;
  // Daily Memories — inspect the live bottom-left caption/map over CDP (the Pi check).
  window.__ssPlace = () => ({
    enabled: dailyMemoriesEnabled,
    count: photos.length,
    caption: placeEl?.classList.contains("is-visible") ? (placeCaptionEl?.textContent || null) : null,
    map: placeMapEl?.classList.contains("is-visible") ? (placeMapEl.getAttribute("src") || null) : null
  });
  // Ambient Archive — inspect the live instrument over CDP: which years the
  // deck carries, which one is lit, where now sits, and whether the plate is
  // up (the tender-no-plate invariant, readable from outside). Registered only
  // when the flag is on → flag-off exposes no hook.
  if (archiveEnabled) window.__archive = archiveProbe;
  // Study 05 — inspect the live ambient-clock dim over CDP (the 3–4m/on-Pi check).
  window.__ambientClock = () => ({
    enabled: ambientClockEnabled,
    altitudeDeg: ambientClockEnabled ? +sunAltitudeDeg().toFixed(2) : null,
    dim: el ? el.style.getPropertyValue("--clock-dim") || null : null
  });

  // Study 01 (WP4) — inspect + drive the tender lane over CDP. Registered only
  // when the flag is on → flag-off exposes no hook. __forceAmbientMemory renders
  // a surface exactly as a real tender memory would (the Pi has no authored data),
  // and REFUSES any non-tender surface — the render-boundary half of the invariant.
  if (ambientMemoryEnabled) {
    window.__ambientMemory = () => ({
      enabled: true,
      markVisible: Boolean(tenderMarkEl?.classList.contains("is-visible")),
      held: Boolean(tenderTimer),
      // proof of wordlessness: the only text anywhere near the memory is the 🕯
      // glyph itself — never a caption line.
      markText: tenderMarkEl?.textContent ?? null,
      // Whichever surface currently holds the frame — the archive's card when
      // it is on, the full-bleed <img> when it is not.
      photo: (archiveEnabled ? archiveProbe().photo : photoEl?.getAttribute("src")) ?? null
    });
    window.__forceAmbientMemory = (surface) => {
      if (!surface || !surface.ambientOnly) return { refused: true }; // lane refuses non-tender
      if (!active) engageScreensaver();
      surfaceTenderMemory(surface);
      return window.__ambientMemory();
    };
  }

  // Force an atmosphere token over CDP to check each tint live without waiting
  // for the weather (convention: __isNight / __nowcastProbe).
  window.__atmosphere = (forced) => {
    if (forced && el) {
      el.classList.remove(...ATMOSPHERE_TOKENS);
      el.classList.add(forced);
      // Phase 7: also drive the shared root so a forced token can be checked
      // persisting into the awake screen (the dissolve.spec persistence test).
      if (substrateEnabled) applySubstrateToken(forced);
    }
    const token = el ? [...el.classList].find(c => c.startsWith("atmo-")) ?? null : null;
    const bodyToken = [...document.body.classList].find(c => c.startsWith("atmo-")) ?? null;
    return {
      enabled: atmosphereEnabled, substrate: substrateEnabled, active, token, bodyToken,
      // Phase 3 skyRamp — the live warmth step, for CDP verification.
      skyRamp: skyRampEnabled,
      skyWarmth: document.body.style.getPropertyValue("--sky-warmth") || null
    };
  };

  await loadPhotos();

  // Mark the shared root and settle the initial awake tint so the dashboard is
  // already dressed at boot (the display comes up awake in daytime).
  if (substrateEnabled) {
    document.body.classList.add("substrate");
    applySubstrateToken(computeToken());
  }

  resetIdleTimer();

  // Engage the dim clock straight away if it's already night, then watch the
  // sunset/sunrise boundary from here on.
  syncNight();
  nightTimer = setInterval(syncNight, NIGHT_CHECK_MS);

  // Phase 9.5: refresh the Immich pool a few times a day so on-this-day rolls
  // over and the random draw stays fresh. Init-once timer (CLAUDE.md kiosk
  // discipline — no per-event teardown). Inert unless the flag is on. Skipped
  // under Daily Memories — its set is frozen per day and rebuilt on the day
  // rollover (syncNight) instead of reshuffling every 6 hours.
  if (immichEnabled && !dailyMemoriesEnabled) setInterval(loadPhotos, 6 * 60 * 60 * 1000);

  // Re-settle the tint whenever the shared weather slice shifts while Mode 0 is
  // up (the 10-min weather refresh feeds contextStore.condition). Init-once, so
  // no per-event teardown needed (see CLAUDE.md kiosk memory discipline).
  if (atmosphereEnabled) {
    subscribeContext(() => {
      if (active) applyAtmosphere();
      // Keep the awake substrate tracking the weather even while the dashboard
      // is up (Mode 0's applyAtmosphere covers the active case).
      else if (substrateEnabled) applySubstrateToken(computeToken());
    });
  }

  // Any direct user interaction (click / tap / keypress) wakes screensaver
  ["click", "touchstart", "keydown"].forEach(evt =>
    document.addEventListener(evt, () => {
      if (active) exit();
      else resetIdleTimer();
    }, { passive: true })
  );
}
