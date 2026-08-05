import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { loopbackOnly } from "../middleware/security.js";
import { reportFailure, reportSuccess } from "../services/healthService.js";

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
    "Match this tone: 'Quiet one today, thank goodness — nothing on the calendar and I intend to enjoy it. UV's hitting 8 by lunch, so hat and sunscreen if you're heading out, we're not doing sunstroke today. Bins go out tonight, gorgeous.'",
    "Or, on a busier day, the same voice: 'A big one today — three things before lunch, get your skates on. Cool start, warms up by arvo, so dress in layers like the sophisticated people you are.'",
    "Those examples are style references ONLY — their content (bins, UV, events) must not leak into your answer.",
    "Use only the real details given below. Mention the practical stuff first — weather warnings, bins, calendar events, unusual traffic — then, if there's room, one dry aside about a news headline or the fuel price.",
    "If a topic has no line in the data below (no Bins line, no Traffic line, etc.), it does not exist today — do not mention it at all.",
  ].join(" "),
  evening: [
    "You are the voice of an Australian family's home, speaking on their wall dashboard.",
    VOICE_REGISTER,
    TIME_GROUNDING,
    "Respond in 3-4 short sentences of plain prose, no markdown, no lists.",
    "Match this tone: 'Nothing left on the books tonight — the day's officially yours. Tomorrow's mid-twenties and sunny, an absolute cracker. Bins go out tonight, don't make me say it twice.'",
    "Or, with something still on, the same voice: 'One thing left tonight, then you're free. Tomorrow's a top of twenty-six, fine all day — practically showing off.'",
    "Those examples are style references ONLY — their content (bins, weather, events) must not leak into your answer.",
    "Use only the real details given below. Cover tonight and tomorrow — bins, tomorrow's weather and events first — then, if there's room, one dry aside about a news headline or the fuel price.",
    "If a topic has no line in the data below (no Bins line, no Traffic line, etc.), it does not exist today — do not mention it at all.",
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

function buildPrompt({ type, time, weather, events, bins, commute, fuel, news, home }) {
  const lines = [`Time: ${time ?? "unknown"}`];
  if (weather) lines.push(`Weather: ${weather}`);
  if (events)  lines.push(`Calendar: ${events}`);
  if (bins)    lines.push(`Bins: ${bins}`);
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
  const body   = req.body ?? {};
  const type   = SYSTEM_PROMPTS[body.type] ? body.type : "morning";
  const system = SYSTEM_PROMPTS[type];
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
