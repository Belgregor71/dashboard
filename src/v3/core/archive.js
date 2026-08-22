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
import { CHECK_MS as GROUND_ROTATE_MS, frameParts, poolYears } from "./ground.js";

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

/* ⚠⚠ ONE PHOTOGRAPH PER SLOT — the card is never a diptych. Owner's call,
   2026-08-22. `ground.js` still pairs portraits behind `groundDiptych` and the
   full-bleed wall at depths 1-3 is UNTOUCHED, but the card is the subject of
   this composition rather than a wall to fill: two prints inside one frame,
   each already scaled to 457px, is a collage of a collage.

   A pair is not skipped, it is UNFOLDED — half one, then half two, as two
   ordinary card exchanges (see HALF_HOLD_MS). Showing only the first would
   quietly cost depth 0 half of every portrait in the library, on the surface
   that is up ~95% of the time.

   Two slots, allocated once at build and never grown, so an exchange has
   something to cross-fade from; `blank` is the state before the first arrival. */
const SLOTS = 2;

/* HOW LONG THE FIRST HALF OF A PAIR HOLDS THE CARD. Derived from ground's own
   rotation and never chosen: with memories on the tick IS the rotation, so a
   pair splits one frame's turn evenly and a later change to the rotation
   carries here rather than desynchronising from it.

   ⚠ IT FIRES ONCE PER FRAME AND DOES NOT LOOP. The next tick brings a new
   memory long before the card could want the first half back, and a pair
   cycling 0,1,0,1 forever would be movement with no cause the room can see —
   which is the whole subject of the calm law. A single photograph never arms
   it at all. */
const HALF_HOLD_MS = Math.round(GROUND_ROTATE_MS / 2);

/* The outgoing slot is dropped this long after the settle, by a TIMER — never
   by transitionend, which does not fire while the element or an ancestor is
   display:none, and this whole layer is display:none under reduced motion and
   invisible at every depth above 0. */
const CLEANUP_BUFFER_MS = 2000;
const DEFAULT_EXCHANGE_MS = 1200;

/* ⚠⚠ THE CARD IS NOT THE WALLPAPER, AND ground.js's SETTLE IS THE WALLPAPER'S.
   `ground.js` hands its own `DISSOLVE_MS` down through `meta.settleMs` and it is
   SIXTY SECONDS — the right number for a full-bleed photograph, which should
   change without anyone noticing. On the CARD it is the opposite number: the
   card is the subject of the composition, so the same ramp leaves an incoming
   photograph semi-transparent over an opaque one for most of a minute.

   Measured on the wall 2026-08-22 before this clamp: the incoming slot read
   0.60 → 1.00 over 27.5s with THREE slots opaque the whole way. That is what
   "a really clunky slow transition" was — not a jerk, a half-minute double
   exposure.

   2600ms is the incumbent's verified number (`src/css/views/ambient-archive.css`
   `transition: opacity 2.6s ease`), and `AMBIENT-ARCHIVE.md` names the exchange
   as the ONE thing on this surface a person is meant to catch — everything else
   is deliberately too slow to see.

   ⚠ A CEILING, NEVER A FIXED VALUE. A veto settles briskly because someone just
   spoke, and that briskness is real information; clamping keeps it while capping
   the ambient rotation. Raising this past ~3s starts rebuilding the smear. */
const CARD_EXCHANGE_MAX_MS = 2600;

/* The beat of blur that makes the exchange an EVENT WITH AN END rather than a
   slow smear — and the thing the instant reshape in `applyRect()` hides behind
   (`AMBIENT-ARCHIVE.md`: "the shape change rides the exchange's existing 300ms
   blur"). It was in the surface this replaced and was simply never ported, which
   is why the rebuilt exchange had nothing marking it at all. */
const EXCHANGE_BLUR_MS = 300;

/* WHEN THE WORDS CHANGE, as a fraction of the crossfade rather than a constant.
   The plate names ONE photograph, and for the length of an exchange there are
   two on the glass — so there is no instant at which the old words and the new
   words are both honest, and the only question is which lie is shorter. Swapping
   at 92% puts the change where the incoming photograph has visually won but the
   card has not finished settling, which is the same place the incumbent put it
   (`EXCHANGE_SWAP_MS` 2400 against a 2.6s crossfade).

   ⚠ A RATIO AND NOT A NUMBER, because `settleMs` is not one. A veto crossfades
   in ~1.2s and the ambient rotation in 2.6s; a fixed 2400ms would hold stale
   words on the glass for twice the length of the exchange that replaced them.
   Floored at the blur so the plate has actually gone before its text changes —
   swapping words while they are still readable is the pop this exists to
   remove. */
