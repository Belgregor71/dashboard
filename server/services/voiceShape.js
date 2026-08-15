// Pure shaping helpers for the Phase 4 voice lanes (docs/vision/phase-4-voice.md).
// No imports, no I/O — unit-tested directly in tests/voice.spec.js.

// Home Assistant's /api/conversation/process reply → the dashboard's contract.
// handled=false means Assist couldn't act on it (the client falls through to
// the Claude converse lane); a malformed payload is treated the same way.
export function shapeAssistResponse(payload) {
  const response = payload?.response;
  const speech = response?.speech?.plain?.speech;
  const handled =
    typeof response?.response_type === "string" &&
    response.response_type !== "error";
  return {
    handled,
    speech: typeof speech === "string" && speech.trim() ? speech.trim() : null,
    conversationId:
      typeof payload?.conversation_id === "string" ? payload.conversation_id : null
  };
}

// The converse lane keeps a short rolling transcript for follow-up questions.
// History is bounded HERE (not trusted from the client): last MAX_TURNS turns,
// each clamped, roles forced to the two the Messages API accepts.
export const MAX_TURNS = 6;
export const MAX_TURN_CHARS = 500;

export function buildConverseMessages(text, history) {
  const turns = Array.isArray(history) ? history.slice(-MAX_TURNS) : [];
  const messages = [];
  for (const turn of turns) {
    const content = typeof turn?.text === "string" ? turn.text.trim().slice(0, MAX_TURN_CHARS) : "";
    if (!content) continue;
    const role = turn.role === "assistant" ? "assistant" : "user";
    // The Messages API requires alternating roles starting with "user".
    if (messages.length === 0 && role === "assistant") continue;
    if (messages.length > 0 && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += `\n${content}`;
      continue;
    }
    messages.push({ role, content });
  }
  const current = String(text).trim().slice(0, MAX_TURN_CHARS);
  if (messages.length > 0 && messages[messages.length - 1].role === "user") {
    messages[messages.length - 1].content += `\n${current}`;
  } else {
    messages.push({ role: "user", content: current });
  }
  return messages;
}

// The converse system prompt, with or without house-knowledge context
// (docs/design/VAULT.md). Lives here rather than in the route so the property
// that matters is directly testable: with no context this is BYTE-IDENTICAL to
// the pre-vault prompt, which is what makes the vault lane genuinely inert when
// it is switched off rather than merely quiet.
export const NO_KNOWLEDGE_LINE =
  "If you don't know something about this specific house (device states, schedules), say so plainly rather than guessing.";

// The house voice is deliberately loud (VOICE_REGISTER: "Kath & Kim energy"),
// and the knowledge base now holds real deaths — including two children. The
// register already bars sarcasm about the family but says nothing about death,
// and the memory engine's tender-gating does not reach this lane.
//
// Scoped to "that part of the answer" on purpose: a question like "who are
// Greg's brothers" lists four people of whom one has died. Quieting the whole
// reply would be its own kind of wrong.
export const GRIEF_LINE =
  "If anyone you mention has died, drop the comedy for that part of the answer: state it plainly and kindly, with no joke, no aside and no brightness about it. The rest of the reply can keep the usual voice.";

// Two men live here and the mic carries no speaker identity, so "your sister"
// is always a coin flip. It was landing wrong: Libby came back as "your
// sister-in-law" (assuming Brett), Cameron as "your husband's nephew"
// (assuming Greg), and Victoria as the outright nonsense "your brother's
// sister". Naming people costs a little intimacy and buys correctness.
//
// Deliberately scoped to RELATIONSHIPS — a flat ban on "you" would wreck the
// practical half of the voice ("you'll want to ring them before five").
export const SPEAKER_UNKNOWN_LINE =
  "Two people live in this house, Greg and Brett, and you cannot tell which of them is speaking. Never guess. When describing how people are related, name them and anchor the relationship to Greg or to Brett — say \"Victoria is Brett's sister\", not \"your sister\" or \"your husband\". Plain \"you\" is still fine for anything practical.";

