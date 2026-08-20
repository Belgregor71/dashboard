/* ═══════════════════════════════════════════════════════════════════════════
   THE AMBIENT ARCHIVE — depth 0, rebuilt on V3.

   Depth 0 stops being "a photograph with the hour on it" and becomes the
   archive: the memory as a lit card on a tilted plane, two large desaturated
   ghosts of itself bleeding off opposite edges, the year engraved behind the
   plate, and one strip across the top carrying THE YEARS THIS DATE EXISTS IN
   with the card's own year lit.

   ── What this module does NOT own ──────────────────────────────────────────

   Which photograph is up. That is `core/ground.js` — the pool, the shuffled
   walk, the one-shot latch, the sixty-second dissolve and the veto all stay
   exactly where they were. This module subscribes to the same `onPhoto` seam
   the scrim subscribes to and RE-PRESENTS what arrived. It has no fetch, no
   pool and no opinion about ordering.

   ⚠ It also owns none of ground's <img> elements. Its card holds copies —
   same URL, so the browser cache serves them and the cost is one extra decode,
   not one extra request. Adding elements to `.photo` would corrupt
   `__ground().layers`, which is the soak leak metric and must read 1 at rest.

   ── The composition ────────────────────────────────────────────────────────

   Fixed 1920×1080 at DPR 1, like the rest of V3. Geometry inherited from
   docs/design/AMBIENT-ARCHIVE.md, with two deliberate departures the owner
   asked for on 2026-08-18 after re-reading the reference frames:

   1. TWO large ghosts, not ~30 tile repeats. The shipped echo was a 2900×1800
      plane tiled at 620×349; the reference has one big enlargement bleeding off
      the bottom-right and a partial at the other edge. "The background tiles
      were too many."
   2. THE YEAR STRIP IS BACK, and bold. See the note on it below — it is the
      third year rail built for this surface and the first two were rejected.

   ── Why this year rail is not the two that were rejected ───────────────────

   Build 1 drew the years as six rows receding in Z; build 2 drew them as a
   legible shelf on a far plane. Both died for the same two reasons: they
   restated a year the wall already gave twice, and they took vertical room from
   the photograph (build 1 cut the card to 53% of its area).

   This one states something new — WHICH YEARS THIS CALENDAR DATE LIVES IN,
   with the one on the card lit. "This date exists in 2011, 2015, 2018, 2021 and
   2023; you are looking at 2018" is not a third telling of the engraved
   numeral. And it takes the band above the card, which at depth 0 is empty, so
   the card keeps its full 1040×609 box.
   ═══════════════════════════════════════════════════════════════════════════ */

import { cardRectFor } from "../../js/services/archiveModel.js";
import { relativeYearPhrase } from "../../js/services/photoMemory.js";
import { frameParts, poolYears } from "./ground.js";

/* ⚠ Read the flag PER CALL, never at module load. ES imports hoist above the
   point where /js/config.js assigns window.CONFIG, so a module-level read is
   frozen to `undefined` and the flag silently reads false forever. This repo
   has paid for that three times (core/display.js says which). */
const enabled = () => Boolean(globalThis.window?.CONFIG?.features?.v3Archive);

/* ── The stage ──────────────────────────────────────────────────────────── */
const FRAME_W = 1920;

/* The strip's own canvas. It bleeds 120px past both frame edges so the ruling
   runs off the glass rather than stopping at a margin — an instrument scale
   that ends where the screen ends reads as a decoration of the screen. */
const STRIP_W = 2160;
/* ⚠ THE CANVAS IS CUT TO ITS CONTENT, not rounded up to a comfortable number.
   An element taller than its painted marks is invisible and still has a
   bounding box, so a generous canvas silently overlapped the card plane — the
   pixels cleared it and the geometry did not. The lowest thing drawn is the lit
   label's descender at ~y 130. */
/* ⚠⚠ EVERY NUMBER HERE IS MEASURED AGAINST THE PROJECTION, NOT THE CSS BOX,
   and the two are not close. The strip sits on the deck plane under a 1400px
   perspective far above the perspective origin, which STRETCHES it vertically
   by about 1.7x and lifts its centre ~15px: a 120px canvas at top 36 paints
   from y -23 to y 183. Reading the stylesheet and reasoning about where the
   marks land gives an answer that is wrong by ~60px at the top edge.

   The band the strip has to fit inside runs from the top of the glass to the
   CARD's own projected top, which is ~196 for the tallest card the fit allows
   (609px, a portrait). These four numbers are the ones that put every painted
   mark inside it, and tests/v3-archive.spec.js measures the painted boxes so a
   later tweak cannot quietly push the strip through the card. */