const PLATE_SWAP_RATIO = 0.92;

let root = null;
let built = false;
let slot = 0;               // which card slot is on top
let ghostSlot = 0;
let exchangeTimer = null;
let blurTimer = null;
let plateTimer = null;
let halfTimer = null;
let stripCanvas = null;
let cardPlane = null;
let cardEl = null;
let cardImgs = [];          // [slot] — ONE photograph each, never a diptych
let ghostSkins = [];        // [ghost][slot]
let plateEl = null;
let plateRows = null;
let yearEl = null;
let litYear = "";
let lastYears = [];
let lastRect = null;

/* THE FRAME GROUND LAST HANDED OVER — one photograph or a pair — and which of
   its photographs is on the card. Held rather than consumed, because a pair is
   presented across two exchanges minutes apart and the second one has to be
   able to find its own asset, its own aspect and its own words. */
let heldFrame = null;       // { key, imgs, srcs, assets, settleMs }
let heldIndex = 0;

/* ⚠ THE STALENESS TOKEN, and it counts PRESENTATIONS, not frames. It replaces a
   comparison against the frame's src key, which was correct while one frame was
   one exchange and is not any more: both halves of a pair carry the same key, so
   a key check cannot tell the first half's pending plate swap from the second
   half's — and would let half one's words paint over half two's card. */
let presentSeq = 0;

/* ── The one number to turn ─────────────────────────────────────────────────
   Amplitude, not period. DESIGN_SYSTEM §5.2: a slow effect that still travels
   far is what wakes someone up, so night scales how FAR things drift and never
   how often. The night half is CSS (`:root[data-night="1"]` lowers --arch-day);
   this is the daylight multiplier, and it exists as a real writer rather than
   as a bare calc() fallback because the shipped one never had one and "the one
   number to turn" turned out to be unturnable on the wall.

   ⚠⚠ 4 IS THE OWNER'S CALL, TAKEN LIVE ON THE WALL 2026-08-22, and it replaces the
   2026-08-02 call of 2. The reason 2 was wrong is measurable rather than a matter
   of taste: at gain 2 in daylight ghost a drifts 0.43-0.8 px/s and the card's
   painted width changes ~2px in 20s, which is below what anyone can see. That was
   defensible while the exchange carried the surface's visible motion — and for
   two days it did not, because the exchange had no blur and ran for a minute.
   Turned live via `__archiveGain(4)` and measured over 20s: ghost a 2.81 px/s,
   ghost b 2.57, the year 1.74, the card +7.64px. Perceptible, which is the whole
   requirement.

   ⚠ IT IS NOT FREE, AND THE COST IS ALL IN ONE PLACE. Settled is unchanged (21.3
   against gain 2's 21.5) because amplitude moves already-composited layers further
   without changing what must be rasterised. But `arch-kenburns` scales the card
   texture by `1 + 0.075 * amp`, so gain 4 makes it 1.294 rather than 1.15, and the
   mid-move peak went 28.4 -> 31.6 against §5.4's 35. That is legal with 3.4 of
   headroom where gain 2 had 6.6. This is the same animation that cost 6.3 points
   and forced the settle, so ANY future raise of this number must re-measure the
   mid-move row and not merely the settled one. Pressure stayed 0.00 throughout.

   ⚠ The CSS fallback in archive.css must move WITH this. It is what applies in the
   frames before initArchive() writes the var, and a mismatch is a visible amplitude
   step at boot. */
let gain = 4;
/* Mirrors --arch-ghost so the lever reports the live value rather than a stale one. */
let ghost = 0.22;

/* How long half one of a pair holds the card, live. Same shape and same reason
   as the two levers above: "long enough to look at, short enough that its
   partner still gets a turn" is judged in front of the wall, not in a constant.
   Seeded from HALF_HOLD_MS, which is where the reasoning lives. */
