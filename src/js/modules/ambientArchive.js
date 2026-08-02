import { buildDay, DAY_START_HOUR, DAY_END_HOUR } from "../services/dayModel.js";
import { plateFor, yearOf } from "../services/archiveModel.js";
import { initDaySources, readDayMarks } from "./daySources.js";
import { on } from "../core/eventBus.js";

// The Ambient Archive — Mode 0 as the house's instrument space.
// docs/design/AMBIENT-ARCHIVE.md is the implementation authority.
//
// Mode 0 stops being "a photo with a clock on it": the memory is a lit card
// pivoting in a deep space over a drained tiled echo of itself, between two
// ruler planes at different depths —
//
// ── The years have no ruler, and that is deliberate ──────────────────────────
//
// §6.1 of the handover says the archive's year ruler and the spine's hour axis
// collide because they are "the same screen region, perpendicular meanings".
// Two attempts to keep both were built and both were rejected on the panel:
// six rows receding in Z read as one broken diagonal and cost the photograph
// half its size, and a horizontal shelf on a far plane clashed with the card
// for attention while telling the room nothing it did not already know.
//
// The year is already on the wall, 400px high, behind the plate. A ruler that
// duplicates it is furniture (law 3), so the archive draws ONE axis: today.
//
// ── How this obeys DESIGN_SYSTEM.md §5 ───────────────────────────────────────
//
// Every continuous animation hangs off `body.fx-archive-active`, set on Mode-0
// entry and removed on exit. The cause is nameable by anyone in the room: *the
// house is leafing through its album*. Nothing completes a perceptible change
// within a passing glance — pivot 84s, drift 130s, zoom 96s — and the only
// catchable events (the memory exchange, its 300ms blur) have ends. Amplitude
// rides `--clock-dim` (§5.2): at 2am the archive drifts less far, not less
// often.
//
// ⚠ NEITHER RULER MOVES. The reference drifts its strips ±80px, which was fine
// when they were decoration. Both planes now carry an axis, and a sliding axis
// is a lie about the quantity it measures. The whole motion budget belongs to
// the card and its backdrop.
//
// The now-point does not breathe (§6.3.4): the breath is bound to media playing
// AND someone in the room, which in Mode 0 is false by definition.
//
// ── Memory discipline (CLAUDE.md, 24/7) ──────────────────────────────────────
//
// Nothing is allocated per mark, per year or per memory. Every node is created
// once in `build()`: two ruler canvases, two card images, two echo planes, one
// plate. Marks and years are drawn into the canvases; the plate is filled,
// shown, hidden — never cloned, never detached. The exchange's staged swap is a
// `setTimeout`, never `transitionend` (which never fires while an ancestor is
// display:none, i.e. most of the day).

// ── Geometry (frame coordinates on the fixed 1920×1080 canvas) ───────────────
// Measured from `Ambient Archive Screensaver.html`.

const FRAME_W = 1920;
const FRAME_H = 1080;

const ROW_W = 2160;      // each ruler bleeds 120px past both frame edges
const ROW_LEFT = -120;   // frame x of ruler-canvas x 0

// The one ruler: today. The reference's `#strip2`, at its own top/depth.
const TODAY_H = 320;
const TODAY_LINE_Y = 110;   // ruler-canvas y of the line
const TODAY_TOP = 904;      // frame y the line lands on
const TODAY_Z = -40;
const MARGIN = 108;                          // the spine's own safe margin
const HOUR_X0 = MARGIN - ROW_LEFT;           // ruler-canvas x of 05:00
const HOUR_SPAN = FRAME_W - MARGIN * 2;      // 05:00 → 24:00
const HOUR_LABELS = [6, 12, 18, 24];

const TICK_PX = 21;      // the reference's ruling pitch, on both planes
const TICK_MS = 30_000;  // half a minute — the now-point never lags a minute

// The exchange (§3): the card blurs for a beat, the plate and the ghost year
// stand down, everything swaps at the midpoint, then it all comes back.
const EXCHANGE_BLUR_MS = 300;
const EXCHANGE_SWAP_MS = 2400;

