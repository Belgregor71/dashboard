/* ═══════════════════════════════════════════════════════════════════════════
   SPREAD — depth 2, rendered.

   The DOM half of Phase 2, kept out of grammar.js and composer.js so both of
   those stay pure and node-testable. This file knows about elements; it makes no
   decisions. Every question of "what" and "where" was already answered before it
   is called.

   ── Two tenants, one lattice ─────────────────────────────────────────────────

   `#spread-lattice` is also written by vocabulary-card.js, which was depth 2's
   only tenant until now. They do not fight, and the reason is upstream: the
   attention tick only ever composes while the surface is at FIELD or GLANCE, so
   a voice-opened depth 2 is never overwritten mid-sentence. The card hands the
   node over explicitly by calling clearSpread() before it mounts.

   ── Why the signature, and why it is read out of the DOM ─────────────────────

   The tick runs every 30 s and re-composes while the room keeps dwelling. Naive
   re-rendering would replace every cell node each time, which re-triggers
   `@starting-style` and makes the whole spread fade in again — every 30 seconds,
   forever, for no reason the room can see. That is precisely what the calm law
   forbids. So a composition that resolves to the same template and the same
   candidates in the same order does not touch the DOM at all.

   The signature is derived from the mounted nodes rather than remembered in a
   module variable, because a remembered one can be right about a screen that is
   no longer there: the other tenant replaces these children without this file
   hearing about it, and a stale "nothing changed" would then leave the wrong
   thing on the wall with no error anywhere. Asking the DOM cannot be wrong.
   ═══════════════════════════════════════════════════════════════════════════ */

import { compose } from "./composer.js";
import { formatClock, progressOf } from "./media-rooms.js";

/* modules/focusHero.js HERO_TIER_B_MAX. Inherited rather than chosen: the
   incumbent has been stepping the hero line down at 41 characters since Study
   02, and css/type.css already carries the matching `.said[data-len="long"]`
   rule — which, until now, nothing in V3 ever set. */
const SAID_LONG_MAX = 40;

function lattice() {
  return document.getElementById("spread-lattice");
}

/**
 * Set a said line, stepping the size down when it is too long to hold 132px,
 * and recording whether it ended up wrapping.
 * Exported because the glance cell needs exactly the same rule and there is no
 * reason for the two depths to disagree about when a line is long.
 *
 * ⚠ `data-wrapped` IS A LEGIBILITY FLAG, NOT A TYPOGRAPHIC ONE, and it is the
 * character count's admission that it cannot answer this. core/scrim.js solves
 * the scrim for the band where text lives and its comment assumes the dominant
 * line "bottom-aligns near y=0.32" — true of ONE line. A second line pushes the
 * top of the block to y=0.59, where the gradient has thinned to ~0.42 of the
 * solved opacity and is transparent outright by 0.88 BY DESIGN. No opacity
 * reaches it, so the scrim cannot be the answer and compose.css veils the layer
 * instead (`:has(.said[data-wrapped])`).
 *
 * Measured, not assumed: 132px holds 20 characters on one line and 96px holds
 * 28, so SAID_LONG_MAX at 40 lets a 35-character line wrap at BOTH sizes. That
 * is the case the sweep has been reporting at 1.59:1 — a count of characters
 * cannot know the width of the ones it counted.
 *
 * A Range's client rects are one per line box, which asks the renderer the
 * question directly rather than dividing heights and hoping. It costs a forced
 * layout, once per glance render, and the depths are hidden with `visibility`
 * rather than `display` — so the box is laid out and the answer is real even
 * when the depth is not the one on screen.
 */
export function setSaidText(node, text) {
  if (!node) return;
  node.textContent = text ?? "";
  if ((text ?? "").trim().length > SAID_LONG_MAX) node.dataset.len = "long";
  else delete node.dataset.len;

  const range = document.createRange();
  range.selectNodeContents(node);
  // 0 rects means the node is not laid out at all (detached, or a spec's
  // fragment). That is not a wrapped line, and guessing that it is would veil
  // the photograph for a screen that does not exist.
  if (range.getClientRects().length > 1) node.dataset.wrapped = "1";
  else delete node.dataset.wrapped;
  range.detach();
}

