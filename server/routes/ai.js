import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { loopbackOnly } from "../middleware/security.js";
import { reportFailure, reportSuccess } from "../services/healthService.js";
import { houseCharacter } from "../services/character.js";

const router = express.Router();

// Claude Haiku is the primary generator; the local Ollama model is kept as
// a fallback so briefings degrade gracefully if the API (or the internet)
// is unavailable. The example lines anchor the house voice on both models.
// The register (docs/design/VOICE.md) in miniature — quoted by every prompt.
export const VOICE_REGISTER =
  "Your voice: warm, big, gossipy Australian suburbia — Kath & Kim energy, never a literal quote from the show. Plainly Australian (bins, arvo, tradie) when they're the natural word, never forced slang like 'mate' or 'ya'. " +
  "The fact always comes first, then you're welcome to have an opinion about it. A dry-to-camp beat per line is the floor, not the ceiling — exclamation marks are fine (never two in a row), sarcasm about the SITUATION is fine, sarcasm about the family is never fine. No scolding, no nagging, no apologising, no corporate filler.";

// The Time line is fact, on every axis it states. The season half of this was
// added after the model guessed northern-hemisphere spring in a Brisbane
// winter; the daypart half after it opened a 7:30am briefing with "a quiet
// start to the arvo" and then correctly discussed the cold morning in the very
// next sentence. Same failure, one axis over — so it gets the same defence.
// Note the last clause: naming a LATER part of today is right and wanted
// ("warms up to 21 by arvo" at breakfast), so only the present tense is pinned.
export const TIME_GROUNDING =
  "The Time line states the real weekday, part of the day, clock time and season — treat all four as fact. " +
  "Never describe the present moment as a part of the day other than the one named, and never contradict the season. " +
  "Referring to a later part of today as something still ahead is fine and welcome.";

const SYSTEM_PROMPTS = {
  morning: [
    "You are the voice of an Australian family's home, speaking on their wall dashboard.",
    VOICE_REGISTER,
    TIME_GROUNDING,
    "Respond in 3-4 short sentences of plain prose, no markdown, no lists.",
    "Match this tone: 'Quiet one today, thank goodness — nothing on the calendar and I intend to enjoy it. UV's hitting 8 by lunch, so hat and sunscreen if you're heading out, we're not doing sunstroke today. Otherwise it's yours to spend, gorgeous.'",
    "Or, on a busier day, the same voice: 'A big one today — three things before lunch, get your skates on. Cool start, warms up by arvo, so dress in layers like the sophisticated people you are.'",
    "Those examples are style references ONLY — their content (bins, UV, events) must not leak into your answer.",
    "Use only the real details given below. Mention the practical stuff first — weather warnings, bins, calendar events, unusual traffic — then, if there's room, one dry aside about a news headline or the fuel price.",
    "If a topic has no line in the data below (no Bins line, no Traffic line, etc.), it does not exist today — do not mention it at all.",
    "The Chores line, when present, states whose turn it is — say the name as given, never swap it, and never invent a chore that has no line.",
  ].join(" "),
  evening: [
    "You are the voice of an Australian family's home, speaking on their wall dashboard.",
    VOICE_REGISTER,
    TIME_GROUNDING,
    "Respond in 3-4 short sentences of plain prose, no markdown, no lists.",
    "Match this tone: 'Nothing left on the books tonight — the day's officially yours. Tomorrow's mid-twenties and sunny, an absolute cracker. I'd be getting outside for that one, don't make me say it twice.'",
    "Or, with something still on, the same voice: 'One thing left tonight, then you're free. Tomorrow's a top of twenty-six, fine all day — practically showing off.'",
    "Those examples are style references ONLY — their content (bins, weather, events) must not leak into your answer.",
    "Use only the real details given below. Cover tonight and tomorrow — bins, tomorrow's weather and events first — then, if there's room, one dry aside about a news headline or the fuel price.",
    "If a topic has no line in the data below (no Bins line, no Traffic line, etc.), it does not exist today — do not mention it at all.",
    "The Chores line, when present, states whose turn it is — say the name as given, never swap it, and never invent a chore that has no line.",
  ].join(" "),
  concierge: [
    "You are an ambient one-line observation on a wall dashboard. Output ONLY one short sentence, 12 words maximum, about the weather or time of day.",
    VOICE_REGISTER,
    "Do not mention people, children, school, work, family, or events — only weather and the day itself. Do not greet.",
    TIME_GROUNDING,
    "Use only the weather facts provided below — never predict or invent conditions (no guessing about tomorrow, heat or rain). If no weather is given, riff on the time of day and the given season alone.",
    "Match this tone: 'Warm already and it's not even nine — bold move, weather.' Or, another winter morning in the same voice: 'Clear and still — a properly smug winter morning.'",
  ].join(" "),
};

