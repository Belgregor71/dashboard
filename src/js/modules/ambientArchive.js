import {
  buildDay,
  buildStrata,
  hourOf,
  onSpine,
  spineT,
  ARCHIVE_STRATA_ROWS,
  DAY_START_HOUR,
  DAY_END_HOUR
} from "../services/dayModel.js";
import { captionParts } from "../services/photoMemory.js";
import { initDaySources, readDayMarks } from "./daySources.js";
import { on } from "../core/eventBus.js";

// The Ambient Archive — Mode 0 as the house's instrument space.
// docs/design/AMBIENT-ARCHIVE.md is the implementation authority.
//
// Mode 0 stops being "a photo with a clock on it". The memory becomes a lit
// card pivoting slowly in a deep space, a desaturated tiled echo of itself
// behind it, and — the part that is NOT in the reference — the ruler planes
// beneath it are the temporal spine's day, rendered in three dimensions:
//
//   across is today (05:00 → 24:00, the same axis the spine draws flat)
//   back   is the years (the strata, receding in Z)
//
// One instrument, two readings. The archive's own horizontal year ruler is
// deleted; the plane it lived on now carries the hour axis (§6.2), which is the
// owner's decision this whole surface rests on.
//
// ── How this obeys DESIGN_SYSTEM.md §5 ───────────────────────────────────────
//
// Every continuous animation hangs off `body.fx-archive-active`, set on Mode-0
// entry and removed on exit. The cause is nameable by anyone in the room: *the
// house is leafing through its album*. Nothing completes a perceptible change
// within a passing glance — the pivot takes 84 s, the drift 130 s, the zoom
// 96 s — and the only catchable events (the memory exchange, its 300 ms blur)
// are events with ends. Amplitude rides `--clock-dim` (§5.2): at 2 a.m. the
// archive drifts less far, not less often.
//
// The instrument itself does NOT move. Once the plane means time of day you
// cannot slide it: the reference's ±80 px strip drift would misread as ~50
// minutes. So the reference's `s1`/`s2` keyframes are deliberately absent, and
// the motion budget belongs entirely to the card and its backdrop.
//
// The now-point does not breathe (§6.3.4): the breath is bound to media playing
// AND someone in the room, which in Mode 0 is false by definition.
//
// ── Memory discipline (CLAUDE.md, 24/7) ──────────────────────────────────────
//
// The archive allocates nothing per mark and nothing per memory. Every node is
// created once in `build()`: six row canvases (today + ARCHIVE_STRATA_ROWS
// years), two card images, two echo planes, one plate. Marks are drawn into the
// canvases; the plate is filled, shown, hidden — never cloned, never detached.
// The exchange's staged swap is a `setTimeout`, never `transitionend` (which
// never fires while an ancestor is display:none, i.e. most of the day).

// ── Geometry (frame coordinates on the fixed 1920×1080 canvas) ───────────────
// Measured from `Ambient Archive Screensaver.html`, then re-laid-out for the
// deck: the reference's card is 1040×585 at (130,212), which leaves no room
// under it for six receding rows. The card yields; the day is why this surface
// changed shape.

const FRAME_W = 1920;
const FRAME_H = 1080;

const ROW_W = 2160;      // each row bleeds 120px past both frame edges
const ROW_H = 320;
const ROW_LEFT = -120;   // frame x of row-canvas x 0
const ROW_LINE_Y = 110;  // row-canvas y of the line itself
const ROW_LABEL_X = 88 - ROW_LEFT; // row-canvas x the year numeral ends at

const MARGIN = 108;                      // frame px kept clear at each end (the spine's)
const AXIS_X0 = MARGIN - ROW_LEFT;       // row-canvas x of 05:00
const AXIS_SPAN = FRAME_W - MARGIN * 2;  // row-canvas px from 05:00 to 24:00

const TODAY_TOP = 892;   // frame y of today's line — the front row
const ROW_RISE = 26;     // frame y each older year climbs toward the vanishing point
const ROW_DEPTH = 40;    // |translateZ| of today's row
const ROW_DEPTH_STEP = 78;

