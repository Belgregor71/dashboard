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

// ── The card on ONE PLANE (features.v3ArchivePlane) ──────────────────────────
//
// A SECOND BOX, not a tweak to the one above, and the two must not be merged.
// The shipped card is laid out for a THREE-AXIS plane under a 1400px
// perspective; the plane rebuild is one axis under 2800px with the
// perspective-origin and the plane's transform-origin on the same point. Those
// are different projections, so the plane-space rectangle that lands where a
// person wants it is a different rectangle. Sharing constants between them
// would mean any future tuning of one silently moves the other, and only one of
// them is ever on the glass.
//
// ⚠⚠ THE PROJECTED BOX IS NOT THE ELEMENT BOX, and under this perspective it is
// about 3% WIDER and TALLER than the CSS numbers below — the far edge of the
// card is nearer the eye than the origin, so it is magnified rather than
// shrunk. Sizing this from the CSS height alone puts the card through the hour.
// Every number here was chosen against the PAINTED rect, and
// tests/v3-archive.spec.js measures that rect rather than these constants.
//
//   left  88    PINNED, same reasoning as CARD_LEFT: the left edge never moves,
//               so a portrait simply does not reach as far right and nothing
//               else on the wall shifts.
//   maxW  1000  as wide as the card may grow. The projection magnifies it back
//               to ~970 painted against the shipped surface's 1040, so the
//               photograph keeps essentially the size it has today.
//   maxH  550   ⚠ SET BY THE TWO STACKS IT SITS BETWEEN, NOT BY TASTE. Above it
//               is the date (96-152) and nothing else — the fault pill left the
//               top-left corner on 2026-09-05 — so the painted top edge has to
//               clear 152 with a gap rather than the pill's old 227. Below it
//               the hour now rides 62px higher than the safe margin, because
//               the archive's one caption line took the bottom of that column,
//               so the painted bottom edge has to clear y771 rather than y833.
//               The band lost 62 at the bottom and gained 62 at the top: the
//               height is unchanged and the whole left column simply moved up.
//   midY  462   ⚠ MOVED WITH THE HOUR, 524 → 462, and it is arithmetic rather
//               than taste: the hour's lift is --hour-lift (-62px, archive.css)
//               and this is the same 62. Change one without the other and the
//               card lands on the clock.
export const PLANE_CARD_LEFT = 88;
export const PLANE_CARD_MAX_W = 1000;
export const PLANE_CARD_MAX_H = 550;
export const PLANE_CARD_MID_Y = 462;

// ── A TALL PRINT LEAVES THE PIN (features.v3ArchivePortrait) ─────────────────
//
// The pin above is honest for a landscape and strands a portrait. A 3:4 memory
// fits to 413 wide against a 16:9 memory's 978, so left-pinned it ends at x501
// while the engraved year still starts at x1093 — ~600px of bare wall between
// the only two objects in the room, and the owner named it twice ("~890px of
// soft middle", then "go into the middle"). ⚠ AND THE DAYTIME REBUTTAL DOES NOT
// SURVIVE THE NIGHT: the night rule takes the year to opacity 0, and the year is
// the only thing occupying x1093-1838, so after dark the gap is ~1,400px of
// ghost. Measured on the live wall 2026-09-06, which is the evidence this
// geometry answers.
//
// THE RULE: THE PRINT'S RIGHT EDGE IS THE WALL'S SPINE. A landscape already ends
// at 88 + 978 = 1066, where the engraved year begins; a tall print slides right
// until it ends there too, so the print and the year meet at the same place
// whatever shape the memory is. That is a rule the composition can state, not a
// position somebody liked.
//
// ⚠⚠ AND IT RAMPS RATHER THAN SWITCHES. A hinge would move the card ~325px
// between two photographs a person would call the same shape — 1.01 and 0.99 are
// not different rooms. `portraitLean` is 0 at square-or-wider and 1 at 3:4 (the
// commonest phone portrait, and every taller print clamps there), so at lean 0
// EVERY number below reduces to the pinned rectangle above, to the pixel. That
// is what makes the flag-off path identical rather than merely close.
//
//   maxH 660  ⚠ THE 550 CAP EXISTS BECAUSE THE CARD STANDS OVER THE CLOCK, and a
//             print that has left the left column no longer does. The hour is
//             x96-405; a leaned print starts at 571. What still bounds it is the
//             date above (painted bottom 152) and the fault pill below (painted
//             top 930, and the pill can grow). 660 lands the PAINTED box at
//             y187-873: 35 clear of the date, 57 clear of the pill.
//   midY 530  moves with the height, because the band it grows into is not
//             centred on 462. Ramped from 462 so nothing jumps.
export const PLANE_PORTRAIT_HINGE = 1.0;
export const PLANE_PORTRAIT_FULL = 0.75;
export const PLANE_PORTRAIT_MAX_H = 660;
export const PLANE_PORTRAIT_MID_Y = 530;
export const PLANE_CARD_RIGHT = 1066;

