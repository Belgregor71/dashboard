/* ═══════════════════════════════════════════════════════════════════════════
   THE MEMORY JOURNEY — depth 0 as one photograph at a time (features.v3MemoryJourney)

   Each memory arrives as a short journey: from abroad, a quiet map of where it
   belongs, a point, a gentle move towards it, and the photograph surfacing out
   of it; from home or from nowhere known, the room fills with the photograph's
   own colour and the photograph resolves out of that. Then everything is still.

   ── What this module does NOT own ──────────────────────────────────────────
   Which photograph is up, when, and in what order: ground.js (pool, rotation,
   veto) → archive.js (dedupe, unfolding a diptych pair into halves). This
   module is handed ONE photograph at a time through `journeyPresent` and paints
   it. No fetch, no pool, no second rotation.

   The hour is not built here either: #hour is the wall's constant at every
   depth (compose.css). This module adds TODAY'S DATE beside it, and a soft shade
   under both so the clock reads over a bright photograph without a box.

   ── Cost ────────────────────────────────────────────────────────────────────
   Every move is opacity or transform on a composited layer (WAAPI), runs once
   per photograph, and ENDS. At rest nothing animates except one 30 s settle that
   finishes on its own. No animation is ever left on `fill: forwards`: each
   keyframe set ends on the CSS rest state, so a finished animation releases
   itself rather than accumulating for the life of the page.

   Nodes are built once. The only per-photograph construction is the map SVG of
   an overseas memory (~5-20 paths), which REPLACES the previous one.
   ═══════════════════════════════════════════════════════════════════════════ */

import { decodeWorld, mapPlan, frameGeometry, yearOf, placeLine, namesLine, photoFit, memoryRight } from "./journey-geo.js";
import { requiredAlpha, resolveColor } from "./scrim.js";
import { MOTION } from "./motion.js";
import { gradePixel } from "./journey-grade.js";

/* ── Timing — the numbers to turn ──────────────────────────────────────────
   Milliseconds. Turnable live on the wall over CDP with
   `window.__journeyTiming({ mapPhotoDelayMs: 2600 })`, no deploy. How long each
   photograph STAYS is not here — it is ground.js's rotation (CHECK_MS, ten
   minutes), which this surface deliberately does not second-guess. */
export const TIMING = {
  /* A plain crossfade: the page's first photograph (the panel may have just
     woken), a "not this one" veto (someone spoke — be brisk), reduced motion and
     a dark panel. */
  cutMs: 1200,
  /* The ambient settle ground hands over is clamped to ≤2600 by archive.js; a
     veto's is 1200. Anything under this is treated as brisk. */
  briskBelowMs: 1500,

  // Home / unknown: the photograph's colour fills the room, the photo surfaces.
  washInMs: 900,
  washPhotoDelayMs: 600,
  washPhotoMs: 2000,

  // Abroad: map in, point, move towards it, photograph surfaces from the map.
  mapInMs: MOTION.scene,
  pinAtMs: 450,
  zoomFromMs: 650,
  zoomMs: 1900,
  zoomScale: 1.7,
  mapPhotoDelayMs: 2300,
  mapPhotoMs: 1500,

  // The words: out fast with the outgoing photograph, back once it has settled.
  metaOutMs: 450,
  metaInMs: 1400,

  // The only movement at rest: the photograph eases in by 3.5 % once, and stops.
  restMs: 30000,
  restScale: 1.035,

  // The outgoing photograph stands down this long after the reveal ends.
  cleanupMs: 1500
};

const EASE = "cubic-bezier(0.33, 0, 0.2, 1)";
const SMOOTH = "cubic-bezier(0.45, 0, 0.2, 1)";

/* The legibility target for the words over the photograph, and the most a
   shade may darken. Every line on this surface is ≥32px — WCAG "large text",
   whose AA floor is 3:1. 3.5 leaves margin, and the --ink-shadow halo adds more
   at the glyph edge. Solving for 4.5 instead was tried and REJECTED on the
   bright-sky capture: the shade it needs reads as a dark shape on the sky,
   which is the "dark box" this surface exists not to have. */
const CONTRAST_MIN = 3.5;
const SHADE_MAX = 0.82;
// What fraction of the shade's peak actually sits under the words.
const SHADE_COVER = 0.8;
const SHADE_RGB = [0.04, 0.035, 0.03];
const INK_FALLBACK = [0.93, 0.92, 0.89];

const MINI_W = 260;
const MINI_H = 160;