// ── The motion burst (features.ambientArchiveMotion) ─────────────────────────
//
// Most of this library is Apple Live Photos, so most memories arrive carrying a
// ~3s motion part. When one does, the card breathes for a moment as the memory
// lands, then settles into the still it has always been.
//
// How this passes law 1: the cause is THE PHOTOGRAPH CHANGING, which §5.1's
// legal-causes table names verbatim. The burst is bound to the exchange, plays
// exactly once, and stops — §5.1's corollary, "the cause is instantaneous → the
// motion is a moment". There is no `loop` attribute and there must never be one:
// "a momentary cause rendered as a loop is a law-1 violation even though it is
// cheap". Nothing here is decorative; a memory with no motion part does not move.
//
// Binding it to the exchange also settles the Ken Burns problem for free.
// `arch-kenburns` restarts from frame 0 whenever `is-shown` is re-added to the
// incoming slot, so at exchange time the still underneath is at scale(1) and
// travels ~0.07% across the burst. The clip sits at scale 1 over a still at
// scale 1 — no shared wrapper, no paused animation, no transform on a decoding
// layer (which is exactly the defect that cost 3.0-4.3 points in 17da62e).
const MOTION_START_MS = 2800;   // past EXCHANGE_SWAP_MS and the 2.6s crossfade
const MOTION_HOLD_MS  = 3600;   // > the server's -t 3.5 bound, so the media ends first
const MOTION_FADE_MS  = 600;    // the fade back to the still, then drop the resource

let enabled = false;
let liveMotion = false;
let root = null;
let todayCanvas = null;
let todayCtx = null;
let echoEls = [];        // two, cross-faded
let cardImgs = [];       // two, cross-faded
let cardEl = null;
let ghostEl = null;
let plateEl = null;
let plateEyebrowEl = null;
let plateTitleEl = null;
let plateWhoEl = null;
let echoSlot = 0;
let cardSlot = 0;

let active = false;
let tickTimer = null;
let exchangeTimer = null;
let blurTimer = null;
let resizeHandler = null;
let lastDay = null;
let lastFrame = null;    // the memory currently on the card
let litYear = null;

let clipEl = null;       // the motion burst's <video>, only when liveMotion
let motionArmTimer = null;
let motionEndTimer = null;
let motionStopTimer = null;
let burstCount = 0;
let lastBurstAt = null;
let lastQuality = null;

/** Is the archive built and allowed to take Mode 0? */
export function isAmbientArchiveEnabled() {
  return enabled;
}

// ── Fit ───────────────────────────────────────────────────────
// The whole scene is one fixed 1920×1080 stage scaled to the panel, exactly as
// the reference does it. On the kiosk the scale is 1 and a canvas pixel is a
// device pixel; anywhere else it letterboxes rather than reflowing, because
// this is a fixed-resolution wall (DESIGN_SYSTEM.md §0).
function fit() {
  if (!root) return;
  const scale = Math.min(window.innerWidth / FRAME_W, window.innerHeight / FRAME_H);
  root.style.setProperty("--arch-fit", String(scale > 0 ? scale : 1));
}

/** The dim curve the ambient clock already computes (§5.2). Never below its floor. */
function clockDim() {
  const src = document.getElementById("screensaver") || document.body;
  const v = parseFloat(getComputedStyle(src).getPropertyValue("--clock-dim"));
  return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0.9;
}

/** The ruling both planes share — the reference's 21px pitch. */
function drawTicks(ctx, y, from, to, height, alpha) {
  ctx.fillStyle = `rgba(238,243,251,${alpha})`;
  for (let x = from; x <= to; x += TICK_PX) {
    ctx.fillRect(Math.round(x), y + 1, 1, height);
  }
}

// ── The near plane: today ─────────────────────────────────────

function hourX(t) {
  return HOUR_X0 + t * HOUR_SPAN;
}

/**
 * Today, low and near: the minute ruling, the four hour numerals, marks rising
 * as anticipation, embers behind them, and now as the brightest point on the
 * line. The same reading the spine draws flat, lying on a plane.
 */
