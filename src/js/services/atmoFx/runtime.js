// Living-window effects runtime — Phase 1 (rain on glass + storm lightning).
// Executes the episodes the pure planner (./planner.js) hands it, one at a
// time, on exactly two lazily-created nodes:
//
//   #atmo-fx-canvas — the "window glass" in front of the whole UI. Shown only
//     while an episode runs or holds; display:none between episodes, so the
//     ambient GPU-0% baseline is structural, not a matter of discipline.
//   #atmo-fx-veil   — the lightning illumination layer (screen-blend horizon
//     glow). Strikes are one-shot CSS keyframes (src/css/utils/atmo-fx.css),
//     zero rAF frames; JS only sets --flash-x/--flash-peak and the class.
//
// Leak discipline (CLAUDE.md 24/7 kiosk): every timeout lives in one registry
// cleared on cancel; cleanup is always setTimeout-based (never transitionend —
// it doesn't fire under display:none); stopAtmoFx() is the full symmetric
// teardown. Flag-off, initAtmoFx() returns before touching the DOM.

import { planNextEpisode } from "./planner.js";
import { get as getContext, subscribe as subscribeContext } from "../../core/contextStore.js";
import { on } from "../../core/eventBus.js";

const CANVAS_FADE_MS = 1400;   // matches the opacity transition in atmo-fx.css
const VEIL_SETTLE_MS = 400;    // margin after the last strike's decay ends
const GLASS_PULSE_MS = 450;    // sheen held per strike; the 1s-out transition decays it
const STAR_COUNT = 110;        // painted starfield size — a render detail, not a budget
                               // (the planner budget caps how many may twinkle at once)

let enabledRain = false;
let enabledLightning = false;
let enabledGlass = false;      // Phase 2 reactiveGlass: strikes pulse --glass-sheen
let enabledNightSky = false;   // Phase 3 nightSky: clear-night starfield + twinkles
let glassPulseTimer = null;    // the pending body-class release for the current pulse
let canvas = null;
let ctx = null;
let veil = null;
let mode = "awake";            // "ambient" while the screensaver is up
let planTimer = null;          // timeout waiting for the next episode's startAt
let phaseTimers = new Set();   // every in-flight timeout inside an episode
let rafId = null;
let running = null;            // the episode currently executing, or null
let lastWeather = null;        // last store slice we planned against
let lastIsNight = null;        // last day/night boundary we synced against
let stars = null;              // the painted field [{x,y,r,a}] while the sky is up
let nightLive = false;         // the starfield currently owns the resting canvas
let unsubscribeStore = null;

// ── tiny helpers ────────────────────────────────────────────────

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function addTimer(ms, fn) {
  const id = setTimeout(() => {
    phaseTimers.delete(id);
    fn();
  }, ms);
  phaseTimers.add(id);
  return id;
}

function clearPhaseTimers() {
  phaseTimers.forEach(id => clearTimeout(id));
  phaseTimers.clear();
}

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ── planning loop ───────────────────────────────────────────────

// The planner sees only the lanes whose flags are on: a "clear" category kills
// the rain lane, thunder:false kills the lightning lane.
function flaggedWeather(weather) {
  if (!weather) return null;
  return {
    ...weather,
    category: enabledRain ? weather.category : "clear",
    thunder: enabledLightning && weather.thunder === true
  };
}

// Phase 3 nightSky: the twinkle lane (and the resting starfield) exist only on
// a clear night in ambient mode while the flag is on.
function nightSkyWanted() {
  const c = getContext();
  return enabledNightSky && mode === "ambient" && c.isNight === true &&
    Boolean(c.weather) && c.weather.category === "clear";
}

function replan() {
  if (planTimer) {
    clearTimeout(planTimer);
    planTimer = null;
  }
  if (!canvas || running) return; // torn down, or completion re-plans
  const episode = planNextEpisode({
    weather: flaggedWeather(getContext().weather),
    mode,
    now: Date.now(),
    night: nightSkyWanted()
  });
  if (!episode) return;
  planTimer = setTimeout(() => {
    planTimer = null;
    execute(episode);
  }, Math.max(0, episode.startAt - Date.now()));
}

function finish() {
  running = null;
  syncNightSky(); // reconcile the resting canvas: starfield back up, or cleared
  replan();
}

function execute(episode) {
  running = episode;
  if (episode.type === "lightning") {
    runLightning(episode);
  } else if (episode.type === "twinkle") {
    runTwinkle(episode);
  } else {
    runRain(episode);
  }
}