/* ── The context line ───────────────────────────────────────────────────────
   The eyebrow above a cell's line: "Drive to work", "Lounge Room TV",
   "Tonight's menu". Owner's verdict on the glass, 2026-08-13 — "no context on
   most of the information". V3 rendered one bare string per cell, so a spread
   of readouts came out as "11 min · 18 min", "Colin from Accounts" and a
   floating quoted phrase: values with their labels removed, which reads as
   random words rather than as a screen.

   Flag-gated and default-off. Off is not "the label is blank", it is NO NODE —
   the flag-off DOM is the one that shipped before this, which is what makes the
   flag the rollback rather than a switch that leaves a gap in the layout.
─────────────────────────────────────────────────────────────────────────── */
export function contextEnabled() {
  // Per-call, never at module load: ES imports hoist above the point where
  // /js/config.js sets window.CONFIG, and this repo has paid for that read
  // being frozen to `undefined` three times.
  return Boolean(globalThis.window?.CONFIG?.features?.v3CellContext);
}

/* ── The cell's artwork ─────────────────────────────────────────────────────
   ⚠ THE GRADIENT RAN BACKWARDS, and this is the half that made it do so. Owner's
   report, 2026-08-23: "when moving into depth you actually get less information
   with only the title being displayed — although bigger text". Exactly right,
   and not a config accident: every cell here was an eyebrow and a single <p>,
   BY CONSTRUCTION, so the artwork the candidate has carried since the Tier-1a
   rich cards was discarded on the way in. Depth 0 had a picture and depth 2
   threw it away.

   It pays for itself twice. `cameraTriggerCandidate` has been carrying a
   snapshot in the same `image` slot for just as long, and the spread has been
   dropping that on the floor too — one fix, two surfaces.

   Flag-gated on `v3MediaRooms` alongside the depth-0 band, deliberately as ONE
   switch rather than two: they are one change to what depth means, and a
   rollback that restored the band but left the cells is a state nobody
   designed. Flag-off is NO NODE, not an empty one.
─────────────────────────────────────────────────────────────────────────── */
function artEnabled() {
  return Boolean(globalThis.window?.CONFIG?.features?.v3MediaRooms);
}

/** What the clock says for a cell, or null. Elapsed and remaining both, because
 *  depth 2 is where somebody is close enough to want the numbers — depth 0
 *  deliberately has none. */
export function clockLine(media) {
  const p = progressOf(media);
  if (!p) return null;
  const type = media?.contentType;
  const elapsed = formatClock(p.elapsed, type);
  const remaining = formatClock(p.duration - p.elapsed, type);
  if (!elapsed || !remaining) return null;
  return { elapsed, remaining };
}

/**
 * The artwork block for a cell, or null when the candidate has no picture.
 *
 * A record for music and a frame for everything else — the same two objects the
 * depth-0 band draws, for the same reason: a 16:9 still centre-cropped into a
 * circle reads as a rendering fault, and this repo has already shipped and
 * reverted that once.
 */
export function artNode(candidate) {
  if (!artEnabled()) return null;
  const src = candidate?.image;
  if (!src) return null;

  const media = candidate.media ?? null;
  const music = media?.kind === "music";
  const wrap = document.createElement("div");
  wrap.className = music ? "cell__disc" : "cell__frame";

  const img = document.createElement("img");
  img.alt = "";
  img.addEventListener("error", () => { img.dataset.blank = "1"; }, { once: true });
  img.src = src;

  if (music) {
    const plate = document.createElement("div");
    plate.className = "cell__plate";
    plate.appendChild(img);
    wrap.appendChild(plate);
    const spindle = document.createElement("div");
    spindle.className = "cell__spindle";
    wrap.appendChild(spindle);
  } else {
    const still = document.createElement("div");
    still.className = "cell__still";
    still.appendChild(img);
    wrap.appendChild(still);
  }

  /* The record turns at every depth — owner's call. Same negative-delay
     animation as the band, so the two can never disagree about how far through
     the track is, and same absence of a timer. */
  const p = progressOf(media);
  if (p) {
    wrap.dataset.timed = "1";
    wrap.style.setProperty("--dur", `${p.duration}s`);
    wrap.style.setProperty("--delay", `-${p.elapsed}s`);
    wrap.style.setProperty("--prog", String(p.fraction));
  }
  return wrap;
}

/** The eyebrow node for a cell, or null when there is nothing to label with. */
export function labelNode(text) {
  const label = typeof text === "string" ? text.trim() : "";
  if (!label || !contextEnabled()) return null;
  const node = document.createElement("p");
  node.className = "cell__label measured";
  node.textContent = label;   // textContent, never innerHTML — this is data
  return node;
}

