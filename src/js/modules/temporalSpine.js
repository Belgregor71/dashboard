import {
  buildDay,
  languageBudget,
  labelledMarks,
  anchorFor,
  DAY_START_HOUR,
  DAY_END_HOUR,
  MAX_SLOTS,
  STRATA_ROWS
} from "../services/dayModel.js";
import { initDaySources, readDayMarks, resetDaySources } from "./daySources.js";
import { getMode } from "../core/presence.js";
import { on } from "../core/eventBus.js";

// "The Day, Rendered" v2 — the temporal spine (docs/design/TEMPORAL-SPINE.md).
//
// A thin horizontal line of light low on the surface holds the household's day:
// plans ahead as anticipation, the morning behind as embers, other years as
// fainter strata beneath, and NOW as the brightest point, travelling at the
// sun's speed. Nothing on it is a card. Everything is pre-verbal light until it
// is near enough and heavy enough to earn words, and at most one thing speaks.
//
// ── How this obeys DESIGN_SYSTEM.md §5 ───────────────────────────────────────
//
// The spine has **no requestAnimationFrame loop at all**. The marks, embers,
// strata and the now-point are drawn into one canvas that is repainted only when
// something changes: the minute rolls over, the calendar refreshes, bins land,
// presence moves, or the window resizes. A minute tick that moves the now-point
// ~1.5px is a *change*, not an animation — §5.1 is explicit that internal state
// and the passage of time may change the surface but may not move it, and at
// 1.5px/min nothing is ever caught moving.
//
// The ONE continuous element is the now-point's breath (§4 law 3): a ±4%
// luminance swing, ~6s period, no positional component, implemented as a CSS
// animation on a single element and **bound to a cause** — `body.spine-alive` is
// set only while media is playing AND someone is in the room. Music you chose is
// a cause the room can name. An empty room drops the class and the animation
// stops; an empty room renders at 0 fps because it has no attention to spend.
// Its amplitude scales with --clock-dim (§5.2): at 2am it still breathes, faintly.
//
// Language is the only DOM: five nodes (eyebrow, utterance, connector, and three
// rank-dimmed labels) created once at boot and reused — filled, shown, hidden;
// never cloned, never detached. The spine itself allocates nothing per mark, so
// the detached-node failure class cannot occur here.

const TICK_MS = 30_000;          // half a minute — the now-point never lags a minute
const FADE_MS = 900;             // > the CSS opacity transition; setTimeout, never transitionend
const BASE_W = 1920;             // the reference geometry the proposal is drawn at
const BASE_H = 1080;
const SAFE_MARGIN = 108 / BASE_W; // fraction of width kept clear at each end
const SPINE_Y = 860 / BASE_H;     // the wall's horizon — low, out of the reading zone
const HOUR_LABELS = [6, 12, 18, 24];

let root = null;
let canvas = null;
let ctx = null;
let breathEl = null;
let utterEl = null;
let utterEyebrowEl = null;
let utterTextEl = null;
let connectorEl = null;
let labelEls = [];               // exactly LABEL_SLOTS, allocated once
let tickTimer = null;
let labelClearTimer = null;
let resizeHandler = null;
let enabled = false;
let lastDay = null;
let forcedStrata = [];

// ── State reads ───────────────────────────────────────────────
// The runtime reads; dayModel decides. What the day is MADE of lives in
// modules/daySources.js, because the Ambient Archive renders the same day on a
// different geometry (docs/design/AMBIENT-ARCHIVE.md §6) — two renderers, one
// day. Everything below is the spine's own state: what it is allowed to say,
// and how brightly.

/**
 * Is media audible in the room? Concurrency: light aggregates, language ranks —
 * three streams in three rooms are still one now and one breath, so this is
 * deliberately binary (§3 "Media").
 */
function mediaAlive() {
  for (const id of ["media-panel-1", "media-panel-2"]) {
    const panel = document.getElementById(id);
    if (!panel) continue;
    if (!panel.classList.contains("is-hidden") && !panel.classList.contains("is-collapsed")) return true;
  }
  return false;
}

/** The night amplitude scalar the ambient clock already computes (§5.2). */
function clockDim() {
  const src = document.getElementById("screensaver") || document.body;
  const v = parseFloat(getComputedStyle(src).getPropertyValue("--clock-dim"));
  return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 1;
}

// ── The canvas ────────────────────────────────────────────────