/* ── State ──────────────────────────────────────────────────────────────── */
let built = false;
let rootEl = null;
let frames = [];          // [{ el, img, canvas }] — two, never grown
let top = 0;              // which frame is up
let washEl = null;
let mapEl = null;
let zoomEl = null;
let pinEl = null;
let ringEl = null;
let memoryEl = null;
let miniEl = null;
let yearEl = null;
let placeEl = null;
let whoEl = null;
let todayEl = null;
let sampleCanvas = null;

let world = null;         // decoded once, lazily; null = not loaded / failed
let worldState = "idle";  // idle | loading | ready | failed
let worldLoad = Promise.resolve(); // settles (never rejects) when the load ends

let seq = 0;
let presented = false;
let revealTimer = null;
let metaTimer = null;
let cleanupTimer = null;
let revealAnims = [];     // the reveal's own animations (map, pin, wash, frame)
let restAnim = null;      // the 30 s settle on the photograph that is up
let pendingMeta = null;   // the words waiting to go up
let last = { mode: null, plan: null, fit: null, words: null, shades: null, failures: 0, reason: "nothing yet" };

const reducedMotion = () => Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
const docRoot = () => document.documentElement;

/* ── Build, once ─────────────────────────────────────────────────────────── */
export function buildJourney(host) {
  if (built || !host) return;
  rootEl = document.createElement("div");
  rootEl.className = "journey";

  frames = [0, 1].map((i) => {
    const el = document.createElement("div");
    el.className = "journey__frame";
    el.dataset.slot = String(i);
    const canvas = document.createElement("canvas");
    canvas.className = "journey__backdrop";
    canvas.width = 160;
    canvas.height = 90;
    const img = document.createElement("img");
    img.className = "journey__photo";
    img.alt = "";
    img.decoding = "async";
    el.append(canvas, img);
    return { el, img, canvas };
  });

  washEl = document.createElement("div");
  washEl.className = "journey__wash";

  mapEl = document.createElement("div");
  mapEl.className = "journey__map";
  zoomEl = document.createElement("div");
  zoomEl.className = "journey__zoom";
  pinEl = document.createElement("div");
  pinEl.className = "journey__pin";
  ringEl = document.createElement("span");
  ringEl.className = "journey__ring";
  const dot = document.createElement("span");
  dot.className = "journey__dot";
  pinEl.append(ringEl, dot);
  mapEl.append(zoomEl, pinEl);

  const shadeToday = document.createElement("div");
  shadeToday.className = "journey__shade journey__shade--today";

  memoryEl = document.createElement("div");
  memoryEl.className = "journey__memory";
  memoryEl.dataset.meta = "out";
  miniEl = document.createElement("div");
  miniEl.className = "journey__mini";
  miniEl.dataset.shown = "0";
  miniEl.setAttribute("aria-hidden", "true");
  const words = document.createElement("div");
  words.className = "journey__words";
  yearEl = document.createElement("p");
  yearEl.className = "journey__year";
  placeEl = document.createElement("p");
  placeEl.className = "journey__place";
  whoEl = document.createElement("p");
  whoEl.className = "journey__who";
  words.append(yearEl, placeEl, whoEl);
  memoryEl.append(miniEl, words);

  todayEl = document.createElement("p");
  todayEl.className = "journey__today";

  rootEl.append(frames[0].el, frames[1].el, washEl, mapEl, shadeToday, memoryEl, todayEl);
  host.append(rootEl);
  sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 16;
  sampleCanvas.height = 9;
  built = true;
  loadWorld();

  window.__journey = probe;
  window.__journeyTiming = (patch) => {
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (k in TIMING && Number.isFinite(Number(v)) && Number(v) >= 0) TIMING[k] = Number(v);
    }
    return { ...TIMING };
  };
  /* The grade, judged in front of the wall: re-grades the photograph ALREADY on the glass
     (and re-solves its shades), so each look is compared against the same picture. Null
     clears it. The next photograph takes the house's own `data-grade` again. */
  window.__journeyGrade = (look = null) => {
    const frame = frames[top];
    if (!frame?.el.classList.contains("is-shown") || !last.fit) return null;
    setGrade(frame, look);
    const shades = solveShades(frame, last.fit, window.innerWidth || 1920, window.innerHeight || 1080, frame.look);
    applyShades(shades);
    if (shades) last = { ...last, shades };
    return frame.look;
  };
}