/* ⚠ THE LABEL IS PART OF THE SIGNATURE. The tick re-composes every 30 s and
   skips the DOM write when the signature matches — so with the label outside
   it, flipping the flag on a live wall (or a candidate changing only its room)
   would leave the old label-less cells mounted until the candidate id itself
   changed. That is the shape of bug this repo calls "the flag looked shipped
   and changed nothing". */
function signatureOf(composition) {
  const cells = composition.cells.map(
    (c) => `${c.id}~${contextEnabled() ? (c.label ?? "") : ""}~${artEnabled() ? (c.candidate?.image ?? "") : ""}`
  );
  return `${composition.template}|${cells.join("|")}`;
}

/** What is actually on the wall right now, in the same form. Null when this file
 *  is not the current tenant of the lattice. */
function mountedSignature(host) {
  const template = host.dataset.template;
  if (!template) return null;
  const cells = Array.from(host.children).map(
    (n) => `${n.dataset.cellId ?? ""}~${n.dataset.cellLabel ?? ""}~${n.dataset.cellArt ?? ""}`
  );
  return `${template}|${cells.join("|")}`;
}

/**
 * Compose and mount depth 2.
 *
 * @returns the composition, or null when there is nothing legal to show — in
 *          which case the caller must NOT deepen. It is the same contract
 *          renderVocabularyCard() carries, and for the same reason.
 */
export function renderSpread(selection) {
  const host = lattice();
  if (!host) return null;

  const composition = compose(selection);
  if (!composition) {
    clearSpread();
    return null;
  }

  const next = signatureOf(composition);
  if (next === mountedSignature(host)) {
    return composition;               // identical — leave the DOM alone
  }

  const frag = document.createDocumentFragment();
  for (const cell of composition.cells) {
    const node = document.createElement("div");
    node.className = `cell ${cell.className}`;
    // The deixis address, so a spoken reference lights the right rectangle.
    node.dataset.cell = cell.ref;
    node.dataset.cellId = cell.id;

    /* The eyebrow goes in FIRST — above the line it labels, which is what makes
       it read as a label rather than as a caption or a second fact. The cell is
       a column that justifies its content to the bottom, so both stay anchored
       in the band the scrim was solved for. */
    const eyebrow = labelNode(cell.label);
    if (eyebrow) {
      node.appendChild(eyebrow);
      node.dataset.cellLabel = cell.label;
    }

    const line = document.createElement("p");
    if (cell.voice === "said") {
      line.className = `said said--${cell.size}`;
      setSaidText(line, cell.text);
    } else {
      line.className = `measured measured--${cell.size}`;
      // textContent, never innerHTML — candidate text is data, and some of it
      // comes from a language model.
      line.textContent = cell.text;
    }

    node.appendChild(line);

    /* The clock, at the depth that earns it. Depth 0 shows no numbers at all —
       the ring and the rule carry the proportion there — so this is the first
       surface where the house says how far through it is. */
    const clock = clockLine(cell.candidate?.media);
    if (clock && artEnabled()) {
      const sub = document.createElement("p");
      sub.className = "cell__clock measured";
      sub.textContent = `${clock.elapsed} −${clock.remaining}`;
      node.appendChild(sub);
    }

    /* AFTER the text, so the DOM order is eyebrow → line → clock → picture and
       a screen reader gets the answer before the illustration. CSS places it. */
    const art = artNode(cell.candidate);
    if (art) {
      node.appendChild(art);
      node.dataset.cellArt = cell.candidate.image;
      node.dataset.hasArt = "1";
    }

    frag.appendChild(node);
  }

  stripCellImages(host);
  host.replaceChildren(frag);
  host.dataset.template = composition.template;
  return composition;
}

/** Symmetric teardown. Called when depth 2 is left, and by the vocabulary card
 *  when it takes the lattice over. */
function stripCellImages(host) {
  for (const img of host.querySelectorAll("img")) img.removeAttribute("src");
}

export function clearSpread() {
  const host = lattice();
  if (!host) return;
  stripCellImages(host);
  host.replaceChildren();
  delete host.dataset.template;
}

/** The mounted template's name, or null. For __v3(). */
export function spreadMounted() {
  return lattice()?.dataset.template ?? null;
}