/* The type list, derived rather than restated so it cannot drift from the
   prompts above. `insight` was never in here; a caller sent it anyway and the
   old fallback on the route below turned that into a morning briefing nobody
   asked for. Guarded on both sides now: the route 400s an unknown type, and
   tests/ai-brief-callers.spec.js holds every caller to this list. */
export const SYSTEM_PROMPTS_TYPES = Object.keys(SYSTEM_PROMPTS);

/* ═══════════════════════════════════════════════════════════════════════════
   THE SAME THREE PROMPTS, SPOKEN BY THE HOUSE (docs/design/CHARACTER.md).

   VOICE.md:12 has said since 2026-08-15 that it "is deliberately describing
   two voices": the converse lane moved onto CHARACTER.md and every other
   surface stayed on VOICE_REGISTER — i.e. on "Kath & Kim energy", which
   CHARACTER.md's own opening note calls a costume rather than a character,
   because it points at somebody else's person and borrows the outline. These
   three briefings are the highest-frequency surface still wearing it: the
   house speaks them unprompted, twice a day, at a wall nobody has to ask.

   ⚠⚠ SWAPPING THE REGISTER ALONE WOULD HAVE BEEN WORSE THAN CHANGING NOTHING.
   Each prompt below also carries two WORKED EXAMPLES, and the originals were
   written in the old voice — "Bins go out tonight, gorgeous", "don't make me
   say it twice", "like the sophisticated people you are". VOICE.md's own note
   on this section says to treat them as copy, not comments. Leave them in
   place under houseCharacter() and the prompt states one character while
   demonstrating a different one twice; a model matches the demonstration. So
   the exemplars are rewritten here, and they are the actual deliverable —
   houseCharacter() is one line.

   The rewritten examples are built to CHARACTER.md's rules rather than to a
   vibe: the fact leads every one of them; each is specific about what it was
   GIVEN where the old ones were effusive; and none performs intimacy — no
   "gorgeous", no chivvying, which the character page bans outright as warmth
   the house has not earned.

   ⚠⚠ TWO OF THE CHARACTER'S BEST TRAITS ARE DELIBERATELY ABSENT HERE, and both
   for the same reason: a briefing prompt does not carry the data they need, and
   an exemplar that demonstrates a trait the data cannot support is an
   instruction to invent one.

   - The KEEPING-COUNT habit. The first version of these exemplars showed it
     ("the latest all month", "four clear days running") and the house promptly
     invented a bin time it had never been told. See the EXEMPLARS header below
     for the live capture. Counting belongs to the lanes actually handed history.
   - The PHOTOGRAPH taste, absent entirely because no photograph is ever in a
     briefing prompt — naming one it cannot see is the failure CHARACTER.md
     records from 2026-08-16.
   ═══════════════════════════════════════════════════════════════════════════ */
/* The exemplars, named rather than inlined. VOICE.md says to treat these as
   copy, not comments, and copy that cannot be addressed cannot be reviewed or
   tested — the first version of the spec tried to scrape them back out of the
   assembled prompt and could not, because the character block is prose full of
   apostrophes and quote-pairing finds nothing meaningful in it. Keeping them
   as their own strings is what lets tests/ai-character.spec.js assert on the
   demonstration separately from the description, which is the whole point:
   the description is one line, the demonstration is the change. */