/**
 * The deep drawer.
 *
 * The consecutive rows reach back ARCHIVE_STRATA_ROWS years; the photo library
 * reaches back a great deal further, so most memories would light nothing and
 * §6.2's whole point — the year-line joining forward to today — would almost
 * never happen. Rather than pretend, the deck opens ONE more row, further back
 * and past a visible gap, and puts the card's own year in it.
 *
 * That is what an archive drawer actually looks like: the recent years in
 * order, then a gap, then the one you pulled out. The gap is the honest part —
 * it says "there are years between these", which is true.
 *
 * It is a fixed slot, allocated at build like every other row. Nothing here
 * grows with how far back the memory reaches.
 */
const DEEP_ROW_GAP = 1.9; // in row-steps, so the skipped year reads as a gap

const HOUR_LABELS = [6, 12, 18, 24];
const TICK_MS = 30_000;  // half a minute — the now-point never lags a minute

// The exchange (§3): the card blurs for a beat, the plate and the ghost year
// stand down, everything swaps at the midpoint, then it all comes back.
const EXCHANGE_BLUR_MS = 300;
const EXCHANGE_SWAP_MS = 2400;

let enabled = false;
let root = null;
let deckEl = null;
let rowEls = [];         // [today, year-1, … year-N, deep] — allocated once
let rowCtxs = [];
let deepRowEl = null;
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

// ── The deck: across is today, back is the years ──────────────

function axisX(t) {
  return AXIS_X0 + t * AXIS_SPAN;
}

/** The dim curve the ambient clock already computes (§5.2). Never below its floor. */
function clockDim() {
  const src = document.getElementById("screensaver") || document.body;
  const v = parseFloat(getComputedStyle(src).getPropertyValue("--clock-dim"));
  return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0.9;
}

/**
 * The front row: today. The same reading the spine draws flat — minute texture,
 * the four hour numerals, marks rising as anticipation, embers behind, and now
 * as the brightest point — only here it is lying on a plane that recedes.
 */
