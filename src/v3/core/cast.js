/* ═══════════════════════════════════════════════════════════════════════════
   THE CAST, PAGE SIDE — asks the server for an exchange and plays it.

   Through createSpeech, never chained speak() calls: speak() opens with
   silence(), which ungates the mic, so a two-hander built from it would let the
   house transcribe its own second line. The queue holds one mic gate, one
   arbiter claim and one barge-in across the whole exchange.

   Flag `v3CastVoice`, read per call. server/routes/cast.js holds the script.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createSpeech, setSpeechRouter } from "../../js/core/tts.js";

const PICK_TIMEOUT_MS = 1500;
/* Set by ear on the wall: the clones master noticeably louder than Kokoro. */
const CAST_VOLUME = 0.9;

export function castOn() {
  return Boolean(window.CONFIG?.features?.v3CastVoice);
}

/** An exchange for this event, or null. Never throws: a caller's fallback is
 *  the door still being announced. */
export async function pickCast(event) {
  try {
    const res = await fetch("/api/cast/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      signal: AbortSignal.timeout(PICK_TIMEOUT_MS)
    });
    if (!res.ok) return null;
    const { exchange } = await res.json();
    return exchange?.clips?.length ? exchange : null;
  } catch {
    return null;
  }
}

/** Resolves true once spoken, false when nothing could be picked. */
export async function speakCast(event, { author = null, onAudio = null } = {}) {
  const exchange = await pickCast(event);
  if (!exchange) return false;
  const queue = createSpeech({ author, onAudio, volume: CAST_VOLUME });
  for (const clip of exchange.clips) queue.push({ clip });
  queue.close();
  await queue.done;
  return true;
}

/** Every plain line the house says is offered to the cast, keyed on its exact
 *  words. Anything the script does not hold is spoken as before. */
export function initCast() {
  setSpeechRouter((text, voice) => (castOn() ? speakCast(`line:${text}`, voice) : null));
}

/** Named faces get their own pool, which only holds the household's names. */
export function doorEvent(prefix, personName) {
  if (!personName) return `door:${prefix}:unknown`;
  return `door:${prefix}:known:${personName.toLowerCase().replace(/[^a-z]/g, "")}`;
}