const STRIP_H = 100;
const STRIP_LEFT = -120;
const STRIP_TOP = 60;

/* Canvas space. The labels hang BELOW the line and the registration marks rise
   ABOVE it, exactly as the reference frames draw them. */
const LINE_Y = 34;
const TICK_H = 9;
const TICK_PITCH = 21;      // the reference's own ruling pitch
const MARK_H = 22;          // the red registration mark at a labelled year
const LABEL_Y = 76;
const LIT_Y = 84;

/* THE AXIS. ⚠⚠ MEASURED AGAINST THE PROJECTION, like every other number in this
   block — and the shipped values were NOT, which is the defect these replace.
   They were derived as `MARGIN - STRIP_LEFT`, i.e. as though canvas x mapped to
   frame x with a flat -120px bleed offset. It does not. The deck plane is
   projected under the scene's 1400px perspective, which COMPRESSES ITS MIDDLE
   and flares its ends. Probed on the wall at 1920x1080 (a 1px marker inside a
   div carrying the strip's own box and transform), canvas x -> frame x:

     0 ->   57      70 ->  108     228 ->  226     320 ->  298
   600 ->  526    1080 ->  962    1560 -> 1465    1689 -> 1614
  1849 -> 1808    1932 -> 1912    2040 -> 2053    2160 -> 2215

   Note 1080 -> 962: the middle is pulled ~118px LEFT, so no offset, however
   carefully chosen, describes this mapping. Only measurement does.

   The shipped axis therefore ran to frame 1912 — EIGHT PIXELS from the right
   edge of the glass. The newest year in a pool is always the axis maximum, so
   any memory from the most recent year had its 48px lit label painted half off
   the screen. That is what "the 2023 highlight at the extreme right didn't look
   correct" was: not a scaling choice, a clipped label.

   ⚠ AND THE ENDS CARRY HEADROOM, which is a design call on top of the fix.
   Frame 108/1812 are the safe margins every other V3 surface uses (canvas 70
   and 1849), but a year sitting exactly on the margin still reads as the ruler
   ENDING there, and the outermost years are the two the eye lands on. These put
   them at frame 298 and 1614, leaving ~250px of ruled line running past each
   one and off the glass — so the spine reads as a longer instrument seen
   through a window, which is what it is. The RULING is unchanged: still painted
   edge to edge across the whole canvas, still bleeding past both frame edges. */
const AXIS_X0 = 320;
const AXIS_SPAN = 1369;

/* --t-rail is V3's legibility FLOOR (32px at 3-4m), and the year labels are
   text a person is meant to read. The shipped rail set them at 22px mono,
   which is a large part of why it "got lost on the screen". */
const LABEL_PX = 32;
const LIT_PX = 48;

/* Two halves at most — a diptych frame. Slots are allocated once at build and
   never grow; `blank` halves are hidden rather than removed. */
const SLOTS = 2;
const HALVES = 2;

/* The outgoing slot is dropped this long after the settle, by a TIMER — never
   by transitionend, which does not fire while the element or an ancestor is
   display:none, and this whole layer is display:none under reduced motion and
   invisible at every depth above 0. */
const CLEANUP_BUFFER_MS = 2000;
const DEFAULT_EXCHANGE_MS = 1200;

let root = null;
let built = false;
let slot = 0;               // which card slot is on top
let ghostSlot = 0;
let exchangeTimer = null;
let stripCanvas = null;
let cardPlane = null;
let cardEl = null;
let cardImgs = [];          // [slot][half]
let ghostSkins = [];        // [ghost][slot]
let plateEl = null;
let plateRows = null;
let yearEl = null;
let litYear = "";
let lastYears = [];
let lastRect = null;
let lastSrcKey = "";

/* ── The one number to turn ─────────────────────────────────────────────────
   Amplitude, not period. DESIGN_SYSTEM §5.2: a slow effect that still travels
   far is what wakes someone up, so night scales how FAR things drift and never
   how often. The night half is CSS (`:root[data-night="1"]` lowers --arch-day);
   this is the daylight multiplier, and it exists as a real writer rather than
   as a bare calc() fallback because the shipped one never had one and "the one
   number to turn" turned out to be unturnable on the wall. */