// Hard cut of everything in flight — used on mode change and teardown. The
// screensaver's own enter/exit fade covers the visual cut.
function cancelAll() {
  if (planTimer) {
    clearTimeout(planTimer);
    planTimer = null;
  }
  clearPhaseTimers();
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (canvas) {
    canvas.classList.remove("fx-visible");
    canvas.style.display = "none";
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (veil) {
    veil.classList.remove("fx-strike");
    veil.style.display = "none";
  }
  glassPulseTimer = null; // its timeout died with clearPhaseTimers above
  document.body.classList.remove("fx-lightning-active");
  nightLive = false; // the resting canvas is gone; syncNightSky repaints if earned
  running = null;
}

// ── lightning (zero rAF — one-shot CSS keyframes on the veil) ───

function strike(peak) {
  veil.classList.remove("fx-strike");
  void veil.offsetWidth; // restart the one-shot animation
  veil.style.setProperty("--flash-peak", peak.toFixed(2));
  veil.classList.add("fx-strike");
  pulseGlass();
}

// Phase 2 reactive glass: each strike briefly holds body.fx-lightning-active,
// which raises --glass-sheen (layout/background.css); the consuming cards'
// box-shadow transitions carry the 150ms-in / 1s-out reflection. An aftershock
// landing mid-pulse just extends the hold.
function pulseGlass() {
  if (!enabledGlass) return;
  document.body.classList.add("fx-lightning-active");
  if (glassPulseTimer) {
    clearTimeout(glassPulseTimer);
    phaseTimers.delete(glassPulseTimer);
  }
  glassPulseTimer = addTimer(GLASS_PULSE_MS, () => {
    glassPulseTimer = null;
    document.body.classList.remove("fx-lightning-active");
  });
}

function runLightning(episode) {
  const { peak, x, aftershocks } = episode.params;
  veil.style.setProperty("--flash-x", x.toFixed(3));
  veil.style.display = "block";
  strike(peak);
  for (const shock of aftershocks) {
    addTimer(shock.offsetMs, () => strike(shock.peak));
  }
  addTimer(episode.durationMs + VEIL_SETTLE_MS, () => {
    veil.classList.remove("fx-strike");
    veil.style.display = "none";
    finish();
  });
}

// ── rain on glass (bounded rAF, then static hold, then fade) ────

function buildDroplets(params, w, h) {
  const droplets = [];
  for (let i = 0; i < params.droplets; i++) {
    droplets.push({
      x: rand(0.05, 0.95) * w,
      y: rand(0.05, 0.8) * h,
      r: rand(2.5, 7),
      appearAt: rand(0, params.fadeInMs * 0.7),
      seed: rand(0, Math.PI * 2),
      slider: false,
      merged: false,
      trailY0: 0,
      slideDist: 0
    });
  }
  // The largest few become sliders — big drops are the ones gravity wins.
  droplets
    .slice()
    .sort((a, b) => b.r - a.r)
    .slice(0, params.sliders)
    .forEach(d => {
      d.slider = true;
      d.trailY0 = d.y;
      d.slideDist = rand(100, 300);
    });
  return droplets;
}

function buildStreaks(count, w, h) {
  const streaks = [];
  for (let i = 0; i < count; i++) {
    streaks.push({ x: rand(0, w), y: rand(-h, h), z: rand(0.3, 1) });
  }
  return streaks;
}

function drawDroplet(d, alpha) {
  if (alpha <= 0 || d.merged) return;
  // Fake refraction: dark rim + cool inner tint + offset specular. No backdrop
  // sampling — at room distance on the 32" panel this reads as glass.
  const g = ctx.createRadialGradient(
    d.x - d.r * 0.3, d.y - d.r * 0.35, d.r * 0.15,
    d.x, d.y, d.r
  );
  g.addColorStop(0, `rgba(235,245,255,${0.5 * alpha})`);
  g.addColorStop(0.65, `rgba(180,205,235,${0.22 * alpha})`);
  g.addColorStop(1, `rgba(15,30,55,${0.38 * alpha})`);
  ctx.beginPath();
  ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(d.x - d.r * 0.35, d.y - d.r * 0.4, d.r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${0.65 * alpha})`;
  ctx.fill();
}

function drawTrail(d, alpha) {
  if (d.y <= d.trailY0 + 1) return;
  const tg = ctx.createLinearGradient(d.x, d.trailY0, d.x, d.y);
  tg.addColorStop(0, "rgba(190,210,235,0)");
  tg.addColorStop(1, `rgba(190,210,235,${0.16 * alpha})`);
  ctx.strokeStyle = tg;
  ctx.lineWidth = d.r * 0.8;
  ctx.beginPath();
  ctx.moveTo(d.x, d.trailY0);
  ctx.lineTo(d.x, d.y);
  ctx.stroke();
}

function smoothstep(v) {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
}

function runRain(episode) {
  if (reducedMotion()) {
    finish();
    return;
  }
  const { params } = episode;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;   // DPR forced to 1 — the kiosk renders 1920×1080 at DPR 1
  canvas.height = h;

  const droplets = buildDroplets(params, w, h);
  const streaks = params.streaks > 0 ? buildStreaks(params.streaks, w, h) : [];
  const statics = droplets.filter(d => !d.slider);
  const sliders = droplets.filter(d => d.slider);

  const streakStart = params.fadeInMs;
  const slideStart = params.fadeInMs + params.streakMs;
  const activeMs = episode.durationMs;
  const STREAK_ANGLE = -0.6; // rad — Phase 4 will bias this by windKph
  const vx = Math.cos(STREAK_ANGLE) * 2.4;
  const vy = -Math.sin(STREAK_ANGLE) * 2.4;

  canvas.style.display = "block";
  void canvas.offsetWidth;
  canvas.classList.add("fx-visible");

  let lastT = null;

  function draw(t, dt) {
    ctx.clearRect(0, 0, w, h);

    // falling streak pass (heavy variant only) — adapted from weatherMotion.js
    if (streaks.length && t >= streakStart && t < slideStart) {
      const phase = (t - streakStart) / params.streakMs;
      const streakAlpha = smoothstep(phase / 0.15) * smoothstep((1 - phase) / 0.2);
      ctx.strokeStyle = `rgba(210,225,245,${0.3 * streakAlpha})`;
      ctx.lineWidth = 1;
      for (const s of streaks) {
        s.x += vx * dt * (1 + s.z);
        s.y += vy * dt * (2 + s.z) * 2.2;
        if (s.y > h + 30) {
          s.y = -30;
          s.x = rand(0, w);
        }
        const len = 14 + 26 * s.z;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + vx * len, s.y - vy * len);
        ctx.stroke();
      }
    }

    // sliders move once their phase starts; ease-in, slight wobble, merge on contact
    if (t >= slideStart) {
      const p = Math.min(1, (t - slideStart) / params.slideMs);
      for (const d of sliders) {
        d.y = d.trailY0 + d.slideDist * p * p;
        d.x += Math.sin(p * 9 + d.seed) * 0.25;
        for (const s of statics) {
          if (s.merged) continue;
          const dx = d.x - s.x;
          const dy = d.y - s.y;
          if (Math.sqrt(dx * dx + dy * dy) < (d.r + s.r) * 0.8) {
            s.merged = true;
            d.r = Math.min(9, Math.sqrt(d.r * d.r + s.r * s.r));
          }
        }
      }
    }

    for (const d of statics) drawDroplet(d, smoothstep((t - d.appearAt) / 600));
    for (const d of sliders) {
      const alpha = smoothstep((t - d.appearAt) / 600);
      drawTrail(d, alpha);
      drawDroplet(d, alpha);
    }
  }

  function frame(now) {
    if (lastT === null) lastT = now;
    const t = now - (frame.t0 ?? (frame.t0 = now));
    const dt = Math.min((now - lastT) / 16.67, 2);
    lastT = now;
    draw(t, dt);
    if (t < activeMs) {
      rafId = requestAnimationFrame(frame);
    } else {
      // Active phase over: the last drawn frame holds as a static composited
      // layer (zero per-frame cost), then the glass clears.
      rafId = null;
      addTimer(params.holdMs, () => {
        canvas.classList.remove("fx-visible");
        addTimer(CANVAS_FADE_MS, () => {
          canvas.style.display = "none";
          ctx.clearRect(0, 0, w, h);
          finish();
        });
      });
    }
  }
  rafId = requestAnimationFrame(frame);
}

// ── night sky (Phase 3 — static starfield + twinkle moments) ────
// On a clear night in Mode 0 the canvas holds a painted starfield *between*
// episodes instead of hiding: a static composited layer costs nothing per
// frame (the Phase-1 hold precedent), so the GPU-0% ambient baseline stands.
// Only twinkle episodes ever run rAF, and only for ~2.5s every 3–6 min.

function drawStarField(twinkles, phase) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    let a = s.a;
    if (twinkles) {
      const boost = twinkles.get(i);
      if (boost) a = Math.min(1, s.a + boost * Math.sin(Math.PI * phase));
    }
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(225, 235, 255, ${a.toFixed(3)})`;
    ctx.fill();
  }
}

