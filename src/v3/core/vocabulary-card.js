/* ═══════════════════════════════════════════════════════════════════════════
   THE VOCABULARY CARD — depth 2's other tenant.

   Two voice paths reach depth 2 directly: "what can I say", and the third-strike
   repair. Both used to arrive at an empty lattice and black the wall out
   mid-sentence — worst of all on the repair path, where the person is already
   not being understood and the screen choosing that moment to go dark is the
   point they stop talking to it.

   So this renders what depth 2 owes an ASK, as distinct from what the composer
   renders for a DWELL — and, the load-bearing half, reports whether it has
   anything to show at all. The caller must not deepen on a false.

   Since Phase 2 the lattice has two tenants, so this one takes it over
   explicitly rather than by writing over the top: clearSpread() first, always.
   The composer cannot do the reverse to this card, because the attention tick
   only ever composes while the surface is at FIELD or GLANCE.
   ═══════════════════════════════════════════════════════════════════════════ */

import { vocabularyFor } from "../../js/services/vocabulary.js";
import { clearSpread } from "./spread.js";

const MAX = 6;   // a glance, not a document

let mounted = false;

function lattice() {
  return document.getElementById("spread-lattice");
}

/**
 * Populate depth 2 with what the house can currently be asked.
 * @returns {boolean} false when there is nothing offerable — the caller must
 *          then stay at its current depth rather than show an empty screen.
 */
export function renderVocabularyCard(snapshot) {
  const host = lattice();
  if (!host) return false;

  const phrases = vocabularyFor(snapshot, { limit: MAX });
  if (phrases.length === 0) {
    clearVocabularyCard();
    return false;
  }

  const cell = document.createElement("div");
  cell.className = "cell cell--dominant vocab";
  cell.dataset.cell = "vocabulary";

  const lead = document.createElement("p");
  lead.className = "said said--2";
  lead.textContent = "You can ask me";

  const list = document.createElement("ul");
  list.className = "vocab__list";
  for (const phrase of phrases) {
    const li = document.createElement("li");
    li.className = "vocab__item";
    li.textContent = phrase;      // textContent, never innerHTML — these are data
    list.appendChild(li);
  }

  cell.append(lead, list);
  clearSpread();                  // the hand-over, stated rather than implied
  host.replaceChildren(cell);
  mounted = true;
  return true;
}

/** Symmetric teardown, called when depth 2 is left. Emptying the node is
 *  delegated so there is exactly one place that knows how to leave the lattice
 *  in a clean state — otherwise this would strand the composer's bookkeeping. */
export function clearVocabularyCard() {
  clearSpread();
  mounted = false;
}

export function vocabularyCardMounted() {
  return mounted;
}
