/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Imported by BOTH surfaces (tts.js is shared), ARMED only by V3's callers:
   an utterance or a subject with no `author` is never arbitrated, so the
   incumbent, which names none, behaves exactly as before with the flag on.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══ THE ARBITER — HOUSE-MIND S3 (docs/design/HOUSE-MIND.md §5) ═════════════
   One owner of who may SPEAK and who may take the STAGE (the depth-3 subject).
   Before this, five modules spoke and five mounted subjects, each deciding for
   itself, so collisions resolved by call order: an arrival greeting cut the
   doorbell's line, a dinner recipe resolving late replaced the doorbell camera
   without tearing it down, and a reply whose synthesis was still in flight
   played straight over the barge-in that should have stopped it.

   THE POLICY IS THIS FILE. The tables below are the whole of it; the two
   chokepoints (core/tts.js, v3/subjects/index.js) only ask.

   SPEECH, by priority. A new utterance pre-empts the one in the air when its
   priority is at least as high; otherwise it is DROPPED, not queued. A claim is
   held from the moment the request is made, through synthesis, until playback
   ends — a doorbell line mid-synthesis is already the doorbell's.
     voice    a reply to someone in the room       50
     doorbell the door announcing itself            40
     timer    a timer the room set, ringing         30   (repeats every 30 s,
                                                          so a dropped ring
                                                          comes back)
     briefing the house's scheduled opening         20
     arrival  a greeting                            10
   Barge-in (tts.silence) is the reflex and is never arbitrated.

   STAGE, by lane. The REFLEX authors — doorbell, voice, command — always take
   the stage: they are a door, a person asking and a person's remote, and
   HOUSE-MIND §4 con 1 is explicit that putting any of them behind a ranker is a
   regression. The SCHEDULED authors take it only when nothing holds it, or when
   what holds it is scheduled and lower:
     briefing 20 · dinner 10
   ("The door outranks you; dinner does not" — src/v3/core/dinner.js, which
   stated the rule in prose before anything enforced it.)

   Flag `v3Arbiter`, read per call. Off: every check answers yes and nothing is
   recorded, which is the build that shipped before S3.
   ════════════════════════════════════════════════════════════════════════ */

export const SPEECH_PRIORITY = Object.freeze({
  voice: 50,
  doorbell: 40,
  timer: 30,
  briefing: 20,
  arrival: 10
});

export const STAGE_REFLEX = Object.freeze(["doorbell", "voice", "command"]);

export const STAGE_PRIORITY = Object.freeze({
  briefing: 20,
  dinner: 10
});

export function arbiterOn() {
  return Boolean(globalThis.window?.CONFIG?.features?.v3Arbiter);
}

/* The last decisions, newest last, for __v3() and specs. Bounded: this page
   runs for weeks and a decision is made on every utterance. */
const MAX_DECISIONS = 20;
const decisions = [];

function note(cap, author, action, over = null) {
  decisions.push({ at: Date.now(), cap, author: author ?? null, action, over });
  if (decisions.length > MAX_DECISIONS) decisions.shift();
}

/* ── Speech ──────────────────────────────────────────────────────────────── */

let speechClaim = null; // { author, priority, gen }

/* Resolvers waiting for the air to be free. A DROPPED utterance resolves here
   rather than at once: every speaker does setPhase("speaking") → speak() →
   setPhase("idle"), so an instant resolve would drop the presence rim while the
   higher speaker is still talking. Emptied on every resolve — never grows past
   the handful of speakers there are. */
const quietWaiters = [];

function wakeQuiet() {
  while (quietWaiters.length) quietWaiters.shift()();
}

/** Resolves once nothing holds the air. At once, when nothing does. */
export function quiet() {
  if (!speechClaim) return Promise.resolve();
  return new Promise((resolve) => quietWaiters.push(resolve));
}

/**
 * May `author` start speaking now? Read-only: the caller silences the old
 * utterance and then calls claimSpeech. Unauthored or unknown: always yes.
 */
export function maySpeak(author) {
  if (!arbiterOn()) return true;
  const priority = SPEECH_PRIORITY[author];
  if (priority == null || !speechClaim) return true;
  if (priority >= speechClaim.priority) return true;
  note("speech", author, "dropped", speechClaim.author);
  return false;
}

/** Hold the air for utterance `gen`. An unauthored speaker clears the claim:
 *  it was never arbitrated, so it cannot be protected either. */
export function claimSpeech(author, gen) {
  if (!arbiterOn()) return;
  const priority = SPEECH_PRIORITY[author];
  const over = speechClaim?.author ?? null;
  speechClaim = priority == null ? null : { author, priority, gen };
  if (priority != null) note("speech", author, "took", over);
}

/** Utterance `gen` has ended (finished, failed or cut off). A stale release —
 *  from an utterance something newer already superseded — is ignored. */
export function releaseSpeech(gen) {
  if (speechClaim && (gen == null || speechClaim.gen === gen)) speechClaim = null;
  if (!speechClaim) wakeQuiet();
}

/* ── Stage ───────────────────────────────────────────────────────────────── */

let stageClaim = null; // { author, gen }

function stageRank(author) {
  if (STAGE_REFLEX.includes(author)) return Infinity;
  return STAGE_PRIORITY[author] ?? null;
}

/** May `author` take the stage now? Reflex and unauthored: always yes. */
export function mayTakeStage(author) {
  if (!arbiterOn()) return true;
  const rank = stageRank(author);
  if (rank == null || rank === Infinity || !stageClaim) return true;
  const held = stageRank(stageClaim.author);
  if (held == null || rank >= held) return true;
  note("stage", author, "refused", stageClaim.author);
  return false;
}

export function claimStage(author, gen) {
  if (!arbiterOn()) return;
  const over = stageClaim?.author ?? null;
  stageClaim = stageRank(author) == null ? null : { author, gen };
  if (stageClaim) note("stage", author, "took", over);
}

export function releaseStage() {
  stageClaim = null;
}

/** A mount that lost the race to a newer one, for the log. */
export function noteSuperseded(cap, author) {
  if (arbiterOn()) note(cap, author, "superseded");
}

/** Read-only state for __v3() and specs. */
export function arbiterState() {
  return {
    on: arbiterOn(),
    speech: speechClaim ? { author: speechClaim.author, priority: speechClaim.priority } : null,
    stage: stageClaim ? { author: stageClaim.author } : null,
    decisions: decisions.slice()
  };
}

/** Test seam. */
export function __resetArbiter() {
  speechClaim = null;
  stageClaim = null;
  decisions.length = 0;
  wakeQuiet();
}