function drawToday(day, dim) {
  const ctx = rowCtxs[0];
  if (!ctx) return;
  const y = ROW_LINE_Y + 0.5; // +0.5 so a 1px line lands on a pixel
  const left = axisX(0);
  const right = axisX(1);

  ctx.clearRect(0, 0, ROW_W, ROW_H);
  ctx.globalAlpha = dim;

  // The line, and the minute texture along it — the reference's ruler tick
  // spacing (21px), which is also the spine's.
  ctx.fillStyle = "rgba(238,243,251,0.14)";
  ctx.fillRect(0, y, ROW_W, 1);
  ctx.fillStyle = "rgba(238,243,251,0.10)";
  for (let x = 0; x < ROW_W; x += 21) {
    ctx.fillRect(Math.round(x), y + 1, 1, 9);
  }

  // The burnt portion: everything left of now has already been lived through.
  if (day.nowT != null) {
    const nowX = axisX(day.nowT);
    const burn = ctx.createLinearGradient(left, 0, nowX, 0);
    burn.addColorStop(0, "rgba(255,180,130,0.12)");
    burn.addColorStop(1, "rgba(255,180,130,0.30)");
    ctx.fillStyle = burn;
    ctx.fillRect(left, y, Math.max(0, nowX - left), 1);
  }

  // Hour numerals — the only numbers on the instrument, and the reason a
  // foreshortened ruler still tells the truth about when you are.
  ctx.fillStyle = "rgba(159,196,255,0.34)";
  ctx.font = '400 20px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const hour of HOUR_LABELS) {
    if (hour < DAY_START_HOUR || hour > DAY_END_HOUR) continue;
    const t = (hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR);
    ctx.fillText(`${String(hour).padStart(2, "0")}:00`, axisX(t), y + 16);
  }

  // The marks. Weight is the only hierarchy: size and glow, nothing else.
  for (const m of day.marks) {
    const height = 11 + m.weight * 7;
    const width = m.weight > 2 ? 3 : 2;
    const x = Math.round(axisX(m.t) - width / 2);
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
    const nowX = axisX(day.nowT);
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

/**
 * A year-row: the same axis, one year further back. Plain until a memory from
 * that year is actually on the card, at which point the row brightens, carries
 * a mark at the memory's hour, and reaches forward toward today.
 *
 * The reach is deliberately short of touching. These rows are at different
 * depths; a hairline that appeared to join them would be drawing a join that
 * the geometry does not have.
 */
function drawYearRow(stratum, dim) {
  const ctx = rowCtxs[stratum.row];
  if (!ctx) return;
  const y = ROW_LINE_Y + 0.5;

  ctx.clearRect(0, 0, ROW_W, ROW_H);
  ctx.globalAlpha = dim;

  ctx.fillStyle = `rgba(159,196,255,${stratum.lit ? 0.26 : 0.11})`;
  ctx.fillRect(0, y, ROW_W, 1);

  // The year sits in the left margin, before the axis begins — where a ruler
  // labels its rows, and where perspective has not yet crowded them together.
  // (The right-hand end is the near end, but it is also where the rows converge
  // toward the vanishing point, so numerals there stack and clip.)
  ctx.fillStyle = stratum.lit ? "rgba(255,205,140,0.95)" : "rgba(159,196,255,0.34)";
  ctx.font = '400 22px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(stratum.year), ROW_LABEL_X, y - 10);

  if (stratum.t != null) {
    const mx = axisX(stratum.t);
    const h = stratum.lit ? 18 : 9;
    ctx.fillStyle = `rgba(255,205,150,${stratum.lit ? 0.95 : 0.4})`;
    ctx.shadowColor = `rgba(255,190,120,${stratum.lit ? 0.55 : 0.15})`;
    ctx.shadowBlur = 10;
    ctx.fillRect(Math.round(mx - 1), y - h, 2, h);
    ctx.shadowBlur = 0;

    if (stratum.lit) {
      // Reaching forward toward today, one row's worth per row of distance.
      // It stops short of touching on purpose: these rows are at different
      // depths, and a line that appeared to join them would be drawing a join
      // the geometry does not have.
      const reach = Math.min(34 + stratum.row * 30, ROW_H - ROW_LINE_Y - 8);
      const grad = ctx.createLinearGradient(0, y, 0, y + reach);
      grad.addColorStop(0, "rgba(255,205,150,0.45)");
      grad.addColorStop(1, "rgba(255,205,150,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(Math.round(mx), y + 3, 1, reach);
    }
  }

  ctx.globalAlpha = 1;
}

/**
 * The memory's wall-clock hour, expressed on today's clock — the year-row is a
 * scroll of the SAME axis, so the mark belongs at that hour of today's span.
 */
function strataAt(hour, now) {
  if (!Number.isFinite(hour)) return null;
  const at = new Date(now);
  at.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return at;
}

/** Repaint the whole instrument. Called on a cause, never on a frame. */
function render() {
  if (!enabled || !root) return;
  const now = new Date();
  // A lit year-line carries a mark at the hour the photograph was actually
  // taken — that is the join §6.2 promises, and the reason `hour` is plumbed
  // through the daily set. A memory with no known hour lights its line and
  // places no mark: we know the year, so we say the year, and nothing more.
  // `buildStrata` reads a stratum's clock time from `at`, so hand it one: a
  // bare fractional `hour` would be parsed as milliseconds since the epoch.
  const strataRows = litYear == null ? [] : [{ year: litYear, at: strataAt(lastFrame?.hour, now) }];
  const day = buildDay({
    marks: readDayMarks(now),
    now,
    strata: strataRows
  });
  // buildDay hands back STRATA_ROWS rows (the spine's three). The archive's
  // plane carries more, so the strata are rebuilt at the archive's own reach —
  // the model is shared, the count is the renderer's business (§6.3.3).
  day.strata = buildStrata(strataRows, { now, count: ARCHIVE_STRATA_ROWS });

  const deep = deepStratum(litYear, day.strata, now);
  if (deep) day.strata.push(deep);
  deepRowEl?.classList.toggle("is-visible", Boolean(deep));
  lastDay = day;

  const dim = clockDim();
  drawToday(day, dim);
  for (const stratum of day.strata) drawYearRow(stratum, dim);
  if (!deep && rowCtxs[ARCHIVE_STRATA_ROWS + 1]) {
    rowCtxs[ARCHIVE_STRATA_ROWS + 1].clearRect(0, 0, ROW_W, ROW_H);
  }
}

/**
 * The card's year as a row of its own, when it lies deeper than the deck's
 * consecutive reach. Returns null when the year is already on the deck (or
 * there is no lit year at all), so the drawer only opens when it has to.
 */
function deepStratum(year, strata, now) {
  if (year == null || !strata.length) return null;
  // Only for years the consecutive rows do NOT reach. `strata` runs newest
  // first, so its last row is the deepest one already on the deck: anything at
  // or above it is either drawn there already or is not in the past at all.
  if (year >= strata[strata.length - 1].year) return null;
  const at = strataAt(lastFrame?.hour, now);
  const hour = hourOf(at);
  return {
    year,
    row: ARCHIVE_STRATA_ROWS + 1,
    lit: true,
    hour: onSpine(hour) ? hour : null,
    t: onSpine(hour) ? spineT(hour) : null
  };
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
  plateEyebrowEl.textContent = parts.year;
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
  const parts = caption ? captionParts(caption) : null;
  const first = lastFrame == null;
  const hour = typeof frame === "object" && Number.isFinite(frame?.hour) ? frame.hour : null;
  lastFrame = { src, caption, hour };
  litYear = parts && /^\d{4}$/.test(parts.year) ? Number(parts.year) : null;

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

  if (first) {
    setPlate(parts);
    if (ghostEl) ghostEl.textContent = litYear == null ? "" : String(litYear);
    plateEl?.classList.toggle("is-exchanging", false);
    ghostEl?.classList.toggle("is-exchanging", false);
    render();
    return;
  }

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
  cardEl?.classList.remove("is-exchanging");
  plateEl?.classList.remove("is-exchanging");
  ghostEl?.classList.remove("is-exchanging");
}

// ── DOM build (once) ──────────────────────────────────────────

function buildRow(row, step = row) {
  const canvas = document.createElement("canvas");
  canvas.className = "archive__row";
  canvas.width = ROW_W;
  canvas.height = ROW_H;
  canvas.style.setProperty("--row", String(row));
  canvas.style.top = `${TODAY_TOP - ROW_LINE_Y - step * ROW_RISE}px`;
  canvas.style.setProperty("--row-z", `${-(ROW_DEPTH + step * ROW_DEPTH_STEP)}px`);
  rowCtxs[row] = canvas.getContext("2d", { alpha: true });
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

  deckEl = document.createElement("div");
  deckEl.className = "archive__deck";
  rowEls = Array.from({ length: ARCHIVE_STRATA_ROWS + 1 }, (_, row) => buildRow(row));
  // The deep drawer: one more slot, further back and past a gap, for a memory
  // older than the consecutive rows reach. Allocated here so it never becomes
  // a per-memory node; hidden until a memory needs it.
  deepRowEl = buildRow(ARCHIVE_STRATA_ROWS + 1, ARCHIVE_STRATA_ROWS + DEEP_ROW_GAP);
  deepRowEl.classList.add("archive__row--deep");
  rowEls.push(deepRowEl);
  deckEl.append(...rowEls);

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
  const grade = document.createElement("div");
  grade.className = "archive__grade";
  const lip = document.createElement("div");
  lip.className = "archive__lip";
  cardEl.append(...cardImgs, grade, lip);
  cardWrap.append(cardEl);
  cardPlane.append(cardWrap);

  scene.append(...echoEls, deckEl, ghostEl, cardPlane);

  const vig = document.createElement("div");
  vig.className = "archive__vig";

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

  root.append(scene, vig, plateEl, grain);
  mount.prepend(root);
}

/**
 * The Ambient Archive. Flag-off returns before touching anything: no DOM, no
 * timer, no body class, no hook — Mode 0 is exactly today's verified
 * screensaver, and that is the rollback path (§6.3.1).
 *
 * @param {{enabled?: boolean, mount?: HTMLElement}} options `mount` is the
 *   screensaver root, so the archive is a CHILD of `#screensaver` and the
 *   screensaver blank rule (which targets body children) never sees it.
 */
export function initAmbientArchive({ enabled: on_ = false, mount = null } = {}) {
  if (on_ !== true || !mount) return false;
  enabled = true;
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
  deckEl = null;
  rowEls = [];
  rowCtxs = [];
  deepRowEl = null;
  echoEls = [];
  cardImgs = [];
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
    rows: rowEls.length,
    years: (lastDay?.strata ?? []).map((s) => s.year),
    lit: (lastDay?.strata ?? []).filter((s) => s.lit).map((s) => s.year),
    nowHour: lastDay?.nowHour ?? null,
    marks: (lastDay?.marks ?? []).length,
    dim: clockDim(),
    // The tender invariant, readable from the outside: no plate, no words.
    plate: plateEl?.classList.contains("is-visible")
      ? {
          year: plateEyebrowEl.textContent,
          title: plateTitleEl.textContent,
          who: plateWhoEl.textContent || null
        }
      : null,
    ghost: ghostEl?.textContent || null,
    photo: cardImgs[cardSlot]?.getAttribute("src") ?? null
  };
}