let gain = 2;
/* Mirrors --arch-ghost so the lever reports the live value rather than a stale one. */
let ghost = 0.22;

/* ── The plate ──────────────────────────────────────────────────────────────
   RELOCATED LANGUAGE, NEVER NEW LANGUAGE. Everything on it is already what
   #ground-caption would have said about this frame; the archive takes the
   caption's job while it is up, which is why the caption hides (law 3 — the
   same fact told twice is furniture).

   ⚠ THE PLATE ALWAYS SPEAKS when there is a year. Most of this library has no
   GPS and nobody named, so a place-only title left the plate absent on most
   days — the 2026-08-02 finding, re-learned here rather than re-derived. With
   no place it says the year in words instead.

   No year at all → null, and null means no plate: silence is the default. */
export function plateForFrame(assets, now = new Date()) {
  const { people, place, year } = frameParts(assets);
  if (!year) return null;
  const title = place || relativeYearPhrase(Number(year), now);
  if (!title) return null;
  return { year, title, who: people || null };
}

/* ── The strip ──────────────────────────────────────────────────────────────
   Years are placed by VALUE, not by index: a library that jumps 2011 → 2018 →
   2019 → 2023 should show that gap, because the gap is true of the date. Index
   spacing would draw an even comb and quietly claim a year for every slot. */
export function yearPositions(years, litValue) {
  const list = [...new Set((years ?? []).map((y) => Number(y)))]
    .filter((y) => Number.isFinite(y) && y > 0)
    .sort((a, b) => a - b);
  if (!list.length) return [];

  const lo = list[0];
  const hi = list[list.length - 1];
  const span = hi - lo;
  return list.map((y) => ({
    year: String(y),
    // One year alone centres rather than pinning to the left margin, which
    // would read as the start of a scale that has no end.
    x: span === 0 ? AXIS_X0 + AXIS_SPAN / 2 : AXIS_X0 + ((y - lo) / span) * AXIS_SPAN,
    lit: String(y) === String(litValue)
  }));
}

function ink(alpha) {
  return `oklch(0.93 0.010 85 / ${alpha})`;
}