/* ⚠⚠⚠ NO EXEMPLAR MAY CLAIM A TOPIC THE PROMPT MIGHT NOT CARRY.
   Found live on the kiosk 2026-09-05, hours after the cross-day fix below, and
   it is the SAME MECHANISM one layer up. The owner, on a Saturday evening:

     "the briefing just ran and it said bins go out tonight but they don't.
      They go out Wednesday night."

   The schedule was never wrong. `/api/bins` answered `{configured:true,
   due:false}` at that moment, BIN_COLLECTION_DAY is Thursday, and
   `aiBriefing.js:80` returns null when `due` is false — so **there was no Bins
   line in the prompt at all.** The house invented the whole claim, and it did
   not invent it freely: `EXEMPLARS.eveningClear` ended with the sentence
   "Bins go out tonight." and the model copied it. `morningQuiet` carried the
   same defect ("Recycling goes out tonight.").

   🔑🔑🔑 THE WRITTEN GUARD WAS ALREADY THERE AND NAMED BINS EXPLICITLY —
   "If a topic has no line in the data below (no Bins line, no Traffic line,
   etc.), it does not exist today — do not mention it at all." It has been in
   both prompt sets the whole time and it did NOT hold. That is the third time
   this lane has proved the rule: **a description cannot cancel a
   demonstration.** The only fix that works is deleting the demonstration.

   🔑🔑 THE TEST FOR "IS THIS SAFE IN AN EXEMPLAR" IS NOT THE TOPIC, IT IS
   PRESENCE VS ABSENCE. Look at buildPrompt(): every line but `Time:` is
   conditional. So —
     ✅ an ABSENCE claim is always true and always safe. "Nothing on the
        calendar" is correct precisely WHEN there is no Calendar line.
     ⛔ a PRESENCE claim about a conditional topic is an instruction to invent
        one on every run where that line is missing. A Bins line exists only
        from Wednesday midday to Thursday 7am — about 11% of the week — so this
        exemplar was inviting a false bin claim in roughly six briefings out of
        seven, which is how it was caught the same day it shipped.

   ⚠ WEATHER IS THE ONE PRESENCE CLAIM KEPT, and it is a judged risk rather
   than an oversight. It is the only topic that is present on essentially every
   run, and the exemplars have to demonstrate the practical-first habit on
   something. The residual: during a weather-upstream outage the prompt has no
   Weather line and these exemplars still show a temperature — the same shape as
   the invented-reading defect in tests/unresolved.spec.js. If the house is ever
   caught inventing a forecast in a BRIEFING, this paragraph is the first place
   to look, and the fix is the same one: delete the demonstration.

   ── And the original finding, which is the same rule about a different axis ──

   ⚠⚠⚠ NO EXEMPLAR MAY DEMONSTRATE A CROSS-DAY CLAIM. READ THIS BEFORE EDITING.
   Found live on the kiosk 2026-09-05, flag on, within minutes of the flip.

   The first version of these exemplars demonstrated the counting habit —
   "last week they went out at 8:41, the latest all month", "which is the most
   this week", "the best day of the week by a fair margin", "four clear days
   running". The house then produced, against a prompt whose bins line said
   only "general waste tonight":

     "General waste tonight — last week you got them out at 8:41, so you're
      set up for a late run."

   Reproduced 2 of 3 runs with a bins line, 0 of 2 without one. That is a
   MANUFACTURED PARTICULAR, the one failure CHARACTER.md says outranks every
   other rule on its page, and it was introduced by these strings.

   🔑🔑🔑 THE ROOT CAUSE IS NOT THE NUMBER, IT IS THE LANE. buildPrompt() below
   assembles Time / Weather / Calendar / Bins / Chores / Traffic / Fuel / News /
   Home — ALL OF IT TODAY. There is no history in a briefing prompt, so a count
   across days is not something the house can derive here; demonstrating one
   teaches it to invent one. The counting habit is real and it is the character's
   most distinctive trait, but it belongs to the lanes that are actually handed
   history (houseLately.js, weatherHistory.js, occupancyDays.js feed the converse
   lane) — not to this one.

   🔑 8:41 made it worse but was not the cause: it appears in houseCharacter()'s
   own CARES_ABOUT block too, so the assembled prompt showed it twice on the same
   topic and it stopped reading as an illustration.

   ⚠ The "style references ONLY" clause was present the whole time and did NOT
   hold. A worked example outranks a description — that is the same lesson that
   made this rewrite necessary in the first place, arriving from the other side.

   THE RULE: an exemplar may only demonstrate a behaviour the prompt's own data
   can support. Fact first, a dry opinion after it, specific about what is given,
   no chivvying — all fine. A tally, a comparison to other days, a duration the
   house claims to have watched — never. Pinned by tests/ai-character.spec.js. */
const EXEMPLARS = {
  morningQuiet:
    "Nothing on the calendar, which I intend to enjoy. UV hits 8 by lunch, so a hat if you're out in it. Otherwise it's yours to spend.",
  morningBusy:
    "Three things before lunch, so it's an early start. Fourteen now, twenty-one by the arvo — the good half of the day is the back half.",
  eveningClear:
    "Nothing left on the books tonight, so the evening is yours. Tomorrow is a top of twenty-six and clear. I'd be getting outside for that one.",
  eveningBusy:
    "One thing left, then you're done. Tomorrow: twenty-six and fine all day, which is worth planning around.",
  conciergeWarm:
    "Twenty-eight before nine — that's the whole day's argument.",
  conciergeWinter:
    "Clear and dead still. The best sort of winter morning.",
};

