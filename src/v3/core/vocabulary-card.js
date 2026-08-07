/* ═══════════════════════════════════════════════════════════════════════════
   THE VOCABULARY CARD — depth 2's only tenant, until the composer exists.

   Depth 2 is reserved for the composed spread, which is not built yet. Two
   paths already reach it: "what can I say", and the third-strike repair. Both
   used to arrive at an empty lattice and black the wall out mid-sentence —
   worst of all on the repair path, where the person is already not being
   understood and the screen choosing that moment to go dark is the point they
   stop talking to it.

   So this renders the one thing depth 2 can honestly show today, and — the
   load-bearing half — reports whether it has anything to show at all. The
   caller must not deepen on a false.
   ═══════════════════════════════════════════════════════════════════════════ */

import { vocabularyFor } from "../../js/services/vocabulary.js";

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
  host.replaceChildren(cell);
  mounted = true;
  return true;
}

/** Symmetric teardown, called when depth 2 is left. */
export function clearVocabularyCard() {
  const host = lattice();
  if (host) host.replaceChildren();
  mounted = false;
}

export function vocabularyCardMounted() {
  return mounted;
}
