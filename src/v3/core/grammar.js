/* ═══════════════════════════════════════════════════════════════════════════
   GRAMMAR — the shapes depth 2 is allowed to be.

   Step 2.1 of docs/design/V3-MIGRATION.md, and half of the invariant that phase
   carries: LAYOUT IS COMPOSED BY RULES, LANGUAGE IS COMPOSED BY THE MODEL. This
   file is the rules half. It is the complete vocabulary of geometry available to
   the surface, and nothing may place content outside it.

   That is not tidiness. A screen whose furniture moves is a screen that has to
   be re-read every time instead of glanced at, and the whole reason V3 has a
   fixed lattice is that a wall panel is read from four metres away in under two
   seconds. Free-form layout — which is exactly what a model will produce if you
   let it — destroys that, quietly, one composition at a time.

   Pure: no DOM, no IO, no imports. It unit-tests in plain node like
   attentionRank.js, and tests/v3-composer.spec.js asserts against it directly.

   ── Why four rectangles and not the plan's five ──────────────────────────────

   The original plan lists "full 12×7, dominant 7×7, 5×4, 5×3, rail 12×2". What
   actually shipped in css/compose.css is slightly different, and THE CSS IS THE
   TRUTH: a rectangle named here with no class there is an invisible cell, which
   is the worst failure this file can have. So these are transcribed from the
   stylesheet, and a spec asserts the two agree.

   `cell--rail` exists in the CSS but is deliberately NOT a composition
   rectangle. Two reasons, both fatal: it spans rows 7–8 and therefore OVERLAPS
   both `wide` and `side` (rows 6–8), and depth 2 already shows the vocabulary
   rail in that corner — a rail cell would print the composition straight
   through it.

   ── Why four templates and not the plan's six ────────────────────────────────

   Four content rectangles is a ceiling of four cells, and the engine hands us at
   most three: `selectForMode` caps the DWELL stack at depth 3. A five- or
   six-cell template would be geometry nothing can ever reach, and unreachable
   layout is worse than missing layout — it looks like coverage and isn't. If the
   rank depth ever grows, `quad` is one line away; it is left out until then.
   ═══════════════════════════════════════════════════════════════════════════ */

/* The lattice, transcribed from css/compose.css. Grid LINE numbers, not track
   counts, and end-exclusive — the same convention grid-column uses, so `[1, 8]`
   here reads as `grid-column: 1 / 8` there and the two can be compared without
   arithmetic. With --cols: 12 the `-1` end line is 13; with --rows: 7 it is 8. */
export const COLS = 12;
export const ROWS = 7;

/* `voice` is the type law from css/type.css, applied as a PLACEMENT decision
   rather than a per-candidate one: the dominant cell is the house speaking, so
   it is set in the serif; the supporting cells are readouts, so they are set in
   the sans. That rule is what makes the spread legible before a word of it is
   read, and it belongs to the rectangle rather than to whatever lands in it. */
export const RECTS = {
  full: {
    name: "full", className: "cell--full",
    cols: [1, 13], rows: [1, 8], voice: "said", size: 1
  },
  dominant: {
    name: "dominant", className: "cell--dominant",
    cols: [1, 8], rows: [1, 6], voice: "said", size: 1
  },
  tall: {
    name: "tall", className: "cell--tall",
    cols: [8, 13], rows: [1, 6], voice: "measured", size: 1
  },
  wide: {
    name: "wide", className: "cell--wide",
    cols: [1, 8], rows: [6, 8], voice: "measured", size: 2
  },
  side: {
    name: "side", className: "cell--side",
    cols: [8, 13], rows: [6, 8], voice: "measured", size: 2
  }
};

/* ── The templates ──────────────────────────────────────────────────────────
   Ordered dominant-first, always. The composer fills them positionally from the
   ranked stack, so slot 0 is the thing the spread is about and the rest support
   it. There is no template without a dominant, because a spread of equals is a
   list, and a list is the thing this surface exists to not be.

   The pairing within each cell count is not decorative. A supporting candidate
   that nearly earned the screen on its own (High band or an interrupt) reads as
   a PEER and is given the tall column beside the dominant; anything below that
   is the day's readouts and belongs in the strip along the bottom, where it
   reads as a footnote. Same content, different claim on the room.
─────────────────────────────────────────────────────────────────────────── */
export const TEMPLATES = {
  /* Two things, the second of which is nearly as important as the first. */
  pair: { name: "pair", cells: ["dominant", "tall"] },
  /* Two things, the second a quiet aside under the first. */
  "pair-note": { name: "pair-note", cells: ["dominant", "wide"] },
  /* Three, one of them a peer: the empty bottom-right is the breathing room. */
  triple: { name: "triple", cells: ["dominant", "tall", "wide"] },
  /* Three ordinary ones: the dominant keeps the top-left, the other two run as
     a footer band and the whole top-right stays photograph. */
  "triple-footer": { name: "triple-footer", cells: ["dominant", "wide", "side"] }
};

/** A spread of one is a glance, so two is the floor. Three is the engine's own
 *  DWELL depth and therefore the ceiling — see the header. */
export const MIN_CELLS = 2;
export const MAX_CELLS = 3;

/** The High band floor, and the line between a peer and a footnote. Same number
 *  as attention.js's HIGH_MIN_SCORE and attentionRank's QUIET_MIN_SCORE, for the
 *  same reason: this is the house's one definition of "worth the room". */
export const PEER_MIN_SCORE = 70;

/**
 * Which template for this many cells, given whether any supporting candidate is
 * a peer. Returns null for anything that is not a legal spread — the caller must
 * then not enter depth 2 at all rather than show it empty.
 */
export function chooseTemplate(cellCount, { peer = false } = {}) {
  if (cellCount === 2) return peer ? TEMPLATES.pair : TEMPLATES["pair-note"];
  if (cellCount === 3) return peer ? TEMPLATES.triple : TEMPLATES["triple-footer"];
  return null;
}

/** Do two rectangles share any module of the grid? */
export function overlaps(a, b) {
  const colsOverlap = a.cols[0] < b.cols[1] && b.cols[0] < a.cols[1];
  const rowsOverlap = a.rows[0] < b.rows[1] && b.rows[0] < a.rows[1];
  return colsOverlap && rowsOverlap;
}

/**
 * Is this template legal? Every slot must name a real rectangle, no two may
 * overlap, and the first must be the dominant one. A spec runs this over every
 * template in the set — the point is that a fifth template added later cannot
 * quietly print one cell on top of another.
 */
export function validate(template) {
  const names = template?.cells;
  if (!Array.isArray(names) || names.length < MIN_CELLS || names.length > MAX_CELLS) return false;
  if (names[0] !== "dominant") return false;
  if (new Set(names).size !== names.length) return false;

  const rects = names.map((n) => RECTS[n]);
  if (rects.some((r) => !r)) return false;

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlaps(rects[i], rects[j])) return false;
    }
  }
  return true;
}
