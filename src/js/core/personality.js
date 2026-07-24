// The temperament authority — Phase 10 (docs/vision/phase-10-temperament.md).
// The single place the house's *manners* live. Pure: no imports, no DOM, no IO,
// so the whole module unit-tests in plain node (tests/personality.spec.js) and a
// consistency snapshot can prove ONE voice across every surfacing path.
//
// Phase 10 adds no new engine and no new information. It is a CONSISTENCY layer
// over the behaviours phases 6–9 built: attention phrasing, memory captions,
// arrival copy and atmosphere timing all route through here so the house speaks,
// moves and celebrates the same way every time. Its defining trait is RESTRAINT —
// short, plain, no apology, no nag, and silence as the default setting.

// ── Phrasing register ──────────────────────────────────────────
//
// The voice is short and plain. `phrase` is a conservative NORMALISER, not a
// rewriter: it never invents or drops facts, it strips the manners the house
// refuses (apology, self-narration, nagging), tidies spacing/casing, and keeps
// the line inside a per-kind length. The deterministic template is always the
// input, so the line never depends on this doing anything clever.

// Per-kind maximum length. Factual readouts (a bin/commute/weather line) get the
// generous cap so nothing true is ever truncated; the softer kinds stay shorter.
// The house is a big talker now — celebration lines get room for a beat after the
// fact, so a punchline isn't clipped by trimToWord mid-joke.
const MAX_LEN = { celebration: 140, memory: 110, arrival: 240, default: 140 };

// Openers the house still refuses. The sassy voice narrates in the first person
// and reacts out loud, so "Oops", "Hey there" and "Heads up" are back in — but
// the house never nags ("reminder", "don't forget") and never apologises
// ("sorry", "apologies"), and self-narration ("I noticed…") stays out because it
// reads as chore-policing. Stripped from the FRONT, then the remainder is
// re-capitalised, so "Don't forget the bins are out" → "The bins are out."
const BANNED_OPENERS = [
  /^i\s+noticed\b[\s,:—-]*/i,
  /^i\s+see\s+that\b[\s,:—-]*/i,
  /^just\s+a\s+(quick\s+)?reminder\b[\s,:—-]*/i,
  /^reminder\b[\s,:—-]*/i,
  /^don'?t\s+forget\b[\s,:—-]*/i,
  /^(so\s+)?sorry\b[\s,:—-]*/i,
  /^apologies\b[\s,:—-]*/i,
  /^fyi\b[\s,:—-]*/i
];

// Nagging tails — "…again", "…like I said". Removed from the END.
const NAG_TAILS = [
  /[\s,]+again\b\.?$/i,
  /[\s,]+(?:like|as)\s+i\s+said\b\.?$/i,
  /[\s,]+don'?t\s+forget\b\.?$/i
];

function stripOpener(s) {
  for (const re of BANNED_OPENERS) {
    if (re.test(s)) return s.replace(re, "");
  }
  return s;
}

function stripNagTail(s) {
  let out = s;
  for (const re of NAG_TAILS) out = out.replace(re, "");
  return out;
}

function capitalise(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// The first sentence only — the house is terser when the room is rushed.
function firstSentence(s) {
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : s;
}

// Never cut a word in half; trim back to the last whole word inside the cap.
function trimToWord(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:—-]+$/, "");
}

/**
 * Speak a line in the house's voice. Conservative — it tidies tone, never facts.
 *
 * @param {object} [intent] the House Model posture (Phase 6). Only the tempo is
 *   read: a `rushed` room gets the first sentence only (except a deliberate
 *   `arrival` greeting, which stays whole).
 * @param {string} [kind]   what is speaking (a source/candidate kind) — picks the
 *   length cap.
 * @param {object} [data]   { text } the deterministic/AI line to voice.
 * @returns {string} the voiced line (may be "").
 */
export function phrase(intent, kind, data = {}) {
  let s = String(data?.text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";

  s = stripOpener(s).trim();
  s = stripNagTail(s).trim();
  s = capitalise(s);

  if (intent?.tempo === "rushed" && kind !== "arrival") s = firstSentence(s);

  const max = MAX_LEN[kind] ?? MAX_LEN.default;
  return trimToWord(s, max);
}

// ── Silence thresholds ─────────────────────────────────────────
//
// Saying nothing is the default; the house's loudest setting is still quiet.
// `shouldSpeak` is the ONE place that decision lives, so every surfacing path
// honours the same thresholds (the attention gate calls it before a line shows).

// Below this score, a non-interrupt line is too small to break the quiet of a
// winding-down room.
const QUIET_ROOM_FLOOR = 45;

/**
 * May this candidate break the silence, given the room's posture?
 *   - an interrupt (a safety/doorbell line) always may;
 *   - a rushed room is left alone — non-interrupt lines stay silent;
 *   - a winding-down room only takes a non-interrupt line that clears the floor;
 *   - otherwise, yes.
 */
export function shouldSpeak(candidate, intent = {}) {
  if (!candidate) return false;
  if (candidate.interrupt) return true;

  const tempo = intent?.tempo;
  const activity = intent?.activity;
  if (tempo === "rushed") return false;
  if (activity === "winding-down" && (candidate.score ?? 0) < QUIET_ROOM_FLOOR) return false;

  return true;
}

// ── Motion timing ──────────────────────────────────────────────
//
// The settle/easing tokens every transition shares, so the room moves with one
// set of manners. Reuses the Phase 5/7 "settle, don't loop" curves — the
// atmosphere token still comes to rest over 60s, it just sources that from here.
const TIMING = {
  atmosphere: { settleMs: 60_000, easing: "ease" },      // the slow weather wash (Phase 5/7)
  hero:       { settleMs: 700, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
  arrival:    { settleMs: 550, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  default:    { settleMs: 600, easing: "ease" }
};

/** The settle duration + easing token for a kind of transition. */
export function timing(kind) {
  return TIMING[kind] ?? TIMING.default;
}

// ── Celebration ────────────────────────────────────────────────
//
// How the house marks a good thing — a warmth, never confetti. A celebration is
// a Low-Mid band, NON-INTERRUPT attention candidate: it wins a calm moment and
// waits out a busy one. It rides the Phase 2 queue like any other line (no new
// render path), and its copy passes through `phrase` so it speaks in the voice.

export const CELEBRATION_SCORE = 47; // just above a memory — earns a quiet moment, never barges
const CELEBRATION_HOLD_MS = 16_000;  // lingers a beat longer than an ordinary hero
const CELEBRATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Turn a delight occasion into the gentle celebration surface.
 * @param {object} occasion { id, icon, title, line, expiresAt? }
 * @returns {object} an attention-queue candidate (source "delight").
 */
export function celebrate(occasion = {}) {
  const title = String(occasion.title ?? "").trim();
  const line = String(occasion.line ?? title).trim();
  const text = phrase({}, "celebration", { text: line });
  return {
    id: `delight:${occasion.id}`,
    source: "delight",
    kind: "celebration",
    icon: occasion.icon ?? "✨",
    text,
    caption: title || null,
    interrupt: false,        // a celebration is a warmth, never an interrupt
    score: CELEBRATION_SCORE,
    cooldownMs: CELEBRATION_COOLDOWN_MS,
    holdMs: CELEBRATION_HOLD_MS,
    expiresAt: occasion.expiresAt ?? null
  };
}
