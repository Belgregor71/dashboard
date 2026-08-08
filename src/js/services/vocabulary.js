/* ═══════════════════════════════════════════════════════════════════════════
   VOCABULARY — teaching the house's language, one line at a time.

   Widening the local lane from 8 phrases to 33 is worth nothing if nobody in
   the house knows the 25 new ones. Discoverability — not knowing WHAT to say,
   and not knowing HOW to phrase it — is second only to recognition accuracy
   among the reasons voice interfaces fail, and the research finding worth
   acting on is that BOTH strategies beat baseline independently: unprompted
   suggestions, and help on request. So this module serves both.

   THE RULE THAT MAKES IT HONEST: never suggest something the house cannot
   currently answer. A rail that offers "how did I sleep" on a night the CPAP
   sent nothing teaches the family that the suggestions are decorative, and
   after two of those they stop reading it.

   That rule is not maintained by hand. Candidates are filtered by actually
   running them through the lane against the live snapshot — if answer() comes
   back null, the phrase is not offered. One source of truth, and it cannot
   drift from what the lane really does.
   ═══════════════════════════════════════════════════════════════════════════ */

import { matchIntent } from "./localIntents.js";
import { answer } from "./localAnswers.js";

/* Phrased the way a person actually speaks, because teaching the CAPABILITY
   without the PHRASING is half the problem. These are shown in quotes and are
   meant to be repeatable verbatim. */
const CANDIDATES = [
  { utterance: "what's the weather", weight: 1 },
  { utterance: "do I need an umbrella", weight: 3, when: (s) => rainLikely(s) },
  { utterance: "do I need a jacket", weight: 2, when: (s) => coolOut(s) },
  { utterance: "do I need sunscreen", weight: 2, when: (s) => (s.weather?.now?.uv ?? 0) >= 3 },
  { utterance: "what's the weather tomorrow", weight: 1 },
  { utterance: "is it windy", weight: 1 },
  { utterance: "what's on today", weight: 2, when: (s, d) => d.hour < 12 },
  { utterance: "what's on tomorrow", weight: 1, when: (s, d) => d.hour >= 17 },
  { utterance: "what's next", weight: 2 },
  { utterance: "am I free", weight: 1 },
  { utterance: "who's home", weight: 2 },
  { utterance: "what bins go out", weight: 3, when: (s) => s.bins?.due === true },
  { utterance: "what's playing", weight: 2, when: (s) => (s.media?.length ?? 0) > 0 },
  { utterance: "how did I sleep", weight: 3, when: (s, d) => d.hour < 11 },
  { utterance: "how's the traffic", weight: 2, when: (s, d) => d.hour >= 6 && d.hour < 10 },
  { utterance: "where's the cheapest petrol", weight: 1 },
  { utterance: "what's on the shopping list", weight: 2 },
  { utterance: "what's on my list", weight: 1 },
  { utterance: "who was at the door", weight: 3, when: (s) => !!s.camera?.lastEvent },
  { utterance: "when's sunset", weight: 1, when: (s, d) => d.hour >= 14 && d.hour < 19 },
  { utterance: "when's sunrise", weight: 1, when: (s, d) => d.hour < 7 },
  { utterance: "show me the driveway", weight: 2 },
  { utterance: "show me the front door", weight: 1 },
  /* The Phase 4 subjects. Only the three whose data the truth filter can
     actually see from this snapshot — "show me the year" is genuinely useful
     and is deliberately NOT here, because its photographs come from Immich and
     nothing in the snapshot knows whether this date has any. Offering it on a
     day with none is exactly the "the rail is decorative" lesson at the top of
     this file, learned in advance rather than after. */
  { utterance: "show me my day", weight: 2, when: (s, d) => d.hour < 14 },
  { utterance: "show me the shopping list", weight: 1, when: (s) => (s.todos?.shopping?.length ?? 0) > 0 },
  { utterance: "show me the recipe", weight: 2, when: (s, d) => Boolean(s.menu) && d.hour >= 15 },
  { utterance: "what time is it", weight: 1 },
  { utterance: "brief me", weight: 2, when: (s, d) => d.hour < 10 }
];

function rainLikely(s) {
  if (s.nowcast) return true;
  return (s.weather?.now?.rain_chance_pct ?? 0) >= 30;
}

function coolOut(s) {
  const t = s.weather?.now?.feels_like_c ?? s.weather?.now?.temp_c;
  return typeof t === "number" && t < 18;
}

/* Utterances the lane cannot answer from data — they navigate or fire a
   routine — so answer() returns null for them by design and they must be
   allowed through the truth filter rather than silently dropped. */
const ALWAYS_TRUE = new Set(["show.camera", "show.sky", "action.goodnight"]);
const NOT_DATA_BACKED = new Set(["brief me"]);

/**
 * The phrases the house can honestly offer right now, best first.
 *
 * @param {object} snapshot the same snapshot the answerers read
 * @param {object} [opts]
 * @param {Date}   [opts.now]
 * @param {number} [opts.limit]
 * @returns {string[]}
 */
export function vocabularyFor(snapshot = {}, { now = new Date(), limit = 12 } = {}) {
  const ctx = { hour: now.getHours() };

  const offerable = CANDIDATES.filter(({ utterance, when }) => {
    if (when && !when(snapshot, ctx)) return false;
    if (NOT_DATA_BACKED.has(utterance)) return true;

    const intent = matchIntent(utterance);
    if (!intent) return false;                 // a candidate the matcher lost
    if (ALWAYS_TRUE.has(intent.id)) return true;
    return answer(intent, snapshot) !== null;  // the truth filter
  });

  return offerable
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((c) => c.utterance);
}

/**
 * One phrase for the ambient rail. Rotates deterministically through the
 * currently-offerable set rather than picking at random, so the family sees a
 * spread over a day instead of the same two lines by luck.
 */
export function railPhrase(snapshot = {}, { now = new Date(), tick = 0 } = {}) {
  const list = vocabularyFor(snapshot, { now, limit: 12 });
  if (list.length === 0) return null;
  return list[tick % list.length];
}

/** Every candidate, for the tests — so a phrase cannot be added here without
 *  the matcher being able to resolve it. */
export const ALL_CANDIDATES = Object.freeze(CANDIDATES.map((c) => c.utterance));
