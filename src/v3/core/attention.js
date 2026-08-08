/* ═══════════════════════════════════════════════════════════════════════════
   ATTENTION — the house's own opinion about what is worth looking at.

   Step 1.3 of docs/design/V3-MIGRATION.md. The decision layer runs here
   unchanged: `candidateSources` and `attentionEngine` are the incumbent's own
   modules, imported rather than reimplemented, because the whole finding of the
   migration audit was that they are already DOM-free. What was missing was a way
   to hand them the house without a rendered page to scrape it out of, and that
   is `houseSnapshot()` — 1.2 — feeding them here.

   WHAT THIS DOES NOT DO YET. It does not move the surface. Mapping the queue's
   bands onto depth is 1.4 and real presence is 1.5, and doing either early would
   put a wall in front of the room that changes for reasons nobody has verified
   the engine gets right. So this tick reads the answer, publishes it, and stops
   — which also means it can be watched on the live wall for a while before it is
   given any authority. `window.__v3().attention` is the whole of its output.

   THE MODE IS BORROWED, NOT SENSED. `selectForMode` gates on a presence mode:
   AMBIENT admits interrupts only, GLANCE the ordinary queue, DWELL the deeper
   stack. V3 has no presence yet, so the mode is derived from the depth the
   surface is already at. That is deliberately backwards — depth should follow
   attention, not lead it — and it inverts in 1.4. Until then it is at least
   honest: at rest the engine is asked the same question the resting screen is
   answering, and nothing is invented to fill the gap.
   ═══════════════════════════════════════════════════════════════════════════ */

import { collectSources } from "../../js/services/candidateSources.js";
import { initAttentionEngine, getSelection } from "../../js/services/attentionEngine.js";
import { houseSnapshot } from "../../js/services/houseSnapshot.js";
import { MODE } from "../../js/services/attentionRank.js";
import { DEPTH, getDepth } from "./depth.js";

/* The incumbent's focusHero tick, matched exactly. Not a number worth choosing
   independently: two surfaces asking the same engine at different rates would
   make any comparison between them meaningless while both are running. */
const TICK_MS = 30_000;

let last = null;
let timer = null;

function modeForDepth(depth) {
  if (depth >= DEPTH.SPREAD) return MODE.DWELL;
  if (depth >= DEPTH.GLANCE) return MODE.GLANCE;
  return MODE.AMBIENT;
}

/**
 * One pass: read the house, score it, keep the answer.
 *
 * Synchronous by construction. `houseSnapshot()` is a map lookup against the
 * live entity cache plus a prefetched HTTP cache, and `getSelection()` is the
 * engine's own synchronous read — the async half (the briefing context and the
 * AI phrasing) runs on the engine's internal 5-minute refresh, never here.
 */
export function tickAttention(now = new Date()) {
  const state = houseSnapshot({ now });
  const sources = collectSources(state);
  const mode = modeForDepth(getDepth());
  const sel = getSelection({ sources, now, mode });

  last = {
    mode,
    hero: sel.hero ? { id: sel.hero.id, source: sel.hero.source, text: sel.hero.text, score: sel.hero.score } : null,
    stack: sel.stack.map((c) => ({ id: c.id, source: c.source, score: c.score })),
    queue: sel.queue.map((c) => ({ id: c.id, source: c.source, score: c.score, band: c.band ?? null })),
    sourceCount: sources.length,
    at: now.toISOString()
  };
  return last;
}

/** The last selection, or null before the first tick. */
export function lastSelection() {
  return last;
}

export function initAttention() {
  // The engine's own init: the briefing/insight refresh on its 5-minute cycle,
  // plus __forceCandidate and __refreshAttention, which are how the queue is
  // driven over CDP on the kiosk. Both surfaces get the same debug handles.
  initAttentionEngine();

  tickAttention();

  // Init-once, per CLAUDE.md's kiosk discipline. There is no per-event path in
  // this module and so nothing to tear down symmetrically.
  if (!timer) timer = setInterval(() => tickAttention(), TICK_MS);
}
