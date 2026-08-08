/* ═══════════════════════════════════════════════════════════════════════════
   ATTENTION — the house's own opinion about what is worth looking at, and
   (since 1.4) its permission to act on it.

   Steps 1.3–1.4 of docs/design/V3-MIGRATION.md. The decision layer runs here
   unchanged: `candidateSources` and `attentionEngine` are the incumbent's own
   modules, imported rather than reimplemented, because the migration audit found
   they are already DOM-free. What was missing was a way to hand them the house
   without a rendered page to scrape it out of — `houseSnapshot()` (1.2), fed by
   the HA stream (1.1).

   ── 1.4, and the correction the plan needed ──────────────────────────────────

   The plan describes 1.4 as mapping the queue's BANDS to depth: `must` → D1
   regardless, `should` → D1 on presence. There is no `band` field. Bands exist
   only as a documented score ladder in candidateSources.js —

       Interrupt 90–100 · High 70–89 · Medium 50–69 · Low 40–49

   — plus a real boolean, `interrupt`, on the candidates that carry it. So the
   rule is expressed against what the engine actually emits: `must` is
   `interrupt`, `should` is the High floor at 70. Everything at Medium and Low is
   the ordinary readout traffic — commute, now playing, tonight's menu, all
   scoring 40–42 on the live wall — and none of it earns the screen. A surface
   that lit up for "Chicken Fajitas" would be a surface nobody trusts.

   ── The inversion ────────────────────────────────────────────────────────────

   In 1.3 the presence mode was borrowed from the current depth, which was
   backwards on purpose and marked for inversion here. It is now taken from
   presence (1.5), and depth follows attention rather than leading it. That is
   the whole of what the plan means by "the house pushes you deeper".

   AMBIENT does useful work for free: `selectForMode` already filters an absent
   room to interrupt-only, so the "regardless of presence" half of the rule is
   the engine's own behaviour rather than a special case here.

   ── What this deliberately does NOT do ───────────────────────────────────────

   It never reaches depth 2. The plan's "30 s dwell → D2" is left unbuilt because
   `#spread-lattice` renders EMPTY until the composer lands in Phase 2 — and
   `e3e9630` already had to add a guard against entering SPREAD empty after it
   blacked the wall out mid-sentence. Putting that on a dwell timer would rebuild
   the same bug with a slower fuse. Depth 2 is Phase 2's to open.

   It also never fights the voice. Voice owns depth 2 and 3, and `deepen()` falls
   through to `sustain()` when the target is shallower than the current depth —
   which would silently re-arm a voice-held SUBJECT every 30 s and make it
   permanent. So attention only ever acts while the surface is at FIELD or
   GLANCE, and only writes the glance cell while it is the reason the surface is
   there.

   Recession needs no code: `setDepth` arms its own hold (GLANCE 90 s) and steps
   down one level when it expires. The only recession worth adding on top is
   presence loss, which is faster than waiting out the hold.
   ═══════════════════════════════════════════════════════════════════════════ */

import { collectSources } from "../../js/services/candidateSources.js";
import { initAttentionEngine, getSelection } from "../../js/services/attentionEngine.js";
import { houseSnapshot } from "../../js/services/houseSnapshot.js";
import { MODE } from "../../js/services/attentionRank.js";
import { DEPTH, deepen, setDepth, getDepth, onDepth } from "./depth.js";
import { initPresence, onPresence, isPresent, isDwelling } from "./presence.js";

/* The incumbent's focusHero tick, matched exactly. Not a number worth choosing
   independently: two surfaces asking the same engine at different rates would
   make any comparison between them meaningless while both are running. */
const TICK_MS = 30_000;

/* The High band floor from candidateSources.js. Also QUIET_MIN_SCORE in
   attentionRank.js, which is the same threshold for the same reason: this is the
   line between something worth surfacing and chatter. */
const HIGH_MIN_SCORE = 70;

const REASON_PREFIX = "attention:";

let last = null;
let timer = null;
let owningGlance = false;

const el = { cell: null, said: null, measured: null };

function modeForPresence() {
  if (isDwelling()) return MODE.DWELL;
  if (isPresent()) return MODE.GLANCE;
  return MODE.AMBIENT;
}