function drawToday(day, dim) {
  const ctx = todayCtx;
  if (!ctx) return;
  const y = TODAY_LINE_Y + 0.5; // +0.5 so a 1px line lands on a pixel

  ctx.clearRect(0, 0, ROW_W, TODAY_H);
  ctx.globalAlpha = dim;

  ctx.fillStyle = "rgba(238,243,251,0.18)";
  ctx.fillRect(0, y, ROW_W, 1);
  drawTicks(ctx, y, 0, ROW_W, 9, 0.14);

  // The burnt portion: everything left of now has already been lived through.
  if (day.nowT != null) {
    const nowX = hourX(day.nowT);
    const burn = ctx.createLinearGradient(hourX(0), 0, nowX, 0);
    burn.addColorStop(0, "rgba(255,180,130,0.14)");
    burn.addColorStop(1, "rgba(255,180,130,0.34)");
    ctx.fillStyle = burn;
    ctx.fillRect(hourX(0), y, Math.max(0, nowX - hourX(0)), 1);
  }

  // Hour numerals — the reason a foreshortened ruler still tells the truth.
  ctx.fillStyle = "rgba(159,196,255,0.40)";
  ctx.font = '400 22px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const hour of HOUR_LABELS) {
    if (hour < DAY_START_HOUR || hour > DAY_END_HOUR) continue;
    const t = (hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR);
    ctx.fillText(`${String(hour).padStart(2, "0")}:00`, hourX(t), y + 18);
  }

  // The marks. Weight is the only hierarchy: size and glow, nothing else.
  for (const m of day.marks) {
    const height = 11 + m.weight * 7;
    const width = m.weight > 2 ? 3 : 2;
    const x = Math.round(hourX(m.t) - width / 2);
    if (m.spent) {
      ctx.fillStyle = "rgba(255,175,125,0.5)";
      ctx.shadowColor = "rgba(255,165,110,0.3)";
      ctx.shadowBlur = 8;
    } else if (m.warm) {
      ctx.fillStyle = "rgba(255,205,140,0.95)";
      ctx.shadowColor = "rgba(255,190,120,0.55)";
      ctx.shadowBlur = 12;
    } else {
      ctx.fillStyle = "rgba(190,215,255,0.85)";
      ctx.shadowColor = "rgba(159,196,255,0.4)";
      ctx.shadowBlur = 10;
    }
    ctx.fillRect(x, y - height, width, height);
  }
  ctx.shadowBlur = 0;

  // Now: the brightest point on the line. It does not breathe here — nobody is
  // in the room to have caused it (§6.3.4).
  if (day.nowT != null) {
    const nowX = hourX(day.nowT);
    const spill = ctx.createRadialGradient(nowX, y, 0, nowX, y, 70);
    spill.addColorStop(0, "rgba(255,225,190,0.30)");
    spill.addColorStop(1, "rgba(255,225,190,0)");
    ctx.fillStyle = spill;
    ctx.fillRect(nowX - 60, y - 88, 120, 88);

    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(255,220,180,0.6)";
    ctx.shadowBlur = 18;
    ctx.fillRect(Math.round(nowX - 1), y - 30, 3, 30);
    ctx.shadowBlur = 0;
  }

  ctx.globalAlpha = 1;
}

/** Repaint the day. Called on a cause, never on a frame. */
function render() {
  if (!enabled || !root) return;
  const now = new Date();
  const day = buildDay({ marks: readDayMarks(now), now });
  lastDay = day;
  drawToday(day, clockDim());
}

// ── The memory on the card ────────────────────────────────────

function setPlate(parts) {
  if (!plateEl) return;
  if (!parts) {
    plateEl.classList.remove("is-visible");
    plateEyebrowEl.textContent = "";
    plateTitleEl.textContent = "";
    plateWhoEl.textContent = "";
    plateWhoEl.classList.remove("is-visible");
    return;
  }
  plateEyebrowEl.textContent = `On this day · ${parts.year}`;
  plateTitleEl.textContent = parts.title;
  plateWhoEl.textContent = parts.who || "";
  plateWhoEl.classList.toggle("is-visible", Boolean(parts.who));
  plateEl.classList.add("is-visible");
}

/**
 * Put a memory on the card.
 *
 * `frame` is what the screensaver's rotation already holds: a bare src string
 * (the tender lane, the immichPhotos blend, the static library) or a Daily
 * Memories object `{ src, caption }`.
 *
 * ⚠ A TENDER memory must arrive with no plate at all (§4.3). That is enforced
 * three ways and none of them is taste: `memoryEngine.toSurface` sets
 * `caption: null`, the tender lane passes a bare string, and `tender: true`
 * refuses the plate here even if a caption somehow rode along.
 */