let halfHold = HALF_HOLD_MS;

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
  cardEl = card;

  cardImgs = [];
  for (let s = 0; s < SLOTS; s++) {
    const img = document.createElement("img");
    img.className = "archive__img";
    img.alt = "";
    img.decoding = "async";
    img.dataset.slot = String(s);
    img.dataset.blank = "1";
    card.append(img);
    cardImgs.push(img);
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

/** The aspect of the ONE photograph on the card — a portrait gets a portrait
 *  card, 457x609, and never half of a 914-wide one.
 *  ⚠ FROM THE DECODED RENDITION, NEVER FROM EXIF. Immich's exifImageWidth is
 *  pre-rotation, so an EXIF-derived fit puts every portrait iPhone photograph
 *  in a landscape card — a worse crop than the one the fit exists to remove. */
function imgAspect(img) {
  const w = img?.naturalWidth ?? 0;
  const h = img?.naturalHeight ?? 0;
  return w > 0 && h > 0 ? w / h : null;
}

/** The one asset the card is naming, as the single-element list every reader
 *  here already takes.
 *
 *  ⚠ THE PLATE NAMES ONE PHOTOGRAPH, and now the card holds one — so each half
 *  of a pair gets its own words and its own lit year. `plateForFrame`'s
 *  earliest-year-wins rule is what a SHARED caption needed and there is no
 *  longer a shared caption; handing it the whole pair here would caption half
 *  two with half one's year for as long as half two is up.
 *
 *  ⚠ `assets` is index-aligned with `imgs` by construction — ground.js sets
 *  `el.src = thumbUrl(assets[i].id)` off the same index — but a frame that
 *  arrived without them falls back to the whole list rather than to nothing. */
function assetsAt(index) {
  const list = heldFrame?.assets;
  if (!Array.isArray(list) || !list.length) return list;
  return list[index] ? [list[index]] : list;
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
 * Put ONE photograph of the held frame on the card.
 *
 * Every exchange this surface performs goes through here — a new memory from
 * ground.js, and the second half of a pair minutes later. They are deliberately
 * the same event: half two is not a special case of the layout, it is another
 * memory arriving, with its own blur, its own words and its own lit year.
 *
 * @param {number} index which photograph of the held frame
 */
function present(index) {
  const held = heldFrame;
  const src = held?.srcs?.[index];
  if (!src) return;

  heldIndex = index;
  const seq = ++presentSeq;
  const settleMs = held.settleMs;
  root?.style.setProperty("--arch-exchange", `${settleMs}ms`);

  const next = slot ^ 1;
  const img = cardImgs[next];
  img.src = src;
  img.dataset.blank = "0";

  /* ⚠ THE OUTGOING SLOT KEEPS `is-shown` AND ONLY LOSES `is-top`. The incoming
     one fades in ON TOP of a still-opaque photograph; fading both at once
     leaves the pair at ~50% each in the middle and the card's own backing shows
     through, so every exchange dips dark halfway. It is the same rule
     ground.js's dissolve is built on, one plane forward. */
  cardImgs[slot].classList.remove("is-top");
  img.classList.add("is-shown", "is-top");
  slot = next;

  const nextGhost = ghostSlot ^ 1;
  for (const skins of ghostSkins) {
    skins[nextGhost].style.backgroundImage = `url("${src.replace(/"/g, "%22")}")`;
    skins[nextGhost].classList.add("is-shown", "is-top");
    skins[ghostSlot].classList.remove("is-top");
  }
  ghostSlot = nextGhost;

  /* A beat of blur as one memory gives way to the next. Dropped by a TIMER 300ms
     later — never `transitionend`, which does not fire while the element or an
     ancestor is `display:none`, and this whole layer is `display:none` under
     reduced motion and invisible at every depth above 0 (CLAUDE.md). The
     stylesheet eases it back OUT over 2.8s, so the blur lands hard and clears
     slowly: the discontinuity is hidden, the recovery is not.

     ⚠ ONE timer, cleared before it is re-armed. A per-exchange timer that
     accumulated is the leak class this house has already paid for twice, and the
     exchange above is armed the same way for the same reason. */
  cardEl?.classList.add("is-exchanging");
  clearTimeout(blurTimer);
  blurTimer = setTimeout(() => {
    blurTimer = null;
    cardEl?.classList.remove("is-exchanging");
  }, EXCHANGE_BLUR_MS);

  /* Once the incoming layer is fully opaque the outgoing one is covered and
     costs a composite for nobody, so it stands down. ONE timer, cleared before
     it is re-armed — a per-exchange timer that accumulated would be exactly the
     leak class this house has paid for twice. */
  clearTimeout(exchangeTimer);
  exchangeTimer = setTimeout(() => {
    cardImgs[slot ^ 1].classList.remove("is-shown");
    for (const skins of ghostSkins) skins[ghostSlot ^ 1].classList.remove("is-shown");
  }, settleMs + CLEANUP_BUFFER_MS);

  const source = held.imgs[index];
  const rect = cardRectFor(imgAspect(source));
  if (rect) applyRect(rect);
  // A rendition that has not decoded yet reports 0×0. Re-measure on its load
  // rather than leaving the card on the previous memory's shape — and re-check
  // the token first, because on a cold NAS the rotation can outrun a fetch and
  // reshaping around a photograph nobody is looking at is a move with no cause.
  if (source && !source.complete) {
    source.addEventListener("load", () => {
      if (presentSeq !== seq) return;
      const late = cardRectFor(imgAspect(source));
      if (late) applyRect(late);
    }, { once: true });
  }

  /* ⚠⚠ THE WORDS RIDE THE EXCHANGE — THEY DO NOT LEAD IT. All four of these
     swapped INSTANTLY while the photograph took the whole crossfade to arrive,
     so the plate named the incoming memory over a card still showing the
     outgoing one. At the 60s settle this shipped with that was a caption
     contradicting the picture for most of a minute; at 2.6s it is a pop, which
     is smaller but is the same defect.

     The plate and the engraved year stand DOWN first (fast, with the blur),
     their text changes while they are invisible, and they return on the calm
     2.4s ease the stylesheet already gives them. Same asymmetry as the blur:
     the discontinuity is hidden, the recovery is not.

     ⚠ ONE timer, cleared before re-arm — and it must survive being superseded,
     because two exchanges inside one settle is a real state (a veto answered by
     another veto). The pending swap is dropped rather than allowed to paint a
     memory that has already gone. */
  plateEl?.classList.add("is-exchanging");
  yearEl?.classList.add("is-exchanging");
  const swapMs = Math.max(EXCHANGE_BLUR_MS, Math.round(settleMs * PLATE_SWAP_RATIO));
  clearTimeout(plateTimer);
  plateTimer = setTimeout(() => {
    plateTimer = null;
    /* ⚠ STILL THE CURRENT PRESENTATION? This fires a whole swap after it was
       armed, and ground.js's own late-hand-off trap is the same shape one plane
       down: a superseded exchange must not put its words back on the wall.
       Against the SEQUENCE, never against the frame's src key — both halves of
       a pair share that key, so a key check would let half one's words land on
       half two's card and call it current. */
    if (presentSeq !== seq) return;
    const assets = assetsAt(index);
    const { year } = frameParts(assets);
    litYear = year || "";
    if (yearEl) yearEl.textContent = litYear;
    lastYears = poolYears();
    drawStrip();
    paintPlate(assets);
    plateEl?.classList.remove("is-exchanging");
    yearEl?.classList.remove("is-exchanging");
  }, swapMs);

  /* ── The other half, later ────────────────────────────────────────────────
     A pair is unfolded, not skipped. ONE timer, cleared before it is re-armed
     and never chained past the last photograph, so a frame arms at most one
     pending swap and a single photograph arms none.

     ⚠ THE FRAME IS RE-CHECKED BY IDENTITY WHEN IT FIRES. Five minutes is long
     enough for a veto, a day boundary or a retry to have replaced the whole
     frame, and putting half two of a memory the room already dismissed onto the
     card would read as the wall arguing back. */
  clearTimeout(halfTimer);
  halfTimer = null;
  if (index + 1 < held.srcs.length) {
    halfTimer = setTimeout(() => {
      halfTimer = null;
      if (heldFrame !== held) return;
      present(index + 1);
    }, halfHold);
  }
}

/**
 * The photograph on the glass changed. Re-present it.
 *
 * ⚠ A FRAME IS NOT AN EXCHANGE ANY MORE. Behind `groundDiptych` ground hands
 * over a PAIR, and the card takes them one at a time — this seats the frame and
 * starts it; `present()` does the rest.
 *
 * @param {HTMLImageElement|HTMLImageElement[]} frame ground.js's own element(s)
 * @param {{transitioning:boolean, assets?:object[], settleMs?:number}} meta
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
     a 60s opacity ramp on the glass for no cause at all.

     ⚠⚠ AND IT MUST NOT RESTART A PAIR. The repeat lands ~2s after the first
     call, long before the half-hold, so re-seating the frame here would re-arm
     the timer off the wrong instant and, worse, replay half one. The words are
     repainted for whichever half is up and nothing else moves. */
  const key = srcs.join("|");
  if (key === heldFrame?.key) {
    paintPlate(assetsAt(heldIndex));
    return;
  }

  /* Exchange over ground.js's settle, CLAMPED — see CARD_EXCHANGE_MAX_MS. A
     veto still lands brisk because its settle is already under the ceiling; the
     ambient rotation no longer drags a minute-long double exposure across the
     card. The first frame has nothing to settle from and falls back to the
     module's own default.

     ⚠ ONE value, computed ONCE and used for BOTH the CSS var and the cleanup
     timer. They were separately derived from `meta.settleMs` before, which is
     exactly the shape that lets a future edit move one and not the other. Held
     on the frame so half two crosses at the same speed half one did. */
  const settleMs = Number.isFinite(meta.settleMs) && meta.settleMs >= 0
    ? Math.min(meta.settleMs, CARD_EXCHANGE_MAX_MS)
    : DEFAULT_EXCHANGE_MS;

  heldFrame = { key, imgs, srcs, assets: meta.assets, settleMs };
  present(0);
}

/**
 * WHICH ONE PHOTOGRAPH THE ROOM CAN SEE — the id on the card, or `null` when
 * the archive is not what is on the glass.
 *
 * This exists for "not this one". `ground.js` hides a frame WHOLE, and its
 * reason was that on a full-bleed diptych the room is looking at both halves
 * and pointing at neither. That reason expired here on 2026-08-22: the card
 * holds one photograph, so the room is looking at exactly one and pointing at
 * it, and hiding its unseen partner would delete a picture nobody rejected.
 *
 * ⚠⚠ NULL IS "HIDE THE WHOLE FRAME", so every condition below has to be the one
 * the STYLESHEET uses, not an approximation of it. The wrong answer here is not
 * a cosmetic bug — it is either deleting a photograph the room never saw, or
 * refusing to delete the one it just pointed at.
 *
 *  - flag off / not built — the surface does not exist.
 *  - any depth above 0 — `.archive` is visibility:hidden and the FULL-BLEED
 *    photograph is what the room is looking at, both halves of it.
 *  - reduced motion — `.archive { display: none }`, same situation.
 *
 * ⚠ `data-panel-dark` is deliberately NOT here: it suppresses the ghosts, the
 * engraved year and the Ken Burns, and leaves the card itself up.
 *
 * @returns {string|null}
 */
export function archiveFocusId() {
  if (!built || !enabled()) return null;
  if (document.documentElement.dataset.depth !== "0") return null;
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return null;
  return heldFrame?.assets?.[heldIndex]?.id ?? null;
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
    /* How many photographs the held frame has and which one is on the card.
       `frame` reads 2 on a diptych pair and `shown` below still reads 1 — that
       pairing is the whole assertion: ground still pairs, the card does not. */
    frame: heldFrame?.srcs.length ?? 0,
    half: heldFrame ? heldIndex : null,
    /* Whether the other half is still owed. A pending timer here at rest with
       `frame` 1 would be the leak shape this surface has paid for twice. */
    pendingHalf: halfTimer !== null,
    halfHold,
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

  /* The seam "not this one" reads, exposed so a spec — and a person standing at
     the wall over CDP — can ask WHY a veto hid one photograph or two, rather
     than only observing that it did. */
  window.__archiveFocus = () => archiveFocusId();

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

  /* The half-hold lever — same reason and same shape as the two above. How long
     half one of a pair should keep the card before its partner takes it is a
     "stand in front of it and see" number, and the default is arithmetic (half
     a rotation) rather than a judgement.

     Bounded to (0, one rotation]. Zero would present both halves in the same
     task, which is the diptych back in a worse form; longer than a rotation
     means half two is never reached and the pairing silently becomes the
     show-one-and-skip-one this was chosen over.

     ⚠ IT TAKES EFFECT ON THE NEXT FRAME, not on the one already on the glass —
     the pending swap was armed at the old value. Drive a fresh frame with
     `window.__groundDissolve(ms)` to see it. */
  window.__archiveHalfHold = (ms) => {
    const v = Number(ms);
    if (!Number.isFinite(v) || v <= 0 || v > GROUND_ROTATE_MS) return halfHold;
    halfHold = v;
    return halfHold;
  };

  return true;
}