function sizeCanvas() {
  if (!canvas || !root) return null;
  const w = root.clientWidth || BASE_W;
  const h = root.clientHeight || BASE_H;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, scale: w / BASE_W };
}

function xFor(t, w) {
  const margin = SAFE_MARGIN * w;
  return margin + t * (w - margin * 2);
}

function drawSpine(day) {
  const size = sizeCanvas();
  if (!size || !ctx) return;
  const { w, h, scale } = size;
  const y = Math.round(h * SPINE_Y) + 0.5; // +0.5 so a 1px line lands on a pixel
  const left = xFor(0, w);
  const right = xFor(1, w);
  const dim = clockDim();

  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = dim;

  // The line itself, and the minute texture along it.
  ctx.fillStyle = "rgba(238,243,251,0.12)";
  ctx.fillRect(left, y, right - left, 1);
  ctx.fillStyle = "rgba(238,243,251,0.10)";
  for (let x = left; x < right; x += 21 * scale) {
    ctx.fillRect(Math.round(x), y + 1, 1, 10 * scale);
  }

  // The burnt portion: everything left of now has already been lived through.
  if (day.nowT != null) {
    const nowX = xFor(day.nowT, w);
    const burn = ctx.createLinearGradient(left, 0, nowX, 0);
    burn.addColorStop(0, "rgba(255,180,130,0.12)");
    burn.addColorStop(1, "rgba(255,180,130,0.30)");
    ctx.fillStyle = burn;
    ctx.fillRect(left, y, Math.max(0, nowX - left), 1);
  }

  // Hour labels — the only numerals on the spine.
  ctx.fillStyle = "rgba(159,196,255,0.30)";
  ctx.font = `400 ${Math.round(17 * scale)}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const hourLabel of HOUR_LABELS) {
    if (hourLabel < DAY_START_HOUR || hourLabel > DAY_END_HOUR) continue;
    const t = (hourLabel - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR);
    ctx.fillText(`${String(hourLabel).padStart(2, "0")}:00`, xFor(t, w), y + 18 * scale);
  }

  // The marks. Weight is the only hierarchy: size and glow, nothing else.
  for (const m of day.marks) {
    const height = (11 + m.weight * 7) * scale;
    const width = Math.max(2, Math.round((m.weight > 2 ? 3 : 2) * scale));
    const x = Math.round(xFor(m.t, w) - width / 2);
    if (m.spent) {
      // Spent, warm, dim — the day as it actually went.
      ctx.fillStyle = "rgba(255,175,125,0.5)";
      ctx.shadowColor = "rgba(255,165,110,0.3)";
      ctx.shadowBlur = 8 * scale;
    } else if (m.warm) {
      ctx.fillStyle = "rgba(255,205,140,0.95)";
      ctx.shadowColor = "rgba(255,190,120,0.55)";
      ctx.shadowBlur = 12 * scale;
    } else {
      ctx.fillStyle = "rgba(190,215,255,0.85)";
      ctx.shadowColor = "rgba(159,196,255,0.4)";
      ctx.shadowBlur = 10 * scale;
    }
    ctx.fillRect(x, y - height, width, height);
  }
  ctx.shadowBlur = 0;

  // Now: the brightest point on the line, plus its soft spill.
  if (day.nowT != null) {
    const nowX = xFor(day.nowT, w);
    const spillH = 92 * scale;
    const spill = ctx.createRadialGradient(nowX, y, 0, nowX, y, spillH * 0.8);
    spill.addColorStop(0, "rgba(255,225,190,0.28)");
    spill.addColorStop(1, "rgba(255,225,190,0)");
    ctx.fillStyle = spill;
    ctx.fillRect(nowX - 60 * scale, y - spillH, 120 * scale, spillH);

    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(255,220,180,0.6)";
    ctx.shadowBlur = 18 * scale;
    ctx.fillRect(Math.round(nowX - 1.5 * scale), y - 30 * scale, Math.max(2, 3 * scale), 30 * scale);
    ctx.shadowBlur = 0;
  }

  // The strata: the same axis, years down. Where "on this day" lives.
  day.strata.forEach((st) => {
    const sy = Math.round(y + (40 + 30 * (st.row - 1)) * scale) + 0.5;
    ctx.fillStyle = `rgba(159,196,255,${st.lit ? 0.22 : 0.07})`;
    ctx.fillRect(left, sy, right - left, 1);
    if (st.t == null) return;
    const mx = xFor(st.t, w);
    const mh = (st.lit ? 16 : 9) * scale;
    ctx.fillStyle = `rgba(255,205,150,${st.lit ? 0.95 : 0.4})`;
    ctx.shadowColor = `rgba(255,190,120,${st.lit ? 0.55 : 0.15})`;
    ctx.shadowBlur = 10 * scale;
    ctx.fillRect(Math.round(mx - 1), sy - mh, 2, mh);
    ctx.shadowBlur = 0;
    if (st.lit) {
      // Joined to now by a hairline — so you can see *when* you are.
      ctx.fillStyle = "rgba(255,205,150,0.35)";
      ctx.fillRect(Math.round(mx), y + 4, 1, sy - y - 6);
      ctx.fillStyle = "rgba(255,205,140,0.9)";
      ctx.font = `400 ${Math.round(17 * scale)}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = "left";
      ctx.fillText(String(st.year), mx + 10 * scale, sy - 20 * scale);
    }
  });

  ctx.globalAlpha = 1;
}

