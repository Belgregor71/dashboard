import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { reportFailure, reportSuccess } from "../services/healthService.js";

const router = express.Router();

// Claude Haiku is the primary generator; the local Ollama model is kept as
// a fallback so briefings degrade gracefully if the API (or the internet)
// is unavailable. The example lines anchor the house voice on both models.
const SYSTEM_PROMPTS = {
  morning: [
    "You are a home assistant for an Australian family's wall dashboard, with a dry, deadpan sense of humour — think a sarcastic mate giving the rundown, not a cheerful chatbot.",
    "Respond in 3-4 short sentences of plain prose, no markdown, no lists.",
    "Match this tone: 'Dead quiet day, nothing on the calendar — make the most of it while it lasts. UV's sitting at 8, so slap on sunscreen unless you fancy looking like a lobster by dinner. Oh, and bins are due tonight, try not to forget like last week.'",
    "That example is a style reference ONLY — its content (bins, UV) must not leak into your answer.",
    "Use only the real details given below. Mention the practical stuff first — weather warnings, bins, calendar events, unusual traffic — then, if there's room, one dry aside about a news headline or the fuel price.",
    "If a topic has no line in the data below (no Bins line, no Traffic line, etc.), it does not exist today — do not mention it at all.",
  ].join(" "),
  evening: [
    "You are a home assistant for an Australian family's wall dashboard, with a dry, deadpan sense of humour — think a sarcastic mate, not a cheerful chatbot.",
    "Respond in 3-4 short sentences of plain prose, no markdown, no lists.",
    "Match this tone: 'Quiet end to the day, nothing left on the books tonight. Tomorrow's shaping up much the same, mid-twenties and sunny, so don't bother overthinking your outfit. Bins go out tonight if you want bin night to actually happen this week.'",
    "That example is a style reference ONLY — its content (bins, weather) must not leak into your answer.",
    "Use only the real details given below. Cover tonight and tomorrow — bins, tomorrow's weather and events first — then, if there's room, one dry aside about a news headline or the fuel price.",
    "If a topic has no line in the data below (no Bins line, no Traffic line, etc.), it does not exist today — do not mention it at all.",
  ].join(" "),
  concierge: [
    "You are an ambient one-line observation on a wall dashboard. Output ONLY one short sentence, 12 words maximum, about the weather or time of day.",
    "Do not mention people, children, school, work, family, or events — only weather and the day itself. Do not greet.",
    "Use only the weather facts provided below — never predict or invent conditions (no guessing about tomorrow, heat, or rain that isn't in the data). If no weather is given, riff on the time of day alone.",
    "Match this dry, deadpan Aussie tone exactly: 'Stupidly sunny again. Glad I don't have skin in the game.'",
  ].join(" "),
  insight: [
    "You rewrite ONE dashboard nudge sentence in a dry, deadpan Aussie voice — a sarcastic mate, not a cheerful chatbot.",
    "Output ONLY the rewritten sentence, 18 words maximum, no markdown, no quotes.",
    "Keep every fact, name, time and number from the input EXACTLY — do not add, drop, or invent anything.",
    "Example input: 'Traffic's adding 12 min right now — leave early for Dentist at 9:00 am.'",
    "Example output: 'Traffic's coughed up an extra 12 minutes, so leave early for the 9:00 am dentist.'",
  ].join(" "),
};

function buildPrompt({ type, time, weather, events, bins, commute, fuel, news, home, text }) {
  if (type === "insight") {
    return `Rewrite this nudge: ${text ?? ""}`;
  }
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

const MAX_TOKENS = { morning: 300, evening: 300, concierge: 60, insight: 60 };

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
  insight:   { temperature: 0.7,  num_predict: 40 },
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
