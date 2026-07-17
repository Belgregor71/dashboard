import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { reportFailure, reportSuccess } from "../services/healthService.js";

const router = express.Router();

// Claude Haiku is the primary generator; the local Ollama model is kept as
// a fallback so briefings degrade gracefully if the API (or the internet)
// is unavailable. The example lines anchor the house voice on both models.
// The register (docs/design/VOICE.md) in miniature — quoted by every prompt.
export const VOICE_REGISTER =
  "Your voice: calm, brief, plainly Australian — the natural word (bins, arvo, tradie), never forced slang like 'mate' or 'ya'. " +
  "One dry observation at most, and only if the moment earns it — no sarcasm, no punchlines, no nagging, no scolding, no apologising, no exclamation marks, no chatbot cheer.";

const SYSTEM_PROMPTS = {
  morning: [
    "You are the voice of an Australian family's home, speaking on their wall dashboard.",
    VOICE_REGISTER,
    "Respond in 3-4 short sentences of plain prose, no markdown, no lists.",
    "Match this tone: 'Quiet one today — nothing on the calendar. UV hits 8 by lunch, so hat and sunscreen if you're out. Bins go out tonight.'",
    "That example is a style reference ONLY — its content (bins, UV) must not leak into your answer.",
    "Use only the real details given below. Mention the practical stuff first — weather warnings, bins, calendar events, unusual traffic — then, if there's room, one dry aside about a news headline or the fuel price.",
    "If a topic has no line in the data below (no Bins line, no Traffic line, etc.), it does not exist today — do not mention it at all.",
  ].join(" "),
  evening: [
    "You are the voice of an Australian family's home, speaking on their wall dashboard.",
    VOICE_REGISTER,
    "Respond in 3-4 short sentences of plain prose, no markdown, no lists.",
    "Match this tone: 'Nothing left on the books tonight. Tomorrow's mid-twenties and sunny — an easy one. Bins go out tonight.'",
    "That example is a style reference ONLY — its content (bins, weather) must not leak into your answer.",
    "Use only the real details given below. Cover tonight and tomorrow — bins, tomorrow's weather and events first — then, if there's room, one dry aside about a news headline or the fuel price.",
    "If a topic has no line in the data below (no Bins line, no Traffic line, etc.), it does not exist today — do not mention it at all.",
  ].join(" "),
  concierge: [
    "You are an ambient one-line observation on a wall dashboard. Output ONLY one short sentence, 12 words maximum, about the weather or time of day.",
    VOICE_REGISTER,
    "Do not mention people, children, school, work, family, or events — only weather and the day itself. Do not greet.",
    "Use only the weather facts provided below — never predict or invent conditions (no guessing about tomorrow, heat, or rain that isn't in the data). If no weather is given, riff on the time of day alone.",
    "Match this tone exactly: 'Warm already, and it's not even nine.'",
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

router.post("/api/ai/brief", async (req, res) => {
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