function paintStarfield() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (!stars) {
    stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: rand(0.02, 0.98),
        y: rand(0.02, 0.72), // the sky region — keep the lower frame quiet
        r: rand(0.5, 1.5),
        a: rand(0.2, 0.7)
      });
    }
  }
  drawStarField(null, 0);
  canvas.style.display = "block";
  void canvas.offsetWidth;
  canvas.classList.add("fx-visible");
}

// Reconcile the resting canvas with reality: paint the field when a clear
// ambient night earns it, clear it when not. Never touches a running episode —
// finish() calls back in when the canvas is free again.
function syncNightSky() {
  if (!canvas || running) return;
  const want = nightSkyWanted();
  if (want && !nightLive) {
    nightLive = true;
    paintStarfield();
  } else if (!want && nightLive) {
    nightLive = false;
    stars = null;
    canvas.classList.remove("fx-visible");
    canvas.style.display = "none";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function runTwinkle(episode) {
  if (reducedMotion()) {
    finish();
    return;
  }
  // A forced twinkle may land before (or without) the field: paint it first.
  if (!nightLive || !stars) {
    nightLive = true;
    paintStarfield();
  }
  const twinkles = new Map();
  while (twinkles.size < episode.params.count) {
    twinkles.set(Math.floor(rand(0, stars.length)), rand(0.3, 0.6));
  }
  const dur = episode.durationMs;
  let t0 = null;
  function frame(now) {
    if (t0 === null) t0 = now;
    const t = now - t0;
    drawStarField(twinkles, Math.min(1, t / dur));
    if (t < dur) {
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = null;
      drawStarField(null, 0); // back to the static resting frame
      finish(); // syncNightSky tears the field down if it wasn't earned
    }
  }
  rafId = requestAnimationFrame(frame);
}

// ── wiring ──────────────────────────────────────────────────────

function onStoreChange(state) {
  const weatherMoved = state.weather !== lastWeather;
  const nightMoved = state.isNight !== lastIsNight;
  if (!weatherMoved && !nightMoved) return;
  lastWeather = state.weather;
  lastIsNight = state.isNight;
  // Weather or the day/night boundary moved: reconcile the starfield and
  // re-plan the pending gap. A running episode (≤12s active) is left to
  // finish — the weather signal is 10-min coarse anyway.
  syncNightSky();
  if (!running) replan();
}

export function initAtmoFx({ rainEnabled = false, lightningEnabled = false, glassEnabled = false, nightSkyEnabled = false } = {}) {
  if (!rainEnabled && !lightningEnabled && !nightSkyEnabled) return; // flag-off: byte-identical, no DOM
  enabledRain = rainEnabled;
  enabledLightning = lightningEnabled;
  enabledGlass = glassEnabled;
  enabledNightSky = nightSkyEnabled;

  canvas = document.createElement("canvas");
  canvas.id = "atmo-fx-canvas";
  canvas.style.display = "none";
  ctx = canvas.getContext("2d", { alpha: true });
  veil = document.createElement("div");
  veil.id = "atmo-fx-veil";
  veil.style.display = "none";
  document.body.append(canvas, veil);

  lastWeather = getContext().weather;
  lastIsNight = getContext().isNight;
  unsubscribeStore = subscribeContext(onStoreChange);
  on("screensaver:changed", ({ active }) => {
    const next = active ? "ambient" : "awake";
    if (next === mode) return;
    mode = next;
    cancelAll();
    syncNightSky(); // ambient again on a clear night → the field comes back
    replan();
  });

  syncNightSky();
  replan();

  // Pi verification hooks (same pattern as __forcePhotoDissolve): run one
  // episode immediately, regardless of live weather.
  window.__forceAtmoEpisode = (type = "rain-moment") => {
    const synthetic =
      type === "lightning"
        ? { category: "clear", intensity: null, thunder: true }
        : type === "twinkle"
          ? { category: "clear", intensity: null, thunder: false }
          : { category: "rain", intensity: type === "rain-heavy" ? "heavy" : "moderate", thunder: false };
    const episode = planNextEpisode({
      weather: synthetic,
      // A forced twinkle plans as ambient so it works from an awake CDP session;
      // finish() → syncNightSky clears the field unless the night truly earns it.
      mode: type === "twinkle" ? "ambient" : mode,
      now: Date.now(),
      night: type === "twinkle" && enabledNightSky
    });
    if (!episode) return null;
    cancelAll();
    execute(episode);
    return episode.type;
  };
  window.__atmoFx = () => ({
    mode,
    running: running ? running.type : null,
    scheduled: Boolean(planTimer),
    canvasVisible: canvas.style.display !== "none",
    night: { live: nightLive, stars: stars ? stars.length : 0 },
    enabled: { rain: enabledRain, lightning: enabledLightning, glass: enabledGlass, nightSky: enabledNightSky }
  });
}

// Full symmetric teardown — the 24/7 discipline's escape hatch and the tests' seam.
export function stopAtmoFx() {
  cancelAll();
  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
  canvas?.remove();
  veil?.remove();
  canvas = null;
  ctx = null;
  veil = null;
  lastWeather = null;
  enabledRain = false;
  enabledLightning = false;
  enabledGlass = false;
  enabledNightSky = false;
  stars = null;
  lastIsNight = null;
  delete window.__forceAtmoEpisode;
  delete window.__atmoFx;
}