function drawStrip() {
  if (!stripCanvas) return;
  const ctx = stripCanvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, STRIP_W, STRIP_H);

  const marks = yearPositions(lastYears, litYear);

  // 1 — the base line, edge to edge.
  ctx.fillStyle = ink(0.22);
  ctx.fillRect(0, LINE_Y, STRIP_W, 1);

  // 2 — the minute ruling. Hairlines at the reference's 21px pitch; at DPR 1 on
  //     a 69 PPI panel nothing thinner than one device pixel survives.
  ctx.fillStyle = ink(0.14);
  for (let x = 0; x < STRIP_W; x += TICK_PITCH) ctx.fillRect(x, LINE_Y + 1, 1, TICK_H);

  // 3 — a red registration mark at every year the date actually reaches. This
  //     is the film-registration red of the reference frames and it is NOT
  //     --error: reusing a semantic colour as decoration is how a palette stops
  //     meaning anything.
  for (const m of marks) {
    ctx.fillStyle = m.lit ? "oklch(0.66 0.21 27)" : "oklch(0.52 0.17 27 / 0.8)";
    ctx.fillRect(Math.round(m.x), LINE_Y - MARK_H + 1, m.lit ? 3 : 2, MARK_H);
  }

  // 4 — the labels. Tabular figures, because a scale whose digits shift width
  //     stops reading as a scale.
  for (const m of marks) {
    const px = m.lit ? LIT_PX : LABEL_PX;
    ctx.font = `${m.lit ? 500 : 300} ${px}px "Roboto Flex", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (m.lit) {
      ctx.fillStyle = "oklch(0.82 0.13 68)";
      ctx.shadowColor = "oklch(0.82 0.13 68 / 0.55)";
      ctx.shadowBlur = 18;
    } else {
      ctx.fillStyle = ink(0.42);
      ctx.shadowBlur = 0;
    }
    ctx.fillText(m.year, m.x, m.lit ? LIT_Y : LABEL_Y);
    ctx.shadowBlur = 0;
  }
}

/* ── Build, once ────────────────────────────────────────────────────────────
   Every node this surface will ever have is created here. Nothing is allocated
   per photograph, per depth change or per day — the 24/7 rule is that a page
   which runs for weeks may not grow, and the cheapest way to guarantee that is
   to have no per-event construction at all. */
function build(host) {
  const scene = document.createElement("div");
  scene.className = "archive__scene";

  ghostSkins = [];
  const ghosts = ["a", "b"].map((which) => {
    const wrap = document.createElement("div");
    wrap.className = "archive__ghost";
    wrap.dataset.ghost = which;
    // ⚠ THE FILTER IS ON THE INNER ELEMENT AND THE DRIFT IS ON THE WRAPPER.
    // A grayscale+brightness+contrast stack on the same node that a keyframe
    // transforms is re-filtered every composited frame; split, the crushed
    // texture is produced once and only its position moves.
    const skins = [0, 1].map((i) => {
      const skin = document.createElement("div");
      skin.className = "archive__ghost-skin";
      skin.dataset.slot = String(i);
      if (i === 0) skin.classList.add("is-shown");
      wrap.append(skin);
      return skin;
    });
    ghostSkins.push(skins);
    return wrap;
  });

  stripCanvas = document.createElement("canvas");
  stripCanvas.className = "archive__strip";
  stripCanvas.width = STRIP_W;
  stripCanvas.height = STRIP_H;

  // The engraved year. aria-hidden and never a measured selector: at 5% ink it
  // is a texture, not text, and the contrast sweep would (correctly) fail it if
  // it were ever asked to read it.
  yearEl = document.createElement("div");
  yearEl.className = "archive__year";
  yearEl.setAttribute("aria-hidden", "true");

  cardPlane = document.createElement("div");
  cardPlane.className = "archive__card-plane";
  const cardWrap = document.createElement("div");
  cardWrap.className = "archive__card-wrap";
  const card = document.createElement("div");
  card.className = "archive__card";
  card.dataset.halves = "1";
  cardEl = card;

  cardImgs = [];
  for (let s = 0; s < SLOTS; s++) {
    const halves = [];
    for (let h = 0; h < HALVES; h++) {
      const img = document.createElement("img");
      img.className = "archive__img";
      img.alt = "";
      img.decoding = "async";
      img.dataset.slot = String(s);
      img.dataset.half = String(h);
      img.dataset.blank = "1";
      card.append(img);
      halves.push(img);
    }
    cardImgs.push(halves);
  }
  const lip = document.createElement("div");
  lip.className = "archive__lip";
  card.append(lip);
  cardWrap.append(card);
  cardPlane.append(cardWrap);

  scene.append(...ghosts, stripCanvas, yearEl, cardPlane);

  const vig = document.createElement("div");
  vig.className = "archive__vig";

  const word = document.createElement("div");
  word.className = "archive__word";
  word.setAttribute("aria-hidden", "true");
  word.textContent = "Archive";

  plateEl = document.createElement("div");
  plateEl.className = "archive__plate";
  plateRows = {
    eyebrow: document.createElement("p"),
    title: document.createElement("p"),
    who: document.createElement("p")
  };
  plateRows.eyebrow.className = "archive__eyebrow measured";
  plateRows.title.className = "archive__title said";
  plateRows.who.className = "archive__who measured";
  plateEl.append(plateRows.eyebrow, plateRows.title, plateRows.who);

  const grain = document.createElement("div");
  grain.className = "archive__grain";

  host.append(scene, vig, word, plateEl, grain);
  root = document.documentElement;
  built = true;
}

/* ── A memory arrives ───────────────────────────────────────────────────── */

/** The frame's combined aspect: two portraits side by side make one wide card.
 *  ⚠ FROM THE DECODED RENDITION, NEVER FROM EXIF. Immich's exifImageWidth is
 *  pre-rotation, so an EXIF-derived fit puts every portrait iPhone photograph
 *  in a landscape card — a worse crop than the one the fit exists to remove. */
function frameAspect(imgs) {
  let total = 0;
  for (const img of imgs) {
    const w = img?.naturalWidth ?? 0;
    const h = img?.naturalHeight ?? 0;
    if (!(w > 0 && h > 0)) return null;
    total += w / h;
  }
  return total > 0 ? total : null;
}

function applyRect(rect) {
  if (!rect || !cardPlane) return;
  lastRect = rect;
  // Written INSTANTLY, never transitioned. width/height/top are layout
  // properties and DESIGN_SYSTEM §5.5 forbids animating them; the reshape rides
  // the exchange that is already happening, so it reads as the memory arriving.
  cardPlane.style.setProperty("--arch-card-w", `${rect.w}px`);
  cardPlane.style.setProperty("--arch-card-h", `${rect.h}px`);
  cardPlane.style.setProperty("--arch-card-top", `${rect.top}px`);
}

function paintPlate(assets) {
  if (!plateEl) return;
  const plate = plateForFrame(assets);
  if (!plate) {
    plateEl.dataset.blank = "1";
    plateRows.eyebrow.textContent = "";
    plateRows.title.textContent = "";
    plateRows.who.textContent = "";
    return;
  }
  plateEl.dataset.blank = "0";
  plateRows.eyebrow.textContent = `On this day · ${plate.year}`;
  plateRows.title.textContent = plate.title;
  plateRows.who.textContent = plate.who ?? "";
  plateRows.who.dataset.blank = plate.who ? "0" : "1";
}

/**
 * The photograph on the glass changed. Re-present it.
 *
 * @param {HTMLImageElement|HTMLImageElement[]} frame ground.js's own element(s)
 * @param {{transitioning:boolean, assets?:object[]}} meta
 */
export function archivePhoto(frame, meta = {}) {
  if (!built || !enabled()) return;
  const imgs = (Array.isArray(frame) ? frame : [frame]).filter(Boolean);
  if (!imgs.length) return;

  const srcs = imgs.map((i) => i.currentSrc || i.src).filter(Boolean);
  if (!srcs.length) return;

  /* ⚠ ground.js fires onPhoto TWICE per exchange — once when the incoming frame
     settles and again when the outgoing one has been removed. The second call
     names the same photograph, and cross-fading the card into itself would put
     a 60s opacity ramp on the glass for no cause at all. */
  const key = srcs.join("|");
  if (key === lastSrcKey) {
    paintPlate(meta.assets);
    return;
  }
  lastSrcKey = key;

  /* Exchange over the SAME settle ground.js is using, so a veto stays brisk and
     the ambient rotation stays slow. The first frame has nothing to settle from
     and falls back to V3's own --settle. */
  if (Number.isFinite(meta.settleMs) && meta.settleMs >= 0) {
    root?.style.setProperty("--arch-exchange", `${meta.settleMs}ms`);
  }

  const next = slot ^ 1;
  const halves = cardImgs[next];
  halves.forEach((img, i) => {
    if (i < srcs.length) {
      img.src = srcs[i];
      img.dataset.blank = "0";
    } else {
      // Cleared, not removed: fixed allocation is what keeps a page that runs
      // for weeks from growing, and a stale src on a hidden slot pins a decoded
      // bitmap for nothing.
      img.removeAttribute("src");
      img.dataset.blank = "1";
    }
  });
  cardEl?.setAttribute("data-halves", String(srcs.length));

  /* ⚠ THE OUTGOING SLOT KEEPS `is-shown` AND ONLY LOSES `is-top`. The incoming
     one fades in ON TOP of a still-opaque photograph; fading both at once
     leaves the pair at ~50% each in the middle and the card's own backing shows
     through, so every exchange dips dark halfway. It is the same rule
     ground.js's dissolve is built on, one plane forward. */
  cardImgs[slot].forEach((img) => img.classList.remove("is-top"));
  halves.forEach((img) => img.classList.add("is-shown", "is-top"));
  slot = next;

  const nextGhost = ghostSlot ^ 1;
  for (const skins of ghostSkins) {
    skins[nextGhost].style.backgroundImage = `url("${srcs[0].replace(/"/g, "%22")}")`;
    skins[nextGhost].classList.add("is-shown", "is-top");
    skins[ghostSlot].classList.remove("is-top");
  }
  ghostSlot = nextGhost;

  /* Once the incoming layer is fully opaque the outgoing one is covered and
     costs a composite for nobody, so it stands down. ONE timer, cleared before
     it is re-armed — a per-exchange timer that accumulated would be exactly the
     leak class this house has paid for twice. */
  const settleMs = Number.isFinite(meta.settleMs) ? meta.settleMs : DEFAULT_EXCHANGE_MS;
  clearTimeout(exchangeTimer);
  exchangeTimer = setTimeout(() => {
    cardImgs[slot ^ 1].forEach((img) => img.classList.remove("is-shown"));
    for (const skins of ghostSkins) skins[ghostSlot ^ 1].classList.remove("is-shown");
  }, settleMs + CLEANUP_BUFFER_MS);

  const rect = cardRectFor(frameAspect(imgs));
  if (rect) applyRect(rect);
  // A rendition that has not decoded yet reports 0×0. Re-measure on its load
  // rather than leaving the card on the previous memory's shape — and re-check
  // the key first, because on a cold NAS the rotation can outrun a fetch and
  // reshaping around a photograph nobody is looking at is a move with no cause.
  imgs.forEach((img) => {
    if (img.complete) return;
    img.addEventListener("load", () => {
      if (lastSrcKey !== key) return;
      const late = cardRectFor(frameAspect(imgs));
      if (late) applyRect(late);
    }, { once: true });
  });

  const { year } = frameParts(meta.assets);
  litYear = year || "";
  if (yearEl) yearEl.textContent = litYear;
  lastYears = poolYears();
  drawStrip();
  paintPlate(meta.assets);
}

