/* ═══════════════════════════════════════════════════════════════════════════
   COMPOSER — which template, and what goes in which slot.

   Step 2.2 of docs/design/V3-MIGRATION.md. Given the attention engine's own
   selection, decide the shape of depth 2. It picks from grammar.js's fixed
   template set and never emits geometry of its own.

   ── What this file must NOT do, which is most of its job ─────────────────────

   It does not author, rewrite, trim, join or punctuate a single word. Every
   `text` it places is the candidate's own, already phrased upstream by
   attentionEngine — AI when `/api/ai/brief` answers, `personality.phrase()` when
   it does not. That is step 2.3, and it is already true rather than newly built:
   the honest work of 2.3 is making sure the composer does not quietly become a
   second author. So there is no fetch here, no template string interpolating a
   candidate's fields, and no fallback copy. If a candidate has nothing to say it
   is dropped, not narrated.

   It also has no IO and no DOM. `spread.js` owns the rendering; this stays pure
   so it unit-tests in plain node next to attentionRank.js.

   ── Absent is not empty ──────────────────────────────────────────────────────

   Returning `null` for "nothing to compose" and letting the caller stay where it
   is, rather than returning an empty composition, is load-bearing. `e3e9630` had
   to add a guard after an empty depth 2 blacked the wall out mid-sentence, and
   this house has produced three "not loaded read as empty" bugs in a single day.
   A caller that deepens on a null is the bug this shape exists to prevent.
   ═══════════════════════════════════════════════════════════════════════════ */

import { RECTS, chooseTemplate, MIN_CELLS, MAX_CELLS, PEER_MIN_SCORE } from "./grammar.js";

/** A candidate can only fill a cell if it has something to put in it. An empty
 *  cell is worse than a missing one: it reads as a thing that failed to load. */
function speaks(candidate) {
  return Boolean(candidate) && typeof candidate.text === "string" && candidate.text.trim() !== "";
}

/** Does this supporting candidate stand beside the dominant, or under it? */
function isPeer(candidate) {
  return candidate.interrupt === true || (candidate.score ?? 0) >= PEER_MIN_SCORE;
}

/**
 * Compose depth 2 from an attention selection.
 *
 * @param {{ hero: object|null, stack: object[], queue: object[] }} selection
 *        Straight from `getSelection()`. `stack` is used and not `queue`: the
 *        stack is what survived the presence floor, the cooldowns and the quiet
 *        gate, and composing off the raw queue would put a suppressed candidate
 *        on the wall — including one gaming quiet mode had just silenced.
 * @returns {{ template: string, cells: object[] }|null}
 *          null when there is no legal spread. The caller must NOT deepen.
 */
export function compose(selection) {
  const stack = (Array.isArray(selection?.stack) ? selection.stack : []).filter(speaks);
  if (stack.length < MIN_CELLS) return null;

  /* An interrupt is never dropped. In practice the ranking already guarantees
     this — the interrupt band is 90–100 and the stack is sorted best-first — but
     stating it as a partition rather than relying on the scores means a future
     low-scored interrupt (or a fourth one) still reaches the surface. Order
     within each group is preserved, so the ranking is otherwise untouched. */
  const musts = stack.filter((c) => c.interrupt === true);
  const rest = stack.filter((c) => c.interrupt !== true);
  const chosen = [...musts, ...rest].slice(0, MAX_CELLS);

  const template = chooseTemplate(chosen.length, {
    peer: chosen.slice(1).some(isPeer)
  });
  if (!template) return null;

  const cells = chosen.map((candidate, i) => {
    const rect = RECTS[template.cells[i]];
    return {
      rect: rect.name,
      className: rect.className,
      voice: rect.voice,
      size: rect.size,
      /* The deixis address. When the voice names something on screen, that cell
         answers — so the address has to be the candidate's source, not its slot,
         or "what about the weather" would light whichever rectangle the weather
         happened to land in today. */
      ref: candidate.source ?? "house",
      text: candidate.text,
      id: candidate.id,
      candidate
    };
  });

  return { template: template.name, cells };
}
