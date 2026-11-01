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
/* Measured on the first live eval: "like last time", said of a household member
   about something that never happened. It has no number in it to catch. */
const INVENTED_PAST = /\b(?:last time|as usual|like always|last week|last night|yesterday|the other day)\b/i;
const HOUSEHOLD_HABIT = /\b(?:greg|brett|he|they|these two)\b(?!'s (?:got|turn))[^.!?]*\b(?:never|always|ever|forever)\b/i;

/* "One" and "two" are left out: they are ordinary speech, and "one word" is not a
   claim about anything. Above that, the same eval spelled "twenty-seven" out and
   walked straight past a check that only read digits. */
const UNITS = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const NUMBER_WORDS = new RegExp(
  `\\b(?:(${Object.keys(TENS).join("|")})(?:[- ](${Object.keys(ONES).join("|")}))?|(${Object.keys(UNITS).join("|")}))\\b`, "gi");

/** Every spelled-out number in the sentence, as digits. */
function spelledNumbers(sentence) {
  return [...sentence.matchAll(NUMBER_WORDS)].map(([, tens, one, unit]) =>
    unit ? UNITS[unit.toLowerCase()] : TENS[tens.toLowerCase()] + (one ? ONES[one.toLowerCase()] : 0));
}

/* Spoken figures may stand for part of a written one: "one seventy-nine" for
   1.79, "seven" for 7:30. So this is looser than the digit check above. */
const mentions = (known, n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(known);

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

/* Lists and line breaks are for reading, and this is heard. */
const spoken = (text) => text.replace(/^\s*[-*•]\s+/gm, "").replace(/\s*\n\s*/g, " ");

/* A sentence the token limit cut off has no ending, and is not offered. */
const sentencesOf = (text) => spoken(text).match(/[^.!?]+[.!?]+["')]*/g)?.map((s) => s.trim()) ?? [];

/** The most an unprompted or spoken reply may run to, in sentences. */
export const MAX_REPLY_SENTENCES = 4;

/** Why this sentence must not be spoken, or null. */
export function claimFault(sentence, source, { toolRan = false } = {}) {
  const known = String(source).toLowerCase();
  for (const number of sentence.match(NUMBERS) ?? []) {
    if (!new RegExp(`(^|[^\\d.:])${number.replace(/\./g, "\\.")}($|[^\\d])`).test(known)) return `number ${number}`;
  }
  for (const number of spelledNumbers(sentence)) {
    if (!mentions(known, number)) return `number ${number}`;
  }
  if (INVENTED_PAST.test(sentence)) return "invents a past";
  if (HOUSEHOLD_HABIT.test(sentence)) return "invents a habit";
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
