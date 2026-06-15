const IDLE_MS       = 5 * 60 * 1000;  // 5 min of no motion → engage
const MODE_MS       = 30 * 1000;       // rotate modes every 30s
const MODES         = ["photo", "minimal"];

let el        = null;
let photoEl   = null;
let timeEl    = null;
let dateEl    = null;
let weatherEl = null;

let idleTimer  = null;
let modeTimer  = null;
let clockTimer = null;
let modeIndex  = 0;
let active     = false;
let photos     = [];

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
      <div class="screensaver__date"></div>
      <div class="screensaver__weather"></div>
    </div>
  `;
  document.body.appendChild(el);
  photoEl   = el.querySelector(".screensaver__photo");
  timeEl    = el.querySelector(".screensaver__time");
  dateEl    = el.querySelector(".screensaver__date");
  weatherEl = el.querySelector(".screensaver__weather");
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

// ─── Clock tick ───────────────────────────────────────────────

function tickClock() {
  if (!timeEl || !dateEl) return;
  const now = new Date();
  timeEl.textContent = now.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  dateEl.textContent = now.toLocaleDateString("en-AU", {
    weekday: "long",
    day:     "numeric",
    month:   "long",
  });
}

function updateWeather() {
  if (!weatherEl) return;
  const temp = document.getElementById("current-temp")?.textContent?.trim();
  const cond = document.getElementById("current-conditions")?.textContent?.trim();
  weatherEl.textContent = [temp, cond].filter(Boolean).join(" · ");
}

// ─── Mode cycling ─────────────────────────────────────────────

function applyMode() {
  const mode = MODES[modeIndex % MODES.length];
  el.dataset.mode = mode;

  if (mode === "photo" && photos.length > 0) {
    const src = photos[Math.floor(Math.random() * photos.length)];
    if (photoEl) {
      photoEl.classList.remove("screensaver__photo--visible");
      photoEl.src = src;
      photoEl.onload = () => photoEl.classList.add("screensaver__photo--visible");
    }
  } else if (mode === "minimal" && photoEl) {
    photoEl.classList.remove("screensaver__photo--visible");
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
// startMode: "photo" | "minimal" — which mode to show first.
export function engageScreensaver({ startMode = "minimal" } = {}) {
  clearTimeout(idleTimer);
  modeIndex = Math.max(0, MODES.indexOf(startMode));
  enter();
}

function enter() {
  if (active) return;
  active    = true;
  modeIndex = 0;

  tickClock();
  updateWeather();
  applyMode();

  el.classList.add("is-active");
  document.body.classList.add("screensaver-active");

  clockTimer = setInterval(tickClock, 1000);
  modeTimer  = setInterval(() => { modeIndex++; applyMode(); }, MODE_MS);
}

function exit() {
  if (!active) return;
  active = false;

  clearInterval(clockTimer);
  clearInterval(modeTimer);
  clockTimer = null;
  modeTimer  = null;

  el.classList.remove("is-active");
  document.body.classList.remove("screensaver-active");

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