/**
 * @param {HTMLElement|null} host the #archive node from index.html
 *
 * Flag-off returns before touching anything: no children, no attribute, no
 * hook. That is the rollback, and it is the same state every depth above 0
 * already renders, so production exercises it continuously.
 */
export function initArchive(host) {
  if (!host || !enabled()) return false;
  if (!built) build(host);

  // The marker the stylesheet hangs everything off. On the root rather than the
  // host so a rule can combine it with data-depth / data-night / data-phase,
  // which all live there too.
  document.documentElement.dataset.archive = "1";
  document.documentElement.style.setProperty("--arch-gain", String(gain));

  lastYears = poolYears();
  drawStrip();

  window.__archive = () => ({
    enabled: enabled(),
    built,
    gain,
    lit: litYear || null,
    years: lastYears.slice(),
    // The PAINTED rectangle, not what applyRect asked for — "is it actually
    // fitting" should be a read, not a squint.
    card: cardPlane
      ? (() => {
          const cs = getComputedStyle(cardPlane);
          return {
            w: parseFloat(cs.width),
            h: parseFloat(cs.height),
            left: parseFloat(cs.left),
            top: parseFloat(cs.top),
            wanted: lastRect
          };
        })()
      : null,
    ghosts: host.querySelectorAll(".archive__ghost").length,
    slots: host.querySelectorAll(".archive__img").length,
    shown: host.querySelectorAll(".archive__img.is-shown:not([data-blank='1'])").length,
    plate: plateEl?.dataset.blank === "0"
      ? {
          eyebrow: plateRows.eyebrow.textContent,
          title: plateRows.title.textContent,
          who: plateRows.who.textContent || null
        }
      : null,
    nodes: host.querySelectorAll("*").length,
    /* ⚠ A SNAPSHOT, and it moves with the clock now: arch-kenburns is a settle,
       so this reads five while a photograph is coming to rest and four once it
       has. A spec asserting it must pin its sample point. */
    anims: document.getAnimations().filter((a) => a.playState === "running").length,
    /* The number that does NOT move — the animations that never end on their
       own. Four at depth 0 in daylight, three after dark. This is the one to
       assert against, and the one a soak should watch: a fifth forever-loop
       appearing here is the regression that put depth 0 over budget once. */
    loops: document.getAnimations().filter(
      (a) => a.playState === "running" && a.effect?.getComputedTiming().iterations === Infinity
    ).length
  });

  /* The amplitude lever, turnable on the kiosk over CDP without a deploy. The
     shipped archive's --arch-gain existed only as a fallback inside a calc()
     with nothing setting it, so "the one number to turn" could not be turned. */
  window.__archiveGain = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return gain;
    gain = v;
    document.documentElement.style.setProperty("--arch-gain", String(gain));
    return gain;
  };

  /* The ghost lever, same reason and same shape as the gain above: how visible
     an echo should be is judged in front of the wall, not in a stylesheet, and
     the inherited 0.17 was tuned for thirty small tiles rather than two large
     shapes. Bounded at 0.6 — past that the crush stops being a crush and the
     plate's own contrast starts depending on the photograph behind it, which is
     the one thing this filter exists to prevent. */
  window.__archiveGhost = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0 || v > 0.6) return ghost;
    ghost = v;
    document.documentElement.style.setProperty("--arch-ghost", String(ghost));
    return ghost;
  };

  return true;
}
