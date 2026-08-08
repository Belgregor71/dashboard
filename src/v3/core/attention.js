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

   ── Depth 2, opened in Phase 2 ───────────────────────────────────────────────

   1.4 left the plan's "30 s dwell → D2" deliberately unbuilt, because
   `#spread-lattice` rendered EMPTY and `e3e9630` had already had to guard
   against entering SPREAD empty after it blacked the wall out mid-sentence. The
   composer removes that reason, so the dwell rule lands here now — with the
   guard kept as the actual condition rather than as a timer: the surface
   deepens only when `renderSpread()` HAS ALREADY PUT SOMETHING THERE. A null
   composition is not a slower fuse, it is simply no depth change.

   Note what does NOT gate the spread: the High band. Depth 1 is the house
   interrupting you and has to clear score 70, or the wall lights up for
   "Chicken Fajitas". Depth 2 is the opposite transaction — you stayed in the
   room for thirty seconds, so the house lays out the ordinary day. Low-band
   readouts are exactly what belongs there, and the person standing in front of
   it is the cause the room can see.

   ── Not fighting the voice ───────────────────────────────────────────────────

   Voice owns depth 2 and 3, and `deepen()` falls through to `sustain()` when the
   target is shallower than the current depth — which would silently re-arm a
   voice-held SUBJECT every 30 s and make it permanent. So attention only ever
   ACTS while the surface is at FIELD or GLANCE. The one exception is a spread
   this module opened itself: while the room keeps dwelling, that is sustained
   rather than allowed to cycle 2 → 1 → 0 → 2 under someone still standing
   there. `ownsDepth()` is what keeps the exception from becoming the trap —
   without it, `sustain()` at SUBJECT is exactly the forever-hold above.

   Recession is otherwise the depth module's: `setDepth` arms its own hold
   (SPREAD 45 s, GLANCE 90 s) and steps down one level when it expires. Two
   things are worth adding on top. Presence loss, which is faster than waiting
   out the hold. And the fact that a spread must recede INTO something: its
   dominant candidate is written to the glance cell as the spread is mounted, so
   the step down to GLANCE lands on the one line the spread was about instead of
   on two empty paragraphs.
   ═══════════════════════════════════════════════════════════════════════════ */

import { collectSources } from "../../js/services/candidateSources.js";
import { initAttentionEngine, getSelection } from "../../js/services/attentionEngine.js";
import { houseSnapshot } from "../../js/services/houseSnapshot.js";
import { MODE } from "../../js/services/attentionRank.js";
import { DEPTH, deepen, sustain, setDepth, getDepth, getReason, onDepth } from "./depth.js";
import { initPresence, onPresence, isPresent, isDwelling } from "./presence.js";
import { renderSpread, spreadMounted, setSaidText } from "./spread.js";

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

/* ── Announced events ───────────────────────────────────────────────────────
   Phase 3. Things that HAPPEN — someone arriving, and whatever joins them —
   rather than things that are merely true. They enter the queue as ordinary
   candidates instead of writing the surface themselves, which is the whole
   point: an event that painted the glance cell directly would be a second
   author of a node the composer and the voice already share, and the ownership
   bug Phase 2 spent a spec on would come straight back in a third shape.

   Going through the queue means an announcement gets the ranking, the
   interrupt/High rule, the personality voice, quiet mode and the cooldowns for
   free — and, the part that matters most here, `expiresAt` decay. There is no
   timer in this list and nothing to tear down: a stale announcement is dropped
   by `rankQueue` the next time anything asks.
─────────────────────────────────────────────────────────────────────────── */
let announced = [];

const el = { cell: null, said: null, measured: null };

function modeForPresence() {
  if (isDwelling()) return MODE.DWELL;
  if (isPresent()) return MODE.GLANCE;
  return MODE.AMBIENT;
}

/* ── Ownership ──────────────────────────────────────────────────────────────
   Is the surface at its current depth because of us?

   ASKED, NEVER REMEMBERED. This was a flag maintained from an `onDepth`
   subscription until Phase 2's spec caught it lying: `sustain()` re-arms a depth
   WITHOUT CHANGING IT, so no listener fires, so a flag cannot see the moment the
   voice takes over a depth attention opened. The vocabulary card hit exactly
   that — it replaced the composer's lattice mid-conversation and the next
   30-second tick took the screen straight back off it, silently, with nothing
   thrown anywhere. The depth module's own reason cannot go stale this way.
─────────────────────────────────────────────────────────────────────────── */
function ownsDepth() {
  return String(getReason() ?? "").startsWith(REASON_PREFIX);
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
  // Same length rule as the spread's dominant cell — css/type.css has carried
  // `.said[data-len="long"]` since V3 shipped and nothing ever set it, so a
  // 60-character line has been trying to hold 132px this whole time.
  setSaidText(el.said, hero.text ?? "");
  if (el.measured) el.measured.textContent = "";
}