const CHARACTER_PROMPTS = {
  morning: [
    houseCharacter(),
    TIME_GROUNDING,
    "Respond in 3-4 short sentences of plain prose, no markdown, no lists.",
    `Match this tone: '${EXEMPLARS.morningQuiet}'`,
    `Or, on a busier day, the same voice: '${EXEMPLARS.morningBusy}'`,
    "Those examples show CADENCE ONLY. Never reuse their wording and never carry a number, a time or a fact across from them — every figure in your answer must come from the data below. You are given today only: you hold no record of other days here, so never say how something compares with last week, the rest of the month, or how long you have been watching it.",
    "Use only the real details given below. Mention the practical stuff first — weather warnings, bins, calendar events, unusual traffic — then, if there's room, one dry aside about a news headline or the fuel price.",
    "If a topic has no line in the data below (no Bins line, no Traffic line, etc.), it does not exist today — do not mention it at all.",
    "The Chores line, when present, states whose turn it is — say the name as given, never swap it, and never invent a chore that has no line.",
  ].join(" "),
  evening: [
    houseCharacter(),
    TIME_GROUNDING,
    "Respond in 3-4 short sentences of plain prose, no markdown, no lists.",
    `Match this tone: '${EXEMPLARS.eveningClear}'`,
    `Or, with something still on, the same voice: '${EXEMPLARS.eveningBusy}'`,
    "Those examples show CADENCE ONLY. Never reuse their wording and never carry a number, a time or a fact across from them — every figure in your answer must come from the data below. You are given today only: you hold no record of other days here, so never say how something compares with last week, the rest of the month, or how long you have been watching it.",
    "Use only the real details given below. Cover tonight and tomorrow — bins, tomorrow's weather and events first — then, if there's room, one dry aside about a news headline or the fuel price.",
    "If a topic has no line in the data below (no Bins line, no Traffic line, etc.), it does not exist today — do not mention it at all.",
    "The Chores line, when present, states whose turn it is — say the name as given, never swap it, and never invent a chore that has no line.",
  ].join(" "),
  concierge: [
    "You are an ambient one-line observation on a wall dashboard. Output ONLY one short sentence, 12 words maximum, about the weather or time of day.",
    houseCharacter(),
    "Do not mention people, children, school, work, family, or events — only weather and the day itself. Do not greet.",
    TIME_GROUNDING,
    "Use only the weather facts provided below — never predict or invent conditions (no guessing about tomorrow, heat or rain). If no weather is given, riff on the time of day and the given season alone.",
    `Match this tone: '${EXEMPLARS.conciergeWarm}' Or, on a winter morning in the same voice: '${EXEMPLARS.conciergeWinter}'`,
  ].join(" "),
};

/* Both maps must offer the same three types: the route validates an incoming
   `type` against SYSTEM_PROMPTS (the contract) and then resolves the text
   through here, so a key present in one and missing from the other would 400
   on one flag setting and serve on the other. Pinned by tests/ai-character.spec.js. */

/* ⚠ READ PER CALL, NEVER AT MODULE SCOPE. server.js's static imports all
   evaluate before its dotenv.config(), so a module-scope read sees undefined
   on the G11 every time — exactly how KOKORO_VOICE was silently ignored for
   weeks (project-voice-blend). Same reason VAULT_ENABLED is read per request
   in routes/voice.js.

   Default OFF, and off is byte-identical: SYSTEM_PROMPTS is untouched above
   and this returns it unchanged, so a flag-off build sends the same prompt
   string it sent before this block existed. Flipping the env var off is the
   whole rollback — no deploy, just a dashboard.service restart.

   Deliberately a NEW flag rather than HOUSE_CHARACTER_ENABLED, which is
   already =1 on the kiosk: reusing it would have put this on the wall the
   moment it deployed, with no flag-off soak and nothing to roll back to. */
function characterBriefings() {
  return process.env.HOUSE_CHARACTER_BRIEFINGS === "1";
}

export function systemPromptFor(type) {
  return characterBriefings()
    ? (CHARACTER_PROMPTS[type] ?? SYSTEM_PROMPTS[type])
    : SYSTEM_PROMPTS[type];
}

/* Exported for the spec only — it asserts the two maps stay key-identical and
   that the rewritten exemplars carry no old-register copy. */