// ⚠⚠ IT SLIDES BEFORE IT STANDS UP, AND THAT ORDER IS THE WHOLE SAFETY OF THIS
// CHANGE. Growing the height on the same ramp as the position put a 0.9 memory
// at left 281 and 608 tall, whose bottom-left corner landed ON THE CLOCK —
// caught by probing the mid-ramp case at 1920x1080, not by any assertion, and it
// is precisely the collision the 550 cap exists to prevent. The cap is not about
// height in the abstract: it is about a card that stands over the hour.
//
// So the growth is gated on the card having actually left that column. `rise` is
// 0 until the un-grown rectangle's left edge has cleared the hour's painted
// right edge (405) with air, and reaches the lean's full value 120px later.
// 430/120 put the gate's opening at aspect ~0.84, where the card is already at
// left ~438 — clear of the hour in x, and still short enough to clear it in y.
//
// 🔑 ONE PASS, NOT A FIXED POINT. The gate reads the left edge the card would
// have at its UN-GROWN width, so `rise` never depends on the height it is about
// to choose. Growing widens the card and therefore slides it slightly back left,
// so the gate is a little optimistic — which is why the spec measures the
// painted card against the painted hour across the whole ramp rather than
// trusting this arithmetic.
export const PLANE_PORTRAIT_RISE_CLEAR = 430;
export const PLANE_PORTRAIT_RISE_SPAN = 120;

/**
 * How far a print of this aspect has left the left pin: 0 for anything square
 * or wider, 1 for 3:4 and every taller print, linear between.
 *
 * Pure and exported because THREE things ramp on it — the card's rectangle here,
 * and the engraved year and the ghost in archive.css, which read it as the
 * `--arch-portrait` custom property. One number, one source.
 *
 * @param {number} aspect naturalWidth / naturalHeight of the DECODED rendition.
 * @returns {number} 0..1, and 0 for anything unmeasurable.
 */
export function portraitLean(aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) return 0;
  const span = PLANE_PORTRAIT_HINGE - PLANE_PORTRAIT_FULL;
  const t = (PLANE_PORTRAIT_HINGE - aspect) / span;
  return Math.min(1, Math.max(0, t));
}

/**
 * The card's rectangle on the one-plane surface, in PLANE space — the
 * coordinates the element is laid out in, before the rotation and the
 * perspective are applied to it.
 *
 * Same contract as `cardRectFor`: pure, aspect in, rectangle out, null for
 * anything unmeasurable, and null means "leave the card alone". No `tileW`/
 * `tileH` — the plane surface has ONE masked ghost covering a photograph rather
 * than a tiled echo, so there is no tile to size.
 *
 * @param {number} aspect naturalWidth / naturalHeight of the DECODED rendition.
 * @param {boolean} [portrait] features.v3ArchivePortrait — let a tall print
 *   leave the pin. ⚠ DEFAULTS FALSE so the flag-off caller is the function it
 *   has always been, and `lean` is 0 for every aspect when it is.
 * @returns {{w:number,h:number,left:number,top:number,lean:number}|null}
 */
export function cardRectForPlane(aspect, portrait = false) {
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  const a = Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, aspect));

  /* ⚠ THE LEAN IS TAKEN FROM THE CLAMPED ASPECT, not the raw one, for the same
     reason the box below is: a 9:16 phone portrait and an unmeasurably thin scan
     must land on the same rectangle, and reading the raw value here would ramp
     past 1 for one of them and not the other. `portraitLean` clamps too, so this
     is belt and braces — but the two clamps are for different reasons and
     collapsing them is how one of them goes missing later. */
  const lean = portrait ? portraitLean(a) : 0;

  /* The fit, unchanged: as wide as it may go, then height-bound if that is too
     tall. Taken as a function of the cap because the cap is asked for twice —
     once at today's 550 to find out where the card would land, and once at the
     leaned cap to size it. */
  const box = (maxH) => {
    let w = PLANE_CARD_MAX_W;
    let h = w / a;
    if (h > maxH) { h = maxH; w = h * a; }
    return { w, h };
  };

  /* THE SPINE. The print's right edge is the wall's spine: a landscape already
     ends at 1066, where the engraved year begins, so a tall print slides right
     until it ends there too and the two always meet at the same place.

     ⚠ At lean 0 this is PLANE_CARD_LEFT exactly, whatever w is — which is what
     makes the flag-off rectangle the pinned one to the pixel rather than to a
     rounding.

     ⚠ THE FLOOR CANNOT FIRE TODAY AND IS KEPT ANYWAY, which is worth saying
     plainly rather than leaving as a guard somebody later reads as live: the
     ramp ends at 3:4, so any print with lean > 0 is narrower than 660 and
     1066 - w is never left of 88. It is here because widening
     PLANE_PORTRAIT_FULL toward a landscape aspect is the obvious next edit, and
     that edit without this line walks the card off the safe margin silently. */
  const pinnedLeft = (w) =>
    PLANE_CARD_LEFT + (Math.max(PLANE_CARD_LEFT, PLANE_CARD_RIGHT - w) - PLANE_CARD_LEFT) * lean;

  /* PASS ONE — where the lean alone would put the card at the height it has
     always had. Read ONLY to answer "has it left the clock yet?". */
  const rise =
    lean *
    Math.min(
      1,
      Math.max(
        0,
        (pinnedLeft(box(PLANE_CARD_MAX_H).w) - PLANE_PORTRAIT_RISE_CLEAR) / PLANE_PORTRAIT_RISE_SPAN
      )
    );

  /* PASS TWO — the rectangle it actually gets. ⚠ `rise` drives the height and the
     centre; `lean` drives the position. They are different ramps on purpose (see
     the note above), and using one where the other belongs is how the card ends
     up on the clock again. */
  const maxH = PLANE_CARD_MAX_H + (PLANE_PORTRAIT_MAX_H - PLANE_CARD_MAX_H) * rise;
  const midY = PLANE_CARD_MID_Y + (PLANE_PORTRAIT_MID_Y - PLANE_CARD_MID_Y) * rise;
  const { w, h } = box(maxH);

  return {
    w: Math.round(w),
    h: Math.round(h),
    left: Math.round(pinnedLeft(w)),
    top: Math.round(midY - h / 2),
    lean,
    rise
  };
}