/** Does this candidate earn the surface, or is it just the day's readouts? */
function earnsGlance(hero) {
  if (!hero) return false;
  return hero.interrupt === true || hero.score >= HIGH_MIN_SCORE;
}

/* ── The glance cell ────────────────────────────────────────────────────────
   Depth 1 has exactly one cell in index.html, and until 1.4 nothing but voice
   ever filled it — so a depth change would have revealed two empty paragraphs.
   This is not the composer: it writes the winning candidate's own text into the
   cell that already exists. `data-cell` is re-addressed to the candidate's
   source so the voice deixis highlight keeps working on whatever is up.
─────────────────────────────────────────────────────────────────────────── */
function renderGlance(hero) {
  if (!el.cell) return;
  el.cell.dataset.cell = hero.source ?? "house";
  if (el.said) el.said.textContent = hero.text ?? "";
  if (el.measured) el.measured.textContent = "";
}

function clearGlance() {
  if (!el.cell) return;
  if (el.said) el.said.textContent = "";
  if (el.measured) el.measured.textContent = "";
}

/**
 * One pass: read the house, score it, and act only if something earned it.
 *
 * Synchronous by construction. `houseSnapshot()` is a map lookup against the
 * live entity cache plus a prefetched HTTP cache, and `getSelection()` is the
 * engine's own synchronous read — the async half (the briefing context and the
 * AI phrasing) runs on the engine's internal 5-minute refresh, never here.
 */
export function tickAttention(now = new Date()) {
  const state = houseSnapshot({ now });
  const sources = collectSources(state);
  const mode = modeForPresence();
  const sel = getSelection({ sources, now, mode });

  const hero = sel.hero;
  const earned = earnsGlance(hero);

  /* Act only from the shallow end. At SPREAD or SUBJECT the room is either
     mid-conversation or looking at one thing on purpose, and a 30 s tick has no
     business interrupting either. */
  let acted = null;
  if (earned && getDepth() <= DEPTH.GLANCE) {
    owningGlance = true;
    renderGlance(hero);
    // Sets owningGlance-compatible reason BEFORE the depth listeners run, since
    // setDepth dispatches synchronously.
    deepen(DEPTH.GLANCE, `${REASON_PREFIX}${hero.source}`);
    acted = hero.id;
  }

  last = {
    mode,
    present: isPresent(),
    dwelling: isDwelling(),
    depth: getDepth(),
    earned,
    acted,
    owningGlance,
    hero: hero ? { id: hero.id, source: hero.source, text: hero.text, score: hero.score, interrupt: hero.interrupt === true } : null,
    stack: sel.stack.map((c) => ({ id: c.id, source: c.source, score: c.score })),
    queue: sel.queue.map((c) => ({ id: c.id, source: c.source, score: c.score, interrupt: c.interrupt === true })),
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
  el.cell = document.getElementById("glance-cell");
  el.said = document.getElementById("glance-said");
  el.measured = document.getElementById("glance-measured");

  initPresence();

  // The engine's own init: the briefing/insight refresh on its 5-minute cycle,
  // plus __forceCandidate and __refreshAttention, which are how the queue is
  // driven over CDP on the kiosk. Both surfaces get the same debug handles.
  initAttentionEngine();

  /* Hand the cell back the moment the surface moves for someone else's reason —
     a spoken answer writes the same node, and attention overwriting it 30 s
     later would talk over the house. */
  onDepth((next, _prev, reason) => {
    if (!String(reason ?? "").startsWith(REASON_PREFIX)) owningGlance = false;
    if (next === DEPTH.FIELD) {
      owningGlance = false;
      clearGlance();
    }
  });

  /* The one recession worth adding: an empty room should not wait out a 90 s
     hold. Only from GLANCE — deeper than that is the voice's, and someone who
     walked out mid-answer will be receded by the hold soon enough. */
  onPresence(({ present }) => {
    if (present) return;
    if (getDepth() === DEPTH.GLANCE && owningGlance) setDepth(DEPTH.FIELD, "attention:absent");
  });

  tickAttention();

  // Init-once, per CLAUDE.md's kiosk discipline. There is no per-event path in
  // this module and so nothing to tear down symmetrically.
  if (!timer) timer = setInterval(() => tickAttention(), TICK_MS);
}