export function setArchiveMemory(frame) {
  if (!enabled || !root) return;
  const src = typeof frame === "string" ? frame : frame?.src;
  if (!src) return;
  const tender = typeof frame === "object" && frame?.tender === true;
  const caption = tender ? null : (typeof frame === "object" ? frame?.caption : null);
  const parts = plateFor(caption);
  const first = lastFrame == null;
  lastFrame = { src, caption };
  // The year comes off the caption, NOT out of the plate's parts: a photo
  // with no place yields no plate, and deriving the year from the plate is
  // exactly how the year vanished off the wall entirely on 2026-08-02.
  litYear = tender ? null : yearOf(caption);

  // The card and its echo cross-fade on their own 2.6s transition; the plate
  // and the ghost year stand down and come back around the midpoint, so the
  // words never describe the wrong picture.
  const nextCard = cardImgs[cardSlot ^ 1];
  const prevCard = cardImgs[cardSlot];
  nextCard.src = src;
  nextCard.classList.add("is-shown");
  prevCard.classList.remove("is-shown");
  cardSlot ^= 1;

  const nextEcho = echoEls[echoSlot ^ 1];
  const prevEcho = echoEls[echoSlot];
  nextEcho.style.backgroundImage = `url("${encodeURI(src)}")`;
  nextEcho.classList.add("is-shown");
  prevEcho.classList.remove("is-shown");
  echoSlot ^= 1;

  clearTimeout(blurTimer);
  clearTimeout(exchangeTimer);
  // Whatever the last memory was doing, it stops now — including on the `first`
  // path below, which returns early.
  clearMotionTimers();
  stopClip();

  if (first) {
    setPlate(parts);
    if (ghostEl) ghostEl.textContent = litYear == null ? "" : String(litYear);
    plateEl?.classList.remove("is-exchanging");
    ghostEl?.classList.remove("is-exchanging");
    render();
    return;
  }

  armMotionBurst(frame, tender);

  cardEl?.classList.add("is-exchanging");
  blurTimer = setTimeout(() => {
    blurTimer = null;
    cardEl?.classList.remove("is-exchanging");
  }, EXCHANGE_BLUR_MS);

  plateEl?.classList.add("is-exchanging");
  ghostEl?.classList.add("is-exchanging");
  // setTimeout, never transitionend: the screensaver is display:none-adjacent
  // for most of the day and the event would simply never arrive (CLAUDE.md).
  exchangeTimer = setTimeout(() => {
    exchangeTimer = null;
    setPlate(parts);
    if (ghostEl) ghostEl.textContent = litYear == null ? "" : String(litYear);
    plateEl?.classList.remove("is-exchanging");
    ghostEl?.classList.remove("is-exchanging");
    render();
  }, EXCHANGE_SWAP_MS);
}

// ── The motion burst ──────────────────────────────────────────

/**
 * Night, read from the authority that already owns the question rather than by
 * importing suncalc a second time: the screensaver toggles `data-night` on its
 * own root every 60s (`applyNight`/`syncNight`), and the archive is mounted
 * inside it. Two renderers, one day — the `daySources` argument.
 *
 * ⚠ Gated here in JS, not only in CSS. `display: none` on a <video> hides it
 * and keeps decoding it; the CSS rule is belt-and-braces, not the mechanism.
 */
function isNightNow() {
  return root?.closest("[data-night]")?.dataset.night === "1";
}