// ── Language (the only DOM) ───────────────────────────────────

function positionAt(el, t) {
  const w = root?.clientWidth || BASE_W;
  el.style.setProperty("--spine-x", `${xFor(t, w)}px`);
}

function showUtterance(anchor, { eyebrow, text }) {
  if (!utterEl) return;
  utterEyebrowEl.textContent = eyebrow || "";
  utterTextEl.textContent = text;
  if (anchor?.t != null) {
    positionAt(utterEl, anchor.t);
    positionAt(connectorEl, anchor.t);
    connectorEl.classList.add("is-visible");
  } else {
    connectorEl.classList.remove("is-visible");
  }
  utterEl.classList.add("is-visible");
}

function hideUtterance() {
  utterEl?.classList.remove("is-visible");
  connectorEl?.classList.remove("is-visible");
}

/**
 * The next three take short labels, staggered above the spine and dimmed by
 * rank. Never a panel — text is anchored to time, not boxed in glass. The nodes
 * are permanent; only their text and visibility change.
 */
function renderLabels(marks) {
  clearTimeout(labelClearTimer);
  labelEls.forEach((el, i) => {
    const m = marks[i];
    if (!m) {
      el.classList.remove("is-visible");
      return;
    }
    el.querySelector(".spine-label__time").textContent = formatHour(m.hour);
    el.querySelector(".spine-label__text").textContent = m.label;
    el.style.setProperty("--spine-rank", String(i));
    positionAt(el, m.t);
    el.classList.add("is-visible");
  });
  // Blank the text of hidden nodes after the fade — never on transitionend,
  // which does not fire while an ancestor is display:none.
  labelClearTimer = setTimeout(() => {
    labelEls.forEach((el, i) => {
      if (marks[i]) return;
      el.querySelector(".spine-label__time").textContent = "";
      el.querySelector(".spine-label__text").textContent = "";
    });
  }, FADE_MS);
}

