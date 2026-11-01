/* ═══════════════════════════════════════════════════════════════════════════
   THE CAST'S AI LINES — reading speaker tags, and refusing invented facts.

   A persona told to be uninformed is being told to invent, and this house has
   measured what a model does with that: it manufactures a clock time and says
   it with confidence. So every sentence is checked before it is spoken, against
   the text the model was actually given:

     · a number or a day that appears nowhere in that text is dropped
     · a claim to have done something is dropped, unless a tool really ran

   Dropping loses a joke at worst. Keeping one loses the room's trust.
   ═══════════════════════════════════════════════════════════════════════════ */

const TAG = /(?:^|\s)(kath|kim)\s*:\s*/gi;
const DAYS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const NUMBERS = /\d+(?:[.:]\d+)?/g;
const ACTION = /\b(?:i|we)(?:'ve| have| just)?\s+(?:just\s+)?(?:turned|switched|locked|unlocked|opened|closed|shut|set|added|booked|ordered|sent|called|rang|cancelled|started|stopped|taken|put)\b/i;

/** Text into `{ speaker, text }` lines. Anything before the first tag belongs to
 *  `speaker`, so a chunk that continues a line keeps its voice. */
export function splitLines(text, speaker = "kath") {
  const source = String(text ?? "");
  const lines = [];
  let current = speaker;
  let start = 0;
  for (const match of source.matchAll(TAG)) {
    const before = source.slice(start, match.index).trim();
    if (before) lines.push({ speaker: current, text: before });
    current = match[1].toLowerCase();
    start = match.index + match[0].length;
  }
  const tail = source.slice(start).trim();
  if (tail) lines.push({ speaker: current, text: tail });
  return lines;
}

const sentencesOf = (text) => text.match(/[^.!?]+[.!?]+["')]*|\S[^.!?]*$/g)?.map((s) => s.trim()) ?? [];

/** Why this sentence must not be spoken, or null. */
export function claimFault(sentence, source, { toolRan = false } = {}) {
  const known = String(source).toLowerCase();
  for (const number of sentence.match(NUMBERS) ?? []) {
    if (!new RegExp(`(^|[^\\d.:])${number.replace(/\./g, "\\.")}($|[^\\d])`).test(known)) return `number ${number}`;
  }
  for (const day of sentence.match(DAYS) ?? []) {
    if (!known.includes(day.toLowerCase())) return `day ${day}`;
  }
  if (!toolRan && ACTION.test(sentence)) return "claims an action";
  return null;
}

/** The sentences of a line that may be spoken, or "" when none may. */
export function keepClaims(text, source, options = {}) {
  return sentencesOf(text)
    .filter((sentence) => {
      const fault = claimFault(sentence, source, options);
      if (fault) console.warn(`[cast] dropped a sentence: ${fault}`);
      return !fault;
    })
    .join(" ");
}

/** A whole tagged reply with its faults removed, tags intact, or null. */
export function keepReply(text, source, options = {}) {
  const lines = splitLines(text)
    .map(({ speaker, text: said }) => ({ speaker, text: keepClaims(said, source, options) }))
    .filter((line) => line.text);
  if (lines.length === 0) return null;
  return lines.map((line) => `${line.speaker === "kim" ? "Kim" : "Kath"}: ${line.text}`).join("\n");
}

/** The words alone, for the wall, for history and for memory. */
export const stripTags = (text) => splitLines(text).map((line) => line.text).join(" ");