/* Loaded once, from our own server, as a separate chunk: ~55 KB that only an
   overseas memory needs. A failure is permanent for the page and costs nothing
   but the map — every reveal falls back to the colour wash. */
function loadWorld() {
  if (worldState !== "idle") return;
  worldState = "loading";
  worldLoad = import("./journey-world.js").then(
    (m) => { world = decodeWorld(m.COUNTRIES); worldState = "ready"; },
    () => { world = null; worldState = "failed"; }
  );
}

/* ── Painting helpers ─────────────────────────────────────────────────────── */

/** Wait for a real decode, bounded. False = keep what is on the wall. */
function decoded(img, ms = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; clearTimeout(t); resolve(ok); } };
    const t = setTimeout(() => finish(false), ms);
    const p = img.decode ? img.decode() : Promise.reject(new Error("no decode"));
    p.then(
      () => finish(img.naturalWidth > 0),
      () => finish(img.complete && img.naturalWidth > 0)
    );
  });
}

/* The photograph's own colour, blurred, as the field it sits on — drawn ONCE
   into a 160x90 canvas that CSS stretches to the wall. The blur and darkening
   happen here, on 14,400 pixels, never as a CSS filter on a 1920x1080 layer. */
function paintBackdrop(canvas, img) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const a = img.naturalWidth / img.naturalHeight;
  const W = canvas.width;
  const H = canvas.height;
  const w = Math.max(W, H * a) * 1.15;
  const h = Math.max(H, W / a) * 1.15;
  ctx.filter = "blur(7px) saturate(1.15) brightness(0.6)";
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  ctx.filter = "none";
  try {
    const d = ctx.getImageData(0, 0, W, H).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [r / n / 255, g / n / 255, b / n / 255];
  } catch {
    return null;
  }
}