function clearGlance() {
  if (!el.cell) return;
  setSaidText(el.said, "");
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
  /* Announcements ride in as sources so the engine treats them exactly like
     anything the house derived for itself — same ranking, same phrasing, same
     gates. Pruned here as well as by rankQueue, or the list would grow for the
     lifetime of the page: dropping a candidate from the QUEUE does not drop it
     from the array it came out of, and this page runs for weeks. */
  announced = announced.filter((c) => c.expiresAt == null || c.expiresAt > now.getTime());
  const sources = [...collectSources(state), ...announced];
  const mode = modeForPresence();
  const sel = getSelection({ sources, now, mode });

  const hero = sel.hero;
  const earned = earnsGlance(hero);

  let acted = null;

  /* ── Depth 2 ──────────────────────────────────────────────────────────────
     The dwell rule, and it is tried BEFORE depth 1 so that a tick which is going
     to reach the spread does not first flick the surface through the glance.

     Composed first and deepened only on a real composition: the lattice is
     never empty at the moment the depth flips, and that ordering is the whole
     guard — which is exactly why this is not a dwell timer.

     `sustain` rather than `deepen` when we are already there, because a person
     still in the room is a live cause and letting the 45 s hold expire under
     them would cycle the wall 2 → 1 → 0 → 2 for no reason they can see.

     TWO fences on that, and each one is a bug that was actually reachable.
     `ownsDepth()`, or sustaining a depth the voice opened becomes the forever-
     hold in the header. And `spreadMounted()`, because the vocabulary card takes
     this same lattice without the depth ever changing — the reason alone would
     still say "attention:spread" while the card is what is on the wall.
  ─────────────────────────────────────────────────────────────────────────── */
  let composition = null;
  const atOwnSpread = getDepth() === DEPTH.SPREAD && ownsDepth() && spreadMounted() !== null;
  if (mode === MODE.DWELL && (getDepth() <= DEPTH.GLANCE || atOwnSpread)) {
    composition = renderSpread(sel);
    if (composition) {
      // The spread recedes into its own dominant line rather than into two empty
      // paragraphs. Written before the depth change, same as below.
      renderGlance(composition.cells[0].candidate);
      if (atOwnSpread) sustain(`${REASON_PREFIX}spread`);
      else deepen(DEPTH.SPREAD, `${REASON_PREFIX}spread`);
      acted = composition.cells[0].id;
    } else if (atOwnSpread) {
      /* The house ran out of things to lay out while someone is still standing
         there. renderSpread has already emptied the lattice, so holding depth 2
         for the rest of its 45 s would be the blank-wall bug with a slower fuse.
         Step down onto the glance cell, which still carries the line this spread
         was about. */
      setDepth(DEPTH.GLANCE, `${REASON_PREFIX}spread-spent`);
    }
  }

  /* Act only from the shallow end. At SPREAD or SUBJECT the room is either
     mid-conversation or looking at one thing on purpose, and a 30 s tick has no
     business interrupting either. */
  if (earned && !composition && getDepth() <= DEPTH.GLANCE) {
    renderGlance(hero);
    // The reason is set BEFORE the depth listeners run, since setDepth
    // dispatches synchronously — and the reason is what ownership is read from.
    deepen(DEPTH.GLANCE, `${REASON_PREFIX}${hero.source}`);
    acted = hero.id;
  }

  last = {
    mode,
    present: isPresent(),
    dwelling: isDwelling(),
    depth: getDepth(),
    reason: getReason(),
    earned,
    acted,
    owns: ownsDepth(),
    template: composition?.template ?? spreadMounted(),
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

/**
 * Put an event into the queue, and act on it now rather than up to 30 s from
 * now — the tick's cadence is right for things that are true and far too slow
 * for things that just happened.
 *
 * The candidate is an ordinary one and must carry `expiresAt`: an announcement
 * with no end is a claim about the present that becomes a lie, and there is no
 * timer here to clean it up. Callers that want it on the screen regardless of
 * whether anyone is in the room set `interrupt`.
 *
 * @returns the resulting selection, so the caller can see whether it landed.
 */
export function announce(candidate, now = new Date()) {
  if (!candidate?.id || !candidate.text) return null;
  // Replace rather than append on a repeat id: two arrivals for the same person
  // are one fact, not two, and the queue should not be able to hold both.
  announced = announced.filter((c) => c.id !== candidate.id);
  announced.push({ cooldownMs: 0, ...candidate });
  return tickAttention(now);
}

/** What is currently announced, for __v3(). */
export function announcements() {
  return announced.map((c) => ({ id: c.id, source: c.source, score: c.score, expiresAt: c.expiresAt ?? null }));
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

  /* Nothing is shown at the field, so nothing may be left there. Ownership is
     not tracked here any more — see ownsDepth() — because a flag maintained from
     this callback cannot see a `sustain()`, which is how the voice takes a depth
     over without changing it. */
  onDepth((next) => {
    if (next === DEPTH.FIELD) clearGlance();
  });

  /* The one recession worth adding: an empty room should not wait out a hold.
     Only from a depth this module opened — deeper than that is the voice's, and
     someone who walked out mid-answer will be receded by the hold soon enough.
     Straight to FIELD from either, because the cause for both was the person. */
  onPresence(({ present }) => {
    if (present) return;
    const ours = getDepth() === DEPTH.GLANCE || getDepth() === DEPTH.SPREAD;
    if (ours && ownsDepth()) setDepth(DEPTH.FIELD, "attention:absent");
  });

  tickAttention();

  // Init-once, per CLAUDE.md's kiosk discipline. There is no per-event path in
  // this module and so nothing to tear down symmetrically.
  if (!timer) timer = setInterval(() => tickAttention(), TICK_MS);
}
