/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces. The incumbent's modules/ambientArchive.js reads all
   of it; V3's core/archive.js reads `cardRectFor` and the card-box constants
   only — the card's geometry is the one part of the archive that is arithmetic
   rather than composition, and both surfaces must land a 16:9 memory on the
   same rectangle to the pixel or the port is not a port.

   ⚠ `plateFor` is INCUMBENT-ONLY and cannot be called from V3. It parses a
   caption whose year comes FIRST (`2021 · Nudgee · Melanie`, which is what
   photoMemory.captionFor joins); V3's ground.js joins the opposite order,
   `Melanie · Nudgee · 2021`, so the leading-\d{4} match silently returns null
   for every V3 caption. V3 builds its plate from the ASSETS via
   ground.frameParts() instead, which is the shape it actually has.
   ═══════════════════════════════════════════════════════════════════════════ */
import { captionParts, relativeYearPhrase } from "./photoMemory.js";

// The pure half of the Ambient Archive (docs/design/AMBIENT-ARCHIVE.md).
//
// Same discipline as dayModel.js: no DOM, no storage, no timers — so the
// decision that is easiest to get quietly wrong (what the plate is allowed to
// say) unit-tests in plain node. The renderer (modules/ambientArchive.js) reads
// live state and paints; this decides.

/**
 * What the plate says about the photograph on the card.
 *
 * The caption is already `year · place · who` — `captionFor` joins exactly
 * that — so the plate RELOCATES language the screensaver already renders in
 * Mode 0 rather than adding any (§6.4b).
 *
 * ⚠ Most of this library has no GPS and no named faces, so the caption is very
 * often a bare year and there is no place to put in the title. The plate still
 * speaks: it says the year in words. That is not invented data — the year is
 * already on the wall as a 400px engraving behind it — and it is the same
 * phrasing `buildOnThisDayMemory` uses. Shipped after 2026-08-02, when the
 * whole day's frozen set captioned as bare years and the plate never appeared.
 *
 * No year at all → null, and null means no plate: silence is the default.
 *
 * @returns {{year:string, title:string, who:string|null}|null}
 */
export function plateFor(caption, now = new Date()) {
  const named = caption ? /^\s*(\d{4})\b/.exec(String(caption)) : null;
  if (!named) return null;
  const year = named[1];
  const parts = captionParts(caption);
  const title = parts?.title ?? relativeYearPhrase(Number(year), now);
  if (!title) return null;
  return { year, title, who: parts?.who ?? null };
}

/**
 * The year a caption names, or null. The ghost engraving and the lit year-line
 * need only this — NOT the plate's parts. A photo with no place yields no
 * plate, and deriving the year from the plate is how the year vanished off the
 * wall entirely on 2026-08-02.
 */
export function yearOf(caption) {
  const named = caption ? /^\s*(\d{4})\b/.exec(String(caption)) : null;
  return named ? Number(named[1]) : null;
}

// ── The card follows the print (features.archiveFitToPrint) ──────────────────
//
// The shipped card is a fixed 1040×585 = 1.78:1 rectangle and the photograph is
// `object-fit: cover` inside it, so a phone-shot library is shown through a
// letterbox it was never composed for: a 4:3 landscape loses ~25% of its
// height, a 3:4 portrait loses ~58% — heads and feet both. Raised on the panel
// 2026-08-02 ("a few of the photos displayed today looked cropped"). It is
// structural, not a glitch: Immich's `preview` rendition is a resize, so the
// card geometry is the whole cause.
//
// The ruling: THE CARD FOLLOWS THE PRINT. A portrait memory gets a portrait
// card and nothing is ever cut — physically true to a photograph, which has an
// aspect before it has a frame.
//
// The box it fits into, and why each number is what it is:
//
//   left  130   PINNED. The card's left edge never moves, so a portrait simply
//               does not reach as far right and nothing else on the wall
//               shifts. (Owner's call, 2026-08-02, over centring it.)
//   maxW  1040  the reference's own width — a 16:9 memory is pixel-identical to
//               the verified surface, top-left corner included.
//   maxH  609   as tall as the card may grow before it fouls something. The
//               demoted 64px corner clock + dateline bottom out near y=180, and
//               the today ruler draws its line at y=904 with marks rising above
//               it; 200 → 809 is the honest gap between them.
//   midY  504.5 the shipped card's own vertical centre (212 + 585/2), held
//               fixed so the card grows symmetrically about where it has always
//               sat rather than dropping toward the ruler.
//
// 16:9 is the exact hinge: 1040/609 = 1.708, so anything wider than that is
// width-bound and anything narrower is height-bound. 1.778 lands on
// 1040×585 @ (130, 212) — the shipped rectangle, to the pixel. That is
// deliberate: flipping this flag must not move the common landscape memory.
export const CARD_LEFT = 130;
export const CARD_MAX_W = 1040;
export const CARD_MAX_H = 609;
export const CARD_MID_Y = 504.5;

// A true panorama or a sliver-thin scan would fit to a strip too slight to read
// as a photograph at all, so the aspect is clamped and those (rare) frames keep
// a modest crop. 0.45 is taller than 9:16, so every phone portrait is inside the
// range and un-cropped — which is the case this whole change exists for.
export const ASPECT_MIN = 0.45;
export const ASPECT_MAX = 3.2;

// The echo behind the card is the same photograph, tiled and drained. Its tile
// is hard-coded 620×349 — 16:9 — so a portrait memory would be STRETCHED into
// it, which is the same lie about the print's shape one plane further back.
// The tile follows the aspect too, at constant AREA rather than constant width,
// so the echo's density (and therefore its cost) stays put whatever arrives.
const ECHO_TILE_AREA = 620 * 349;

/**
 * The card's rectangle for a photograph of this aspect, in frame coordinates on
 * the fixed 1920×1080 stage.
 *
 * Pure on purpose: the geometry is the part most likely to be got quietly wrong
 * (the plate, the ghost year and the ruler all sit against this rectangle), and
 * this way it is arithmetic in plain node rather than something only the panel
 * can answer.
 *
 * @param {number} aspect naturalWidth / naturalHeight of the rendition actually
 *   on screen — NOT the EXIF dimensions, which are pre-rotation and would put
 *   every portrait iPhone photo in a landscape card.
 * @returns {{w:number,h:number,left:number,top:number,tileW:number,tileH:number}|null}
 *   null for anything unmeasurable, and null means "leave the card alone".
 */
export function cardRectFor(aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  const a = Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, aspect));

  let w = CARD_MAX_W;
  let h = w / a;
  if (h > CARD_MAX_H) {
    h = CARD_MAX_H;
    w = h * a;
  }

  const tileH = Math.sqrt(ECHO_TILE_AREA / a);
  return {
    w: Math.round(w),
    h: Math.round(h),
    left: CARD_LEFT,
    top: Math.round(CARD_MID_Y - h / 2),
    tileW: Math.round(tileH * a),
    tileH: Math.round(tileH)
  };
}
