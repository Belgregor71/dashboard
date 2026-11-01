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
const JAB_CHANCE = 0.35;

/* Anzac Day and Remembrance Day: the whole cast stands down and the plain house
   voice speaks, whatever the lane. The owner's rule, not a flag. */
export function memorialDay(now = new Date()) {
  const [month, date] = [now.getMonth(), now.getDate()];
  return (month === 3 && date === 25) || (month === 10 && date === 11);
}

export function castOn(now = new Date()) {
  return Boolean(window.CONFIG?.features?.v3CastVoice) && !memorialDay(now);
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

/** Whoever reads a live line is chosen at random, one voice per reply. */
export const castVoice = (random = Math.random) => (random() < 0.5 ? "kath" : "kim");

/* The owner's limit for a spoken exchange. The wall keeps the whole briefing. */
const MAX_BRIEFING_LINES = 4;

/** A briefing the cast wrote: `{ text, lines }`, the words for the wall and the
 *  lines to speak. Untagged text comes back as written, with no lines. */
export function readCastScript(summary) {
  const lines = [];
  for (const raw of String(summary).split("\n")) {
    const match = /^(kath|kim):\s*(.+)$/i.exec(raw.trim());
    if (!match) return { text: summary, lines: [] };
    lines.push({ voice: match[1].toLowerCase(), text: match[2] });
  }
  return { text: lines.map((line) => line.text).join(" "), lines: lines.slice(0, MAX_BRIEFING_LINES) };
}

/** Written lines in their own voices, as one utterance. */
export async function speakLines(lines, { author = null, onAudio = null } = {}) {
  const queue = createSpeech({ author, onAudio, volume: CAST_VOLUME });
  for (const line of lines) queue.push(line);
  queue.close();
  await queue.done;
}

/** Queue options for a reply that is written as it is spoken. Empty with the
 *  flag off, so the queue is the one it always was. */
export function liveVoice() {
  return castOn() ? { voice: castVoice(), volume: CAST_VOLUME } : {};
}

/** The fact in the clone's voice, word for word, so it cannot come out wrong.
 *  The character arrives afterwards: sometimes the other one has a jab at it. */
async function speakLive(text, { author, onAudio }) {
  const voice = castVoice();
  const queue = createSpeech({ author, onAudio, voice, volume: CAST_VOLUME });
  queue.push(text);
  if (author === "voice" && Math.random() < JAB_CHANCE) {
    const jab = await pickCast(`jab:${voice === "kath" ? "kim" : "kath"}`);
    for (const clip of jab?.clips ?? []) queue.push({ clip });
  }
  queue.close();
  await queue.done;
  return true;
}

/* The wall's fixed lines in their voices, by exact words. Fetched rather than
   bundled, because the bundle is public. */
let wall = {};

async function loadWall() {
  try {
    const res = await fetch("/api/cast/wall");
    if (res.ok) wall = (await res.json()).lines ?? {};
  } catch {
    /* the wall keeps its own words */
  }
}

/** What the wall shows for this line. Off, or unknown: the line itself. */
export function wallLine(text) {
  return castOn() ? wall[text] ?? text : text;
}

/** Every plain line the house says is offered here, keyed on its exact words.
 *  Off, nothing changes. The script's own version wins; anything else is live. */
export function initCast() {
  if (castOn()) loadWall();
  setSpeechRouter((text, voice) => {
    if (!castOn()) return null;
    return speakCast(`line:${text}`, voice).then((spoke) => spoke || speakLive(text, voice));
  });
}

/** Named faces get their own pool, which only holds the household's names. */
export function doorEvent(prefix, personName) {
  if (!personName) return `door:${prefix}:unknown`;
  return `door:${prefix}:known:${personName.toLowerCase().replace(/[^a-z]/g, "")}`;
}
