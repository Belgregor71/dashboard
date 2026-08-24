/* ════════════════════════════════════════════════════════════════════════════
   HOW A PHOTOGRAPH MEETS THE PANEL — the ground's vertical anchor.

   `object-fit: cover` on a 1920x1080 panel scales a photograph to the width and
   throws the overflow away from the CENTRE outwards, half off the top and half
   off the bottom. That is the right default only for a library whose landscapes
   are 16:9, because 16:9 into 1.78 overflows by nothing at all.

   🔑 THIS LIBRARY IS NOT THAT LIBRARY. Measured 2026-08-24 over 681 deduped
   assets across fifteen month-windows spanning 2013-2023 (`/api/immich/browse`):

     portrait  (<1.2)        339   49.8%
     4:3       (1.20-1.45)   285   41.9%   ← the crop this module exists for
     3:2       (1.45-1.65)    49    7.2%
     16:9      (1.65-1.90)     6    0.9%   ← the shape cover assumes
     wider                     2    0.3%

   83.3% of every landscape here is 4:3, and the case that loses nothing is SIX
   PHOTOGRAPHS out of 681. A 4:3 frame loses 25.3% of its height, 12.6% off each
   end — and the owner's report that opened F6 was "heads are being cropped,
   tops of cocktails being left off". Both of those live near the TOP.

   ⚠ THIS IS A TASTE CONSTANT AND IT IS TREATED AS ONE. The arithmetic says how
   much is cut, never where the picture is. So the anchor ships default-off with
   a live lever (`window.__groundBias`) and is judged in front of the wall, the
   way --arch-ghost's 0.22 was. Nothing here is measurement dressed up.

   ⚠ IT ONLY EVER MOVES A KNOWN LANDSCAPE. A portrait's overflow is enormous
   (0.75 into 1.78 keeps ~42%) and it belongs in the diptych, which crops it
   barely at all; an UNKNOWN aspect is the 4% of HEICs whose orientation Immich
   never recorded, and guessing a direction to slide a photograph we cannot
   measure is exactly the error `isKnownPortrait` refuses to make. Both stay
   centred, which is what they do today.
════════════════════════════════════════════════════════════════════════════ */

/* Matches ground.js. A landscape below this is really a portrait, and the two
   modules disagreeing about that would put a photograph in a diptych half and
   then slide it as though it were full-bleed. */
export const LANDSCAPE_MIN_ASPECT = 1.2;

/* The panel. A photograph WIDER than this overflows horizontally instead, and a
   vertical anchor is a no-op on it — 16:9 and the two panoramas in the sample
   are untouched by anything in this file whatever the bias says. */
export const PANEL_ASPECT = 16 / 9;

/* Centre — what `object-fit: cover` does on its own, and the value every path
   that is not a known landscape returns. */
export const CENTRE = 0.5;

/* Where a biased landscape sits, as a fraction of its own overflow: 0 anchors
   the top edge and throws the whole 25.3% off the bottom, 0.5 is centre.
   0.35 keeps 8.9% off the top against 16.4% off the bottom on a 4:3 — enough to
   recover a head, not so much that a table loses its foreground. It is a
   starting point for the lever, not a finding. */
export const DEFAULT_BIAS = 0.35;

let bias = DEFAULT_BIAS;

/** The lever's current value. Read by ground.js when it frames each photograph. */
export const currentBias = () => bias;

/**
 * Move the anchor live, on the wall, without a deploy.
 *
 * Bounded to [0, CENTRE]: above centre would slide the picture DOWN, which
 * nothing in the report or the arithmetic argues for and which would let the
 * lever quietly make the top worse than doing nothing. CENTRE is the control
 * arm of the A/B, so it has to stay reachable.
 *
 * @returns {number} the bias in force after the call — unchanged if rejected.
 */
export function setBias(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0 || v > CENTRE) return bias;
  bias = v;
  return bias;
}

const flagOn = () => Boolean(globalThis.window?.CONFIG?.features?.groundFraming);

/**
 * The vertical anchor for one photograph, as a fraction of its overflow.
 *
 * ⚠ RETURNS CENTRE, NOT THE BIAS, FOR EVERYTHING IT IS NOT SURE ABOUT — flag
 * off, unknown aspect, portrait, or a landscape wide enough that there is no
 * vertical overflow to anchor. Callers may therefore compare against CENTRE to
 * decide whether to write anything at all, which is what keeps the flag-off DOM
 * identical rather than merely equivalent.
 *
 * @param {number|null|undefined} aspect  DISPLAY aspect (post-rotation), i.e.
 *   `slim()`'s `aspect` off Immich's top-level width/height — NOT the exif pair,
 *   which is pre-rotation and called 31.7% of this library's portraits
 *   landscapes until d710e99. See services/immichClient.js `displayAspect`.
 * @param {boolean} [isHalf]  true for a diptych half, whose box is 952 wide
 *   rather than 1920 — a different overflow entirely, and not one this anchor
 *   was measured against.
 * @returns {number} 0..0.5
 */
export function framePosY(aspect, isHalf = false) {
  if (!flagOn() || isHalf) return CENTRE;
  const a = Number(aspect);
  if (!Number.isFinite(a) || a <= 0) return CENTRE;
  if (a < LANDSCAPE_MIN_ASPECT) return CENTRE;   // portrait: the diptych's job
  if (a >= PANEL_ASPECT) return CENTRE;          // no vertical overflow to move
  return bias;
}

/**
 * Read back the anchor an element was framed with.
 *
 * 🔑 THE SAMPLER AND THE GLASS MUST AGREE OR THE SCRIM IS SOLVING FOR PIXELS
 * THAT ARE NOT ON SCREEN. scrim.js models `object-fit: cover` itself
 * (`coverRect`) to decide how much scrim the text needs; if the ground slides a
 * photograph up and the sampler keeps reading the centre, it measures a band of
 * the picture the eye never sees and can under-scrim real text. ground.js
 * writes this dataset value in the same breath as the inline style, so there is
 * one number and it is on the element.
 *
 * Absent (every flag-off image, and the #ground element from index.html before
 * the first frame) reads as CENTRE, which is what the browser is doing anyway.
 */
export function posYOf(el) {
  const v = Number(el?.dataset?.posY);
  return Number.isFinite(v) && v >= 0 && v <= CENTRE ? v : CENTRE;
}