function formatHour(hour) {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * What speaks. The attention queue survives the rewrite — it now allocates
 * *language*, not presence, so the scored winner is exactly the line that would
 * have been the hero. The mark it anchors to gives the words somewhere true to
 * grow out of.
 */
function readWinner() {
  try {
    const sel = window.__attention?.();
    const hero = sel?.hero;
    if (!hero?.text) return null;
    return { text: hero.text, eyebrow: eyebrowFor(hero), id: hero.id };
  } catch {
    return null;
  }
}

function eyebrowFor(hero) {
  if (hero.interrupt) return "Now";
  switch (hero.source) {
    case "nextEvent": return "Next";
    case "commute": return "Getting out";
    case "nowPlaying":
    case "plex": return "Now playing";
    case "tonightsMenu": return "Tonight";
    case "cameraTrigger": return "At the door";
    default: return "";
  }
}

// ── The tick ──────────────────────────────────────────────────

function update() {
  if (!enabled || !root) return;
  const now = new Date();
  const day = buildDay({ marks: readDayMarks(now), now, strata: forcedStrata });
  lastDay = day;
  drawSpine(day);

  const mode = getMode();
  const budget = languageBudget(mode);

  // The breath: the one continuous element, and it must report a cause. Music
  // audible AND someone in the room, or it does not run at all.
  const alive = budget.utterance > 0 && mediaAlive();
  document.body.classList.toggle("spine-alive", alive);
  if (breathEl && day.nowT != null) positionAt(breathEl, day.nowT);
  breathEl?.classList.toggle("is-visible", day.nowT != null);

  if (budget.utterance > 0) {
    const winner = readWinner();
    if (winner) showUtterance(anchorFor(day.marks, { id: null, now }), winner);
    else hideUtterance();
  } else {
    hideUtterance();
  }

  renderLabels(budget.labels > 0 ? labelledMarks(day.marks, { now, limit: budget.labels }) : []);
}

// ── DOM build (once) ──────────────────────────────────────────

function build() {
  root = document.createElement("div");
  root.id = "temporal-spine";
  root.className = "temporal-spine";

  canvas = document.createElement("canvas");
  canvas.className = "temporal-spine__canvas";
  ctx = canvas.getContext("2d", { alpha: true });

  breathEl = document.createElement("div");
  breathEl.className = "spine-breath";

  connectorEl = document.createElement("div");
  connectorEl.className = "spine-connector";

  utterEl = document.createElement("div");
  utterEl.className = "spine-utterance";
  utterEyebrowEl = document.createElement("div");
  utterEyebrowEl.className = "spine-utterance__eyebrow";
  utterTextEl = document.createElement("div");
  utterTextEl.className = "spine-utterance__text";
  utterEl.append(utterEyebrowEl, utterTextEl);

  const labelsWrap = document.createElement("div");
  labelsWrap.className = "spine-labels";
  labelEls = Array.from({ length: 3 }, () => {
    const el = document.createElement("div");
    el.className = "spine-label";
    const time = document.createElement("span");
    time.className = "spine-label__time";
    const text = document.createElement("span");
    text.className = "spine-label__text";
    el.append(time, text);
    labelsWrap.append(el);
    return el;
  });

  root.append(canvas, breathEl, connectorEl, utterEl, labelsWrap);
  document.body.append(root);
}

/**
 * The temporal spine. Flag-off returns before touching anything: no DOM, no
 * timer, no body class, no hook — byte-identical to the shipped hero surface.
 */
export function initTemporalSpine({ enabled: on_ = false } = {}) {
  if (on_ !== true) return;
  enabled = true;
  document.body.classList.add("temporal-spine-on");
  build();

  initDaySources();
  on("calendar:refreshed", update);
  on("presence:changed", update);
  on("bins:updated", update);

  resizeHandler = () => update();
  window.addEventListener("resize", resizeHandler);

  update();
  tickTimer = setInterval(update, TICK_MS);

  // Pi verification hooks (the __attention / __forceAtmoEpisode pattern).
  window.__spine = () => ({
    enabled,
    slots: MAX_SLOTS,
    strataRows: STRATA_ROWS,
    mode: getMode(),
    alive: document.body.classList.contains("spine-alive"),
    dim: clockDim(),
    marks: (lastDay?.marks ?? []).map((m) => ({
      id: m.id, hour: +m.hour.toFixed(2), weight: +m.weight.toFixed(2),
      warm: m.warm, spent: m.spent, kind: m.kind, label: m.label
    })),
    nowHour: lastDay?.nowHour ?? null,
    strata: lastDay?.strata ?? [],
    utterance: utterEl?.classList.contains("is-visible") ? utterTextEl.textContent : null,
    labels: labelEls.filter((el) => el.classList.contains("is-visible"))
      .map((el) => el.querySelector(".spine-label__text").textContent)
  });

  // Light a stratum from the outside — how a surfacing memory brightens its
  // year-line. Pass null to clear.
  window.__spineStratum = (year, at = null) => {
    forcedStrata = year == null ? [] : [{ year: Number(year), at: at ?? Date.now() }];
    update();
    return forcedStrata;
  };
}

/** Full symmetric teardown — the 24/7 discipline's escape hatch and the tests' seam. */
export function stopTemporalSpine() {
  clearInterval(tickTimer);
  clearTimeout(labelClearTimer);
  tickTimer = null;
  labelClearTimer = null;
  if (resizeHandler) window.removeEventListener("resize", resizeHandler);
  resizeHandler = null;
  root?.remove();
  document.body.classList.remove("temporal-spine-on", "spine-alive");
  root = null;
  canvas = null;
  ctx = null;
  breathEl = null;
  utterEl = null;
  utterEyebrowEl = null;
  utterTextEl = null;
  connectorEl = null;
  labelEls = [];
  lastDay = null;
  forcedStrata = [];
  resetDaySources();
  enabled = false;
}