const css = ([r, g, b], a = 1) =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${a})`;

/* How dark each corner's shade must be for the words to read over THIS
   photograph as the wall shows it. Samples the composed frame (backdrop + photo
   at its fit) on a 16x9 grid and solves against the brightest cell under each
   block, not the mean — a mean lets one bright patch hide under a dark one. */
function solveShades(frame, fit, W, H, look = null) {
  const ctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const sx = 16 / W;
  const sy = 9 / H;
  let data;
  try {
    ctx.drawImage(frame.canvas, 0, 0, 16, 9);
    ctx.drawImage(frame.img, fit.x * sx, fit.y * sy, fit.w * sx, fit.h * sy);
    data = ctx.getImageData(0, 0, 16, 9).data;
  } catch {
    return null;
  }
  const ink = resolveColor(getComputedStyle(docRoot()).getPropertyValue("--ink").trim()) ?? INK_FALLBACK;
  // The grade (v3GoldenHour) sits between the photograph and the shade, so each cell is
  // judged as the wall shows it: graded first, then the brightest picked.
  const worst = (c0, c1, r0, r1, corner) => {
    let best = null;
    let bestL = -1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = (r * 16 + c) * 4;
        const rgb = gradePixel([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255], look, corner, resolveColor);
        const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        if (l > bestL) { bestL = l; best = rgb; }
      }
    }
    const a = requiredAlpha(best, SHADE_RGB, ink, { target: CONTRAST_MIN, coverage: SHADE_COVER, maxAlpha: SHADE_MAX });
    return Number.isFinite(a) ? Math.max(0.12, a) : SHADE_MAX;
  };
  // Memory: top-right (x ≥ 1080, y < 360). Today: bottom-left (x < 840, y ≥ 720).
  return { memory: worst(9, 15, 0, 2, "memory"), today: worst(0, 6, 6, 8, "today") };
}

/* The grade layer lives INSIDE each frame, so each photograph wears the light it arrived
   in and a change of light crosses the wall under the dissolve, never as a snap over a
   photograph already on the glass. Made on first use: flag off, the node never exists. */
function setGrade(frame, look) {
  frame.look = look || null;
  if (!look && !frame.gradeEl) return;
  if (!frame.gradeEl) {
    frame.gradeEl = document.createElement("div");
    frame.gradeEl.className = "journey__grade";
    frame.el.append(frame.gradeEl);
  }
  frame.gradeEl.dataset.look = look || "";
  frame.el.dataset.grade = look || "";
}

function applyShades(shades) {
  if (!shades) return;
  rootEl.style.setProperty("--j-shade-memory", shades.memory.toFixed(3));
  rootEl.style.setProperty("--j-shade-today", shades.today.toFixed(3));
}

function svgFor(geo, w, h, { sea, mini }) {
  const land = mini ? "rgb(240 233 220 / 0.20)" : "rgb(240 233 220 / 0.11)";
  const lit = mini ? "rgb(242 214 160 / 0.46)" : "rgb(242 214 160 / 0.26)";
  const edge = mini ? "rgb(240 233 220 / 0.30)" : "rgb(240 233 220 / 0.20)";
  const paths = geo.paths
    .map((p) => `<path d="${p.d}" fill="${p.lit ? lit : land}" stroke="${edge}" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`)
    .join("");
  const bg = sea ? `<rect x="${geo.x0 - 10000}" y="${geo.y0 - 10000}" width="40000" height="40000" fill="${sea}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${geo.viewBox}" preserveAspectRatio="none">${bg}${paths}</svg>`;
}

function paintMini(plan) {
  if (!plan || !world) {
    miniEl.dataset.shown = "0";
    miniEl.innerHTML = "";
    return;
  }
  const geo = frameGeometry(world, plan.mini, MINI_W, MINI_H, plan.country);
  const dot = plan.point
    ? `<span class="journey__mini-dot" style="left:${((plan.point.x - geo.x0) * geo.kx).toFixed(1)}px;top:${((plan.point.y - geo.y0) * geo.ky).toFixed(1)}px"></span>`
    : "";
  miniEl.innerHTML = svgFor(geo, MINI_W, MINI_H, { mini: true }) + dot;
  miniEl.dataset.shown = "1";
}

function paintWords(words) {
  yearEl.textContent = words.year ?? "";
  placeEl.textContent = words.place ?? "";
  whoEl.textContent = words.who ?? "";
  yearEl.dataset.blank = words.year ? "0" : "1";
  placeEl.dataset.blank = words.place ? "0" : "1";
  whoEl.dataset.blank = words.who ? "0" : "1";
  memoryEl.dataset.blank = words.year || words.place || words.who ? "0" : "1";
}

/* ── The reveal ─────────────────────────────────────────────────────────── */

function track(anim) {
  revealAnims.push(anim);
  return anim;
}

/** Jump whatever reveal is in flight to its rest state, now. Idempotent. */
function finishReveal() {
  clearTimeout(revealTimer);
  clearTimeout(metaTimer);
  revealTimer = null;
  metaTimer = null;
  for (const a of revealAnims) {
    try { a.cancel(); } catch { /* already gone */ }
  }
  revealAnims = [];
  if (pendingMeta) {
    const run = pendingMeta;
    pendingMeta = null;
    run();
  }
  delete rootEl?.dataset.reveal;
  zoomEl && (zoomEl.innerHTML = "");
}

function dropOutgoing() {
  clearTimeout(cleanupTimer);
  cleanupTimer = null;
  const out = frames[top ^ 1];
  if (!out) return;
  out.el.classList.remove("is-shown");
}

/**
 * Present ONE photograph. Called by archive.js for every exchange (a new
 * memory, or the second half of a pair).
 *
 * @param {{src:string, asset?:object, settleMs?:number}} item
 */
export function journeyPresent({ src, asset = null, settleMs = TIMING.cutMs } = {}) {
  if (!built || !src) return;
  const mine = ++seq;
  const slot = top ^ 1;
  const frame = frames[slot];
  // The slot may still hold a photograph mid-cleanup; it is about to be reused.
  if (cleanupTimer) dropOutgoing();
  frame.img.src = src;
  /* The world is loaded at build and is normally long ready — but the page's
     FIRST photograph races it, and without this wait the first memory after
     every boot would arrive with no map and no mini map. worldLoad never
     rejects; a failed load just means no map. */
  Promise.all([decoded(frame.img), worldLoad]).then(([ok]) => {
    if (mine !== seq) return;           // superseded while decoding
    if (!ok) {
      last = { ...last, failures: last.failures + 1, reason: "decode failed — kept the photograph on the wall" };
      return;
    }
    begin(slot, asset, settleMs);
  });
}

function begin(slot, asset, settleMs) {
  finishReveal();
  const W = window.innerWidth || 1920;
  const H = window.innerHeight || 1080;
  const frame = frames[slot];
  const img = frame.img;

  const fit = photoFit(img.naturalWidth / img.naturalHeight, W, H);
  Object.assign(img.style, {
    left: `${fit.x}px`, top: `${fit.y}px`, width: `${fit.w}px`, height: `${fit.h}px`
  });
  frame.el.dataset.fit = fit.mode;
  const mean = paintBackdrop(frame.canvas, img) ?? [0.12, 0.11, 0.1];

  // main.js stamps `data-grade` only while v3GoldenHour is on; absent, no layer is made.
  const look = docRoot().dataset.grade || null;
  setGrade(frame, look);
  const shades = solveShades(frame, fit, W, H, look);
  applyShades(shades);

  const plan = world ? mapPlan(asset, world) : null;
  const words = {
    year: yearOf(asset),
    place: placeLine(asset),
    who: namesLine(asset?.people)
  };

  const root = docRoot();
  const night = root.dataset.night === "1";
  const dark = root.dataset.panelDark === "1";
  const reduced = reducedMotion();
  let mode = "wash";
  if (!presented || reduced || dark || settleMs < TIMING.briskBelowMs) mode = "cut";
  else if (plan && !night) mode = "map";
  presented = true;

  // Swap the stack: the incoming frame goes up OVER the outgoing one, which
  // stays opaque beneath it until the cleanup — fading both would dip dark.
  frames[top].el.classList.remove("is-top");
  frame.el.classList.add("is-shown", "is-top");
  top = slot;

  // The words leave with the outgoing photograph and wait.
  memoryEl.dataset.meta = "out";
  pendingMeta = () => {
    // Written while the words are out, so the block never moves on the glass.
    const right = memoryRight(fit);
    if (right == null) rootEl.style.removeProperty("--j-memory-right");
    else rootEl.style.setProperty("--j-memory-right", `${right}px`);
    paintWords(words);
    paintMini(plan);
    memoryEl.dataset.meta = "in";
  };

  let total;
  if (mode === "cut") {
    total = TIMING.cutMs;
    track(frame.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: total, easing: EASE, fill: "backwards" }));
  } else if (mode === "wash") {
    total = TIMING.washPhotoDelayMs + TIMING.washPhotoMs;
    rootEl.dataset.reveal = "wash";
    washEl.style.backgroundColor = css(mean);
    track(washEl.animate(
      [{ opacity: 0 }, { opacity: 0.94, offset: Math.min(0.9, TIMING.washInMs / total) }, { opacity: 0.94 }],
      { duration: total, easing: EASE }
    ));
    track(frame.el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: TIMING.washPhotoMs, delay: TIMING.washPhotoDelayMs, easing: EASE, fill: "backwards"
    }));
  } else {
    total = TIMING.mapPhotoDelayMs + TIMING.mapPhotoMs;
    runMap(plan, mean, W, H, total);
    track(frame.el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: TIMING.mapPhotoMs, delay: TIMING.mapPhotoDelayMs, easing: EASE, fill: "backwards"
    }));
  }

  // The one movement at rest: a 3.5 % ease-in that ends. Not under reduced motion.
  try { restAnim?.cancel(); } catch { /* gone */ }
  restAnim = null;
  if (!reduced && !dark) {
    restAnim = img.animate([{ transform: `scale(${TIMING.restScale})` }, { transform: "none" }], {
      duration: TIMING.restMs, easing: "cubic-bezier(0.2, 0.6, 0.2, 1)"
    });
  }

  last = { ...last, mode, plan, fit, words, shades, reason: "presented" };

  const metaAt = mode === "cut" ? Math.round(total * 0.5) : Math.max(0, total - 200);
  metaTimer = setTimeout(() => {
    metaTimer = null;
    const run = pendingMeta;
    pendingMeta = null;
    run?.();
  }, metaAt);

  // Never `finished` / animationend: those do not fire for a layer that is
  // visibility:hidden or display:none, and this one is at every other depth.
  revealTimer = setTimeout(() => {
    revealTimer = null;
    revealAnims = [];
    delete rootEl.dataset.reveal;
    zoomEl.innerHTML = "";
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(dropOutgoing, TIMING.cleanupMs);
  }, total + 60);
}

function runMap(plan, mean, W, H, total) {
  rootEl.dataset.reveal = "map";
  // The sea is the photograph's own colour pulled down towards the house dark,
  // so the map belongs to this memory rather than to a navigation app.
  const sea = css([mean[0] * 0.45 + 0.035, mean[1] * 0.45 + 0.033, mean[2] * 0.45 + 0.03]);
  const geo = frameGeometry(world, plan.start, W, H, plan.country);
  zoomEl.innerHTML = svgFor(geo, W, H, { sea, mini: false });

  const at = (ms) => Math.max(0, Math.min(1, ms / total));
  track(mapEl.animate(
    [{ opacity: 0 }, { opacity: 1, offset: at(TIMING.mapInMs) }, { opacity: 1 }],
    { duration: total, easing: EASE }
  ));

  const z0 = at(TIMING.zoomFromMs);
  const z1 = at(TIMING.zoomFromMs + TIMING.zoomMs);
  if (plan.point) {
    const px = (plan.point.x - geo.x0) * geo.kx;
    const py = (plan.point.y - geo.y0) * geo.ky;
    const s = TIMING.zoomScale;
    const toMap = `translate(${(W / 2 - s * px).toFixed(1)}px, ${(H / 2 - s * py).toFixed(1)}px) scale(${s})`;
    const toPin = `translate(${(W / 2 - px).toFixed(1)}px, ${(H / 2 - py).toFixed(1)}px)`;
    pinEl.style.left = `${px.toFixed(1)}px`;
    pinEl.style.top = `${py.toFixed(1)}px`;
    track(zoomEl.animate([
      { transform: "none", offset: 0 },
      { transform: "none", offset: z0, easing: SMOOTH },
      { transform: toMap, offset: z1 },
      { transform: toMap, offset: 1 }
    ], { duration: total }));
    track(pinEl.animate([
      { transform: "none", opacity: 0, offset: 0 },
      { transform: "none", opacity: 0, offset: at(TIMING.pinAtMs) },
      { transform: "none", opacity: 1, offset: z0, easing: SMOOTH },
      { transform: toPin, opacity: 1, offset: z1 },
      { transform: toPin, opacity: 1, offset: 1 }
    ], { duration: total }));
    // ONE ring, once. Not a beacon.
    track(ringEl.animate(
      [{ transform: "scale(0.4)", opacity: 0.85 }, { transform: "scale(3.4)", opacity: 0 }],
      { duration: 1700, delay: TIMING.pinAtMs + 150, easing: "cubic-bezier(0.1, 0.6, 0.3, 1)", fill: "backwards" }
    ));
    rootEl.dataset.pin = "1";
  } else {
    // Country precision: no point exists to move towards, so the map only
    // draws closer to the country itself — and claims nothing finer.
    track(zoomEl.animate([
      { transform: "none", offset: 0 },
      { transform: "none", offset: z0, easing: SMOOTH },
      { transform: "scale(1.12)", offset: z1 },
      { transform: "scale(1.12)", offset: 1 }
    ], { duration: total }));
    rootEl.dataset.pin = "0";
  }
}

/** The day line, painted by archive.js on main.js's existing 20 s hour tick. */
export function journeyDay(text) {
  if (todayEl) todayEl.textContent = text ?? "";
}

/**
 * Leaving depth 0, the panel going dark, teardown: no reveal and no settle may
 * run on a layer nobody can see. Jumps everything to its rest state.
 */
export function journeyStop() {
  if (!built) return;
  finishReveal();
  try { restAnim?.finish(); } catch { /* gone */ }
  restAnim = null;
}

/** The asset the room can see is decided by archive.js; this reports state. */
function probe() {
  const running = document.getAnimations().filter((a) => a.playState === "running");
  return {
    built,
    world: worldState,
    seq,
    top,
    shownFrames: frames.filter((f) => f.el.classList.contains("is-shown")).length,
    reveal: rootEl?.dataset.reveal ?? null,
    mode: last.mode,
    plan: last.plan ? { precision: last.plan.precision, country: last.plan.country, pin: Boolean(last.plan.point) } : null,
    fit: last.fit,
    words: {
      year: yearEl?.dataset.blank === "0" ? yearEl.textContent : null,
      place: placeEl?.dataset.blank === "0" ? placeEl.textContent : null,
      who: whoEl?.dataset.blank === "0" ? whoEl.textContent : null
    },
    meta: memoryEl?.dataset.meta ?? null,
    mini: miniEl?.dataset.shown === "1",
    today: todayEl?.textContent || null,
    shades: last.shades,
    grade: frames[top]?.look ?? null,
    failures: last.failures,
    reason: last.reason,
    timers: {
      reveal: revealTimer !== null,
      meta: metaTimer !== null,
      cleanup: cleanupTimer !== null
    },
    revealAnims: revealAnims.length,
    resting: restAnim?.playState === "running",
    running: running.length,
    nodes: rootEl?.querySelectorAll("*").length ?? 0
  };
}