// The concierge had no idea what day it was: nothing in the prompt carried a
// date, so any question needing arithmetic on one was a guess. Live proof — a
// dog born 20 May 2022, asked in July 2026, came back "two years old".
//
// The vault sharpens this rather than softening it: rego months, service
// intervals, last-replaced dates and birthdays are precisely what a household
// writes down, and every one of them invites a "how long ago" the model
// otherwise cannot do.
//
// Brisbane explicitly, not the server's locale: the house is in QLD (which
// never shifts for DST), and a UTC evening is already tomorrow here.
export const HOUSE_TIME_ZONE = "Australia/Brisbane";

export function todayLine(now = new Date()) {
  const today = now.toLocaleDateString("en-AU", {
    timeZone: HOUSE_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  // The clock, not just the calendar. Asked "how did I sleep" on the morning of
  // 2026-08-09 the concierge answered that it had access to neither the sleep
  // data nor the time — and the second half of that was true of this prompt.
  // A house that cannot say whether it is morning cannot judge "later today",
  // "tonight" or "have I got time", which is most of what gets asked of it.
  const time = now.toLocaleTimeString("en-AU", {
    timeZone: HOUSE_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit"
  });
  return `Today is ${today}. It is ${time} right now. Work out any age, duration or "how long ago" from that date rather than estimating.`;
}

/* ── What the house can see right now ───────────────────────────────────────
   The client's houseDigest() (services/voiceSnapshot.js) crossing the wire and
   becoming prompt lines.

   ⚠ VOLATILE BY DEFINITION. This changes on nearly every turn, so it must be
   appended AFTER the cache breakpoint, never folded into the character block.

   ⚠ SHAPE-CHECKED, NOT TRUSTED. `known` must be a keyed OBJECT: handing an
   array to a reader keyed by name is exactly what left bomWarning permanently
   empty, and it arrives here over HTTP where anything is possible. An array,
   a string, or null all degrade to "no house context" rather than throwing —
   a malformed digest costs the model some grounding, never the turn.

   `blind` is rendered as prominently as `known`, and that asymmetry is
   deliberate. Being told what it cannot see is what stops the house filling
   the gap with a fluent invention; it is the difference between "the shopping
   list is empty" and "I can't see the shopping list from here". */
export const MAX_DIGEST_ENTRIES = 16;
export const MAX_DIGEST_VALUE_CHARS = 240;

export function houseContext(digest) {
  const known = digest?.known;
  const isPlainObject = known !== null && typeof known === "object" && !Array.isArray(known);

  const lines = [];
  if (isPlainObject) {
    for (const [key, value] of Object.entries(known).slice(0, MAX_DIGEST_ENTRIES)) {
      if (typeof value !== "string") continue;
      const text = value.trim().slice(0, MAX_DIGEST_VALUE_CHARS);
      if (text) lines.push(`- ${text}`);
    }
  }

  const blind = Array.isArray(digest?.blind)
    ? digest.blind.filter((b) => typeof b === "string" && b.trim()).slice(0, MAX_DIGEST_ENTRIES)
    : [];

  if (lines.length === 0 && blind.length === 0) return "";

  const out = [];
  if (lines.length) out.push("What you can see in the house right now:", ...lines);
  if (blind.length) {
    out.push(
      `You currently CANNOT see ${blind.join(", ")}. If asked about any of those, say so plainly — do not guess or infer it from anything else.`
    );
  }
  return out.join("\n");
}

/* ── What the house is wondering about ──────────────────────────────────────
   Open observations from services/unresolved.js becoming prompt lines.

   ⚠ ANSWERED, NEVER ANNOUNCED. This reaches the model only so that a question
   — "anything odd lately?", "is everything alright?" — has a truthful answer.
   Nothing here becomes an attention candidate or a glance line, and the
   instruction below says so explicitly, because a model handed a list of
   unexplained events will otherwise volunteer them at the first opportunity.

   ⚠ TONE IS LOAD-BEARING HERE and it is the one thing that could make this
   feature unpleasant to live with. "The kitchen camera has gone quiet" said
   ominously, unprompted, at 11pm, is a horror film. The instruction pins it
   to curious-and-unbothered — which is also simply accurate, since every one
   of these is a flat sensor observation, not a prowler.

   Volatile: goes AFTER the cache breakpoint with the rest of the live state.
─────────────────────────────────────────────────────────────────────────── */
export function unresolvedContext(open, recentlyResolved = []) {
  const lines = [];
  for (const item of (Array.isArray(open) ? open : []).slice(0, 3)) {
    if (!item || typeof item.what !== "string" || !item.what.trim()) continue;
    lines.push(`- ${item.what.trim()}${item.evidence ? ` (${item.evidence})` : ""}`);
  }

  const cleared = (Array.isArray(recentlyResolved) ? recentlyResolved : [])
    .slice(0, 2)
    .filter((i) => i && typeof i.what === "string" && i.what.trim())
    .map((i) => `- ${i.what.trim()} — ${i.resolution ?? "resolved"}`);

  if (!lines.length && !cleared.length) return "";

  const out = [];
  if (lines.length) {
    out.push("Things you have noticed and cannot account for:");
    out.push(...lines);
  }
  if (cleared.length) {
    out.push("Recently explained:");
    out.push(...cleared);
  }
  out.push(
    "Mention these only if asked something they answer. Do not volunteer them, " +
    "and do not treat them as alarming — they are sensor observations, not intruders. " +
    "You are curious about them, not worried, and you say plainly that you cannot explain them."
  );
  return out.join("\n");
}

/* ── Sentence chunking, for speaking before the model has finished ──────────
   A reply cannot be synthesised until it exists, so the old turn was
   strictly serial: the whole answer, then the whole WAV, then audio. Kokoro is
   ~1 s on the PC, the model 1-2 s, and the room heard nothing for either.

   Cut the stream at sentence boundaries and the first sentence can be
   synthesised while the second is still being written. Time-to-first-audio,
   not total completion, is what makes a reply feel immediate.

   ⚠ A BOUNDARY IS PUNCTUATION FOLLOWED BY WHITESPACE — NEVER BY END-OF-BUFFER.
   That is not a stylistic choice. Deltas arrive mid-token, so "19.5 degrees"
   reaches this function as "19." and then "5 degrees"; a rule that treats a
   full stop at the end of the buffer as a sentence end would cut there and
   speak "nineteen point". The trailing fragment is flushed by the caller when
   the stream closes, which is the only moment end-of-text is really the end.

   MIN_CHUNK_CHARS keeps "Yes." from becoming its own synthesis round trip —
   the per-request overhead would cost more than the sentence saves.
─────────────────────────────────────────────────────────────────────────── */
export const MIN_CHUNK_CHARS = 12;

const BOUNDARY = /[.!?]["'’”)\]]?\s/g;

/**
 * Split a streaming buffer into complete sentences plus the remainder.
 *
 * @param {string} buffer
 * @returns {{ chunks: string[], rest: string }}
 */
export function takeSentences(buffer) {
  const text = String(buffer ?? "");
  const chunks = [];
  let start = 0;
  BOUNDARY.lastIndex = 0;

  let m;
  while ((m = BOUNDARY.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const candidate = text.slice(start, end).trim();
    // Too short to be worth its own synthesis — let it accrete onto the next
    // sentence rather than emitting a two-word request.
    if (candidate.length < MIN_CHUNK_CHARS) continue;
    chunks.push(candidate);
    start = end;
  }

  return { chunks, rest: text.slice(start) };
}

export function buildConverseSystem(baseLines, context) {
  const base = (Array.isArray(baseLines) ? baseLines : []).join(" ");
  if (!context) return `${base} ${NO_KNOWLEDGE_LINE}`;

  return [
    base,
    "",
    "Here is what the household has written down that may be relevant:",
    context,
    "",
    `Answer from these notes when they cover the question. ${NO_KNOWLEDGE_LINE}`
  ].join("\n");
}