function reducedMotion() {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clearMotionTimers() {
  clearTimeout(motionArmTimer);
  clearTimeout(motionEndTimer);
  clearTimeout(motionStopTimer);
  motionArmTimer = null;
  motionEndTimer = null;
  motionStopTimer = null;
}

/**
 * Every terminal path goes through here — burst finished, memory replaced
 * mid-burst, Mode 0 exited, full teardown. Idempotent.
 *
 * ⚠ Order is load-bearing twice over:
 *  - the playback quality is captured FIRST, because dropping the resource
 *    resets the counters and the probe would read zeros between bursts;
 *  - `load()` after `removeAttribute("src")` is what actually frees the media
 *    resource and its decoder. Without it Chromium holds both open. The weather
 *    background teardown does exactly this (weather/renderer.js).
 */
function stopClip() {
  if (!clipEl) return;
  if (clipEl.currentSrc && typeof clipEl.getVideoPlaybackQuality === "function") {
    const q = clipEl.getVideoPlaybackQuality();
    // Copy the fields explicitly. VideoPlaybackQuality exposes them as prototype
    // getters, so spreading or JSON.stringify-ing it yields `{}` — which reads
    // exactly like "the video never decoded".
    lastQuality = {
      total: q.totalVideoFrames,
      dropped: q.droppedVideoFrames,
      corrupted: q.corruptedVideoFrames ?? 0
    };
  }
  clipEl.classList.remove("is-shown");
  clipEl.pause();
  clipEl.removeAttribute("src");
  clipEl.load();
}

/**
 * Arm the burst for an arriving memory, if it has earned one. Called only after
 * the `first` early-return above, so Mode-0 entry never bursts: entry already
 * fires the whole surface arriving, and it is the one moment the panel may have
 * just woken from DPMS.
 */
function armMotionBurst(frame, tender) {
  const clipSrc = typeof frame === "object" ? frame?.clipSrc : null;
  if (!liveMotion || !clipEl) return;
  if (tender) return;              // §4.3: a tender memory is wordless — and still
  if (typeof clipSrc !== "string" || !clipSrc) return;
  if (isNightNow() || reducedMotion()) return;

  motionArmTimer = setTimeout(() => {
    motionArmTimer = null;
    clipEl.src = clipSrc;
    // Revealed only once playback has actually begun, never on `src` alone. The
    // server only advertises a clip it can stat, but a file can still go missing
    // between the page load and a burst hours later, and this repo's scar tissue
    // is a video that decodes NOTHING while reporting no error at all
    // (camera.js:399-401). If play() never resolves, the still simply stays —
    // there is nothing to fall back to, because it never left.
    //
    // Two-handler .then(fn, fn), not .catch/.finally: a rejection on a fresh
    // chain is exactly the uncaught-pageerror shape the suite exists to catch
    // (CLAUDE.md).
    clipEl.play().then(
      () => {
        // The burst may already have been called off while play() was pending —
        // a new memory, Mode 0 exited. `motionEndTimer` still being armed is
        // what says this burst is still wanted.
        if (!motionEndTimer) return;
        clipEl.classList.add("is-shown");
        burstCount += 1;
        lastBurstAt = Date.now();
      },
      () => {}
    );
  }, MOTION_START_MS);

  // Two plain timers, never `ended`/`canplay`/`transitionend`. The screensaver is
  // display:none-adjacent for most of the day, so those events may simply never
  // arrive (CLAUDE.md) — and none is needed, because the server bounds every clip
  // to 3.5s, which makes MOTION_HOLD_MS the sole authority on when this stops.
  motionEndTimer = setTimeout(() => {
    motionEndTimer = null;
    clipEl.classList.remove("is-shown");
  }, MOTION_START_MS + MOTION_HOLD_MS);

  motionStopTimer = setTimeout(() => {
    motionStopTimer = null;
    stopClip();
  }, MOTION_START_MS + MOTION_HOLD_MS + MOTION_FADE_MS);
}

// ── Mode-0 boundary ───────────────────────────────────────────

/**
 * Mode 0 begins. `body.fx-archive-active` IS the cause binding: every loop in
 * `ambient-archive.css` hangs off it, so leaving Mode 0 switches the whole
 * surface off rather than merely hiding it. It also stands the temporal spine
 * down — the archive has taken its job here (§6.3.1).
 */
export function startAmbientArchive() {
  if (!enabled || active) return;
  active = true;
  document.body.classList.add("fx-archive-active");
  fit();
  render();
  clearInterval(tickTimer);
  tickTimer = setInterval(render, TICK_MS);
}

/** Mode 0 ends. Symmetric teardown of everything the entry armed. */
export function stopAmbientArchive() {
  if (!active) return;
  active = false;
  document.body.classList.remove("fx-archive-active");
  clearInterval(tickTimer);
  clearTimeout(exchangeTimer);
  clearTimeout(blurTimer);
  tickTimer = null;
  exchangeTimer = null;
  blurTimer = null;
  // The path that matters most for the 24/7 discipline: Mode-0 exit fires on
  // every motion wake, many times a day. A burst interrupted here must free its
  // decoder, not just stop being visible.
  clearMotionTimers();
  stopClip();
  cardEl?.classList.remove("is-exchanging");
  plateEl?.classList.remove("is-exchanging");
  ghostEl?.classList.remove("is-exchanging");
}

// ── DOM build (once) ──────────────────────────────────────────

function buildRuler(className, w, h, lineY, top, z) {
  const canvas = document.createElement("canvas");
  canvas.className = `archive__ruler ${className}`;
  canvas.width = w;
  canvas.height = h;
  canvas.style.top = `${top - lineY}px`;
  canvas.style.setProperty("--row-z", `${z}px`);
  return canvas;
}

function build(mount) {
  root = document.createElement("div");
  root.className = "archive";
  root.setAttribute("aria-hidden", "true");

  const scene = document.createElement("div");
  scene.className = "archive__scene";

  echoEls = [0, 1].map((i) => {
    const echo = document.createElement("div");
    echo.className = "archive__echo";
    echo.dataset.slot = String(i);
    return echo;
  });
  echoEls[0].classList.add("is-shown");

  todayCanvas = buildRuler("archive__ruler--today", ROW_W, TODAY_H, TODAY_LINE_Y, TODAY_TOP, TODAY_Z);
  todayCtx = todayCanvas.getContext("2d", { alpha: true });

  ghostEl = document.createElement("div");
  ghostEl.className = "archive__ghost";

  const cardPlane = document.createElement("div");
  cardPlane.className = "archive__card-plane";
  const cardWrap = document.createElement("div");
  cardWrap.className = "archive__card-wrap";
  cardEl = document.createElement("div");
  cardEl.className = "archive__card";
  cardImgs = [0, 1].map((i) => {
    const img = document.createElement("img");
    img.className = "archive__img";
    img.alt = "";
    img.dataset.slot = String(i);
    return img;
  });
  // The motion burst's surface. A THIRD element over the two still slots, never
  // a slot swap — `cardImgs`/`cardSlot` IS the exchange state machine, and
  // archiveProbe().photo reads that slot from the outside (the tender invariant
  // is asserted through it). Built only when the flag is on, so flag-off leaves
  // the DOM byte-identical: no element, no timer, no listener, no fetch.
  //
  // Ordered above the stills and BELOW grade/lip, so the burst inherits the
  // card's grade and its inner-shadow lip — which is what keeps it reading as
  // the same card rather than a video player that appeared.
  if (liveMotion) {
    clipEl = document.createElement("video");
    clipEl.className = "archive__clip";
    clipEl.muted = true;              // a screensaver that speaks is another product
    clipEl.playsInline = true;
    clipEl.preload = "none";          // nothing is fetched until a burst is armed
    clipEl.setAttribute("aria-hidden", "true");
    // Deliberately absent: `loop` (§5.1 — a momentary cause rendered as a loop is
    // a law-1 violation), `autoplay`, and any `src` at rest.
  }

  const grade = document.createElement("div");
  grade.className = "archive__grade";
  const lip = document.createElement("div");
  lip.className = "archive__lip";
  cardEl.append(...cardImgs, ...(clipEl ? [clipEl] : []), grade, lip);
  cardWrap.append(cardEl);
  cardPlane.append(cardWrap);

  scene.append(...echoEls, todayCanvas, ghostEl, cardPlane);

  const vig = document.createElement("div");
  vig.className = "archive__vig";

  const word = document.createElement("div");
  word.className = "archive__word";
  word.textContent = "Archive";

  plateEl = document.createElement("div");
  plateEl.className = "archive__plate";
  plateEyebrowEl = document.createElement("div");
  plateEyebrowEl.className = "archive__plate-row archive__eyebrow";
  plateTitleEl = document.createElement("div");
  plateTitleEl.className = "archive__plate-row archive__title";
  plateWhoEl = document.createElement("div");
  plateWhoEl.className = "archive__plate-row archive__who";
  plateEl.append(plateEyebrowEl, plateTitleEl, plateWhoEl);

  const grain = document.createElement("div");
  grain.className = "archive__grain";

  root.append(scene, vig, word, plateEl, grain);
  mount.prepend(root);
}

/**
 * The Ambient Archive. Flag-off returns before touching anything: no DOM, no
 * timer, no body class, no hook — Mode 0 is exactly today's verified
 * screensaver, and that is the rollback path (§6.3.1).
 *
 * @param {{enabled?: boolean, liveMotion?: boolean, mount?: HTMLElement}} options
 *   `mount` is the screensaver root, so the archive is a CHILD of `#screensaver`
 *   and the screensaver blank rule (which targets body children) never sees it.
 *   `liveMotion` adds the Live Photo burst; off builds no <video> at all.
 */
export function initAmbientArchive({ enabled: on_ = false, liveMotion: motion_ = false, mount = null } = {}) {
  if (on_ !== true || !mount) return false;
  enabled = true;
  liveMotion = motion_ === true;
  // Two markers, and the difference matters. `ambient-archive-on` says the flag
  // is on and never comes off — it carries the rules that must hold on BOTH
  // sides of a Mode-0 boundary (killing the clock's font-size transition, which
  // would otherwise animate a layout property on the way in AND on the way
  // out). `fx-archive-active` is the CAUSE: Mode 0 is running, and every loop
  // hangs off it, so leaving Mode 0 switches the surface off.
  document.body.classList.add("ambient-archive-on");
  build(mount);

  initDaySources();
  on("calendar:refreshed", () => { if (active) render(); });
  on("bins:updated", () => { if (active) render(); });

  resizeHandler = () => fit();
  window.addEventListener("resize", resizeHandler);
  fit();
  render();
  return true;
}

/** Full teardown — the 24/7 discipline's escape hatch and the tests' seam. */
export function stopAmbientArchiveAll() {
  stopAmbientArchive();
  document.body.classList.remove("ambient-archive-on");
  if (resizeHandler) window.removeEventListener("resize", resizeHandler);
  resizeHandler = null;
  root?.remove();
  root = null;
  todayCanvas = null;
  todayCtx = null;
  echoEls = [];
  cardImgs = [];
  clipEl = null;          // stopAmbientArchive above already released its resource
  liveMotion = false;
  burstCount = 0;
  lastBurstAt = null;
  lastQuality = null;
  cardEl = null;
  ghostEl = null;
  plateEl = null;
  plateEyebrowEl = null;
  plateTitleEl = null;
  plateWhoEl = null;
  lastDay = null;
  lastFrame = null;
  litYear = null;
  echoSlot = 0;
  cardSlot = 0;
  enabled = false;
}

/** CDP/verification probe — the `__spine()` / `__ssPlace()` convention. */
export function archiveProbe() {
  return {
    enabled,
    active,
    marker: document.body.classList.contains("fx-archive-active"),
    lit: litYear,
    nowHour: lastDay?.nowHour ?? null,
    marks: (lastDay?.marks ?? []).length,
    dim: clockDim(),
    amp: getComputedStyle(root || document.body).getPropertyValue("--arch-amp").trim() || null,
    // The tender invariant, readable from the outside: no plate, no words.
    plate: plateEl?.classList.contains("is-visible")
      ? {
          eyebrow: plateEyebrowEl.textContent,
          title: plateTitleEl.textContent,
          who: plateWhoEl.textContent || null
        }
      : null,
    ghost: ghostEl?.textContent || null,
    photo: cardImgs[cardSlot]?.getAttribute("src") ?? null,
    // The motion burst, for /kiosk-metrics. `bursts` + `lastQuality` together
    // prove the feature is alive in two CDP reads without looking at a pixel —
    // which is the only way to prove it, since CDP screencast is blind to
    // hardware video (deploy/REMOTE-ACCESS.md). `night`/`reduced` say why it did
    // NOT burst on the occasions when it did not.
    motion: clipEl
      ? {
          enabled: liveMotion,
          armed: Boolean(motionArmTimer || motionEndTimer || motionStopTimer),
          shown: clipEl.classList.contains("is-shown"),
          playing: Boolean(clipEl.currentSrc) && !clipEl.paused,
          src: clipEl.getAttribute("src"),
          readyState: clipEl.readyState,
          bursts: burstCount,
          lastBurstAt,
          lastQuality,
          night: isNightNow(),
          reduced: reducedMotion()
        }
      : null
  };
}
