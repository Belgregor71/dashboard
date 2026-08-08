/* ═══════════════════════════════════════════════════════════════════════════
   THE BRIEFING — depth 3. "brief me", and the morning window.

   This carries step 3.4, which the migration plan mis-specified twice and
   deferred into Phase 4 for two reasons worth restating where the code is:

   1. It was scheduled as a depth-2 arrival. Since Phase 2, depth 2 is a
      COMPOSITION built from ranked candidates — several things at once. A
      briefing is one thing at length, which is depth 3's shape exactly.
   2. There is no briefing candidate in candidateSources.js and never was, so
      the "route it to the queue" version of the plan had nothing to route.

   ── The two-sentence cap, used on purpose ───────────────────────────────────

   The briefing is the longest thing the house ever says and the cap exists
   because of it: the Rabbit R1 post-mortem's 9.2-second average reply is the
   canonical failure, and it is a failure of listening, not of writing. So the
   voice speaks the opening two sentences and THE SCREEN CARRIES THE REST. This
   is the one subject that returns its own `speech`, because its text does not
   exist until it has been generated and no pure answerer could have it.

   ⚠ The generation is a real network call to a real model. It is bounded here
   rather than trusted: `generateBriefing` caches per type for 30 minutes and
   dedupes in flight, so the normal path is a cache hit and instant — but a cold
   Ollama fallback has taken 60s+, and a voice turn held open for a minute is
   worse than no briefing.
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, prose } from "./dom.js";
import { generateBriefing, currentBriefingType } from "../../js/modules/aiBriefing.js";
import { capSentences } from "../../js/services/localAnswers.js";

/* Long enough for a cache miss against Claude, short enough that the room does
   not conclude the wall is broken. A cold Ollama fallback will lose this race
   and the turn falls through to a lane that can answer — which is the correct
   outcome, not a degraded one. */
const GENERATE_TIMEOUT_MS = 12_000;

/* The briefing is prose, and prose needs breaks. The model writes it as
   sentences with no markup, so paragraphs are made here: roughly two sentences
   each, which at 96px is about the width of the safe area. */
function paragraphs(text) {
  const sentences = String(text).match(/[^.!?]+[.!?]+(\s|$)/g) ?? [String(text)];
  const out = [];
  for (let i = 0; i < sentences.length; i += 2) {
    out.push(sentences.slice(i, i + 2).join("").trim());
  }
  return out.filter(Boolean);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms))
  ]);
}

const HEADINGS = { morning: "This morning", evening: "Tonight" };

/**
 * @param {object}  [opts]
 * @param {string}  [opts.type]   "morning" | "evening"; defaults to the clock
 * @param {boolean} [opts.speaks] whether the house should read the opening out
 *                                loud. True when asked for, true at the window;
 *                                there is currently no silent path, but the
 *                                caller owning that decision keeps it from
 *                                becoming a property of the subject.
 * @returns {Promise<{node, teardown, speech, refs}|null>}
 */
export async function showBriefing({ type = currentBriefingType(), speaks = true } = {}) {
  let summary = null;
  try {
    summary = await withTimeout(generateBriefing({ type }), GENERATE_TIMEOUT_MS);
  } catch {
    summary = null;                 // upstream down, no key, 502 — all the same here
  }

  const text = typeof summary === "string" ? summary.trim() : "";
  /* No text, no subject. A briefing screen with nothing on it is worse than no
     briefing: it is the surface having moved for a reason the room cannot see,
     which is the one clause of the calm law that survived the rewrite. */
  if (!text) return null;

  const { node, teardown } = frame("briefing");
  node.dataset.cell = "briefing";
  node.appendChild(title(HEADINGS[type] ?? "The briefing"));

  const body = document.createElement("div");
  body.className = "subject__prose-stack";
  for (const para of paragraphs(text)) body.appendChild(prose(para));
  node.appendChild(body);

  return {
    node,
    teardown,
    // The headline, not the recital. The screen has the whole thing.
    speech: speaks ? capSentences(text) : null,
    refs: ["briefing"]
  };
}