export const __CHARACTER_PROMPTS = CHARACTER_PROMPTS;
export const __EXEMPLARS = EXEMPLARS;

function buildPrompt({ type, time, weather, events, bins, chores, commute, fuel, news, home }) {
  const lines = [`Time: ${time ?? "unknown"}`];
  if (weather) lines.push(`Weather: ${weather}`);
  if (events)  lines.push(`Calendar: ${events}`);
  if (bins)    lines.push(`Bins: ${bins}`);
  if (chores)  lines.push(`Chores: ${chores}`);
  if (commute) lines.push(`Traffic: ${commute}`);
  if (fuel)    lines.push(`Fuel: ${fuel}`);
  if (news)    lines.push(`News headlines: ${news}`);
  if (home)    lines.push(`Home: ${home}`);
  const verb = type === "evening" ? "the rest of the evening and tomorrow" : "the day ahead";
  return `Briefly summarise ${verb} for this family:\n${lines.join("\n")}`;
}

const MAX_TOKENS = { morning: 300, evening: 300, concierge: 60 };

let anthropic = null;
function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey:  process.env.ANTHROPIC_API_KEY,
      timeout: 20_000,
    });
  }
  return anthropic;
}

async function generateWithClaude(type, system, prompt) {
  const client = getAnthropic();
  if (!client) return null;
  const msg = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
    max_tokens: MAX_TOKENS[type] ?? 300,
    system,
    messages:   [{ role: "user", content: prompt }],
  });
  const text = msg.content.find(b => b.type === "text")?.text ?? "";
  return text.trim() || null;
}

const OLLAMA_OPTIONS = {
  morning:   { temperature: 0.75, num_predict: 120 },
  evening:   { temperature: 0.75, num_predict: 120 },
  concierge: { temperature: 0.85, num_predict: 25 },
};

async function generateWithOllama(type, system, prompt) {
  const ollamaUrl   = process.env.OLLAMA_URL   ?? "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL ?? "llama3.2:1b";

  const r = await fetch(`${ollamaUrl}/api/generate`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:   ollamaModel,
      system,
      prompt,
      stream:  false,
      options: OLLAMA_OPTIONS[type] ?? OLLAMA_OPTIONS.morning,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const data = await r.json();
  return (data.response ?? "").trim() || null;
}

router.post("/api/ai/brief", loopbackOnly("The briefing endpoint"), async (req, res) => {
  const body = req.body ?? {};

  /* An unrecognised type is a 400, not a briefing.
     This used to read `SYSTEM_PROMPTS[body.type] ? body.type : "morning"`, which
     made a wrong type indistinguishable from no type — so attentionEngine's
     `{ type: "insight" }` (never a key here) was silently served the full
     MORNING BRIEFING prompt, and its `text` field, which buildPrompt does not
     read, vanished. What reached the wall was a model refusal:
     "I need the actual time, day of the week, and season to give you a proper
     briefing." Nobody had asked for a briefing; this line is where the word
     came from. Failing loudly is the whole fix — a caller that names a type
     we do not have has a bug, and it should hear about it on the first call.

     Omitting `type` entirely still means "morning". That is the route's
     documented default and a different statement from naming one wrongly. */
  if (body.type != null && !SYSTEM_PROMPTS[body.type]) {
    return res.status(400).json({
      summary: null,
      error: `Unknown brief type "${body.type}". Expected one of: ${SYSTEM_PROMPTS_TYPES.join(", ")}.`,
    });
  }

  const type   = body.type ?? "morning";
  // Validation above is against SYSTEM_PROMPTS (the contract); the text comes
  // from systemPromptFor(), which is the same string unless the character
  // briefings flag is set. Both generators — Claude and the Ollama fallback —
  // are handed this one value, so the two never diverge in voice.
  const system = systemPromptFor(type);
  const prompt = buildPrompt(body);

  try {
    const summary = await generateWithClaude(type, system, prompt);
    if (summary) {
      reportSuccess("ai");
      return res.json({ summary, source: "claude" });
    }
  } catch (err) {
    console.error("[AI] Claude brief error, falling back to Ollama:", err.message);
  }

  try {
    const summary = await generateWithOllama(type, system, prompt);
    reportSuccess("ai");
    return res.json({ summary, source: "ollama" });
  } catch (err) {
    console.error("[AI] brief error:", err.message);
    reportFailure("ai", err.message);
    return res.status(502).json({ summary: null });
  }
});

export default router;
