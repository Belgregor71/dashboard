/* ═══════════════════════════════════════════════════════════════════════════
   VOICE RAIL — one line, teaching the house's language by example.

   The lane knows 33 phrases. Nobody in the house knows 25 of them, and there
   is no menu to browse on a screen with no touch input. So the house teaches
   its own vocabulary the only way it can: by quietly showing one thing you
   could say, changing it slowly, and never asking to be read.

   Deliberately ONE line, never a list. A menu on the wall is something to
   ignore; a single quiet suggestion is something you absorb over weeks. The
   phrase is shown in quotes and verbatim, because knowing the capability
   without the phrasing is half of the discoverability problem.

   Everything offered is filtered through the lane against live data first, so
   the rail can only ever suggest something that would actually work right now.
   ═══════════════════════════════════════════════════════════════════════════ */

import { railPhrase, vocabularyFor } from "../services/vocabulary.js";
import { voiceSnapshot } from "../services/voiceSnapshot.js";
import { isScreensaverActive } from "./screensaver.js";
import { WEATHER_LAT, WEATHER_LON } from "../config/config.js";

const ROTATE_MS = 90_000;   // slow. It is scenery, not a carousel.
const CARD_HOLD_MS = 14_000;

let railEl = null;
let cardEl = null;
let tick = 0;
let cardTimer = null;

function snapshot() {
  return voiceSnapshot({ lat: WEATHER_LAT, lon: WEATHER_LON });
}

function paint() {
  if (!railEl) return;

  // Mode 0 belongs to the photograph. A teaching aid with nobody in the room
  // is just a lit pixel budget.
  if (isScreensaverActive()) {
    railEl.classList.remove("is-visible");
    return;
  }

  const phrase = railPhrase(snapshot(), { tick });
  if (!phrase) {
    railEl.classList.remove("is-visible");
    return;
  }
  railEl.textContent = phrase;
  railEl.classList.add("is-visible");
}

function hideCard() {
  if (cardTimer) {
    clearTimeout(cardTimer);
    cardTimer = null;
  }
  cardEl?.classList.remove("is-visible");
}

/**
 * "What can I say" — the help-on-request half. Shown, never spoken: reading a
 * menu aloud is the exact failure the two-sentence cap exists to prevent.
 * Six is a glance; more is a document.
 */
export function showVocabularyCard() {
  if (!cardEl) return false;
  const phrases = vocabularyFor(snapshot(), { limit: 6 });
  if (phrases.length === 0) return false;

  cardEl.innerHTML = "";
  for (const p of phrases) {
    const li = document.createElement("li");
    li.textContent = p;          // textContent, never innerHTML — these are data
    cardEl.appendChild(li);
  }
  cardEl.classList.add("is-visible");

  // Always a timeout, never a transition/animation event: those never fire
  // while an ancestor is display:none, which is most surfaces most of the time.
  if (cardTimer) clearTimeout(cardTimer);
  cardTimer = setTimeout(hideCard, CARD_HOLD_MS);
  return true;
}

export function initVoiceRail({ enabled = false } = {}) {
  // Flag-off is byte-identical: no element, no timer, no listener.
  if (!enabled) return;

  railEl = document.createElement("p");
  railEl.className = "voice-rail";
  railEl.setAttribute("aria-hidden", "true");   // decorative; not an announcement

  cardEl = document.createElement("ul");
  cardEl.className = "voice-vocab-card";
  cardEl.setAttribute("aria-hidden", "true");

  document.body.append(railEl, cardEl);

  paint();
  // Init-once interval, registered at startup and never re-created per event.
  setInterval(() => {
    tick += 1;
    paint();
  }, ROTATE_MS);

  window.__voiceRail = () => ({
    phrase: railEl?.textContent ?? null,
    visible: railEl?.classList.contains("is-visible") ?? false,
    offered: vocabularyFor(snapshot(), { limit: 12 })
  });
}
