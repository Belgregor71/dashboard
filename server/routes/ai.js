import express from "express";

const router = express.Router();

// These prompts lean on a concrete example response rather than just
// describing a vibe — the small local model (llama3.2:1b) follows a
// tone-by-example far more reliably than an abstract "be witty" instruction.
const SYSTEM_PROMPTS = {
  morning: [
    "You are a home assistant for an Australian family's wall dashboard, with a dry, deadpan sense of humour — think a sarcastic mate giving the rundown, not a cheerful chatbot.",
    "Respond in exactly 2-3 short sentences, no markdown, no lists.",
    "Match this tone and brevity exactly: 'Dead quiet day, nothing on the calendar — make the most of it while it lasts. UV's sitting at 8, so slap on sunscreen unless you fancy looking like a lobster by dinner. Oh, and bins are due tonight, try not to forget like last week.'",
    "Use the real details given below, not the example itself, but copy that level of dry wit and brevity, and make sure to mention anything practical (weather warnings, bins, calendar events) from the real data provided.",
  ].join(" "),
  evening: [
    "You are a home assistant for an Australian family's wall dashboard, with a dry, deadpan sense of humour — think a sarcastic mate, not a cheerful chatbot.",
    "Respond in exactly 2-3 short sentences, no markdown, no lists.",
    "Match this tone and brevity exactly: 'Quiet end to the day, nothing left on the books tonight. Tomorrow's shaping up much the same, mid-twenties and sunny, so don't bother overthinking your outfit. Bins go out tonight if you want bin night to actually happen this week.'",
    "Use the real details given below, not the example itself, but copy that level of dry wit and brevity, and make sure to mention anything practical (weather warnings, bins, calendar events) from the real data provided.",
  ].join(" "),
  concierge: [
    "You are an ambient one-line observation on a wall dashboard. Output ONLY one short sentence, 12 words maximum, about the weather or time of day.",
    "Do not mention people, children, school, work, family, or events — only weather and the day itself. Do not greet.",
    "Match this dry, deadpan Aussie tone exactly: 'Stupidly sunny again. Glad I don't have skin in the game.'",
  ].join(" "),
};

function buildPrompt({ type, time, weather, events, bins, home }) {
  const lines = [`Time: ${time ?? "unknown"}`];
  if (weather) lines.push(`Weather: ${weather}`);
  if (events)  lines.push(`Calendar: ${events}`);
  if (bins)    lines.push(`Bins: ${bins}`);
  if (home)    lines.push(`Home: ${home}`);
  const verb = type === "evening" ? "the rest of the evening and tomorrow" : "the day ahead";
  return `Briefly summarise ${verb} for this family:\n${lines.join("\n")}`;
}

const GENERATE_OPTIONS = {
  morning:   { temperature: 0.75, num_predict: 120 },
  evening:   { temperature: 0.75, num_predict: 120 },
  concierge: { temperature: 0.85, num_predict: 25 },
};

router.post("/api/ai/brief", async (req, res) => {
  const ollamaUrl   = process.env.OLLAMA_URL   ?? "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL ?? "llama3.2:1b";

  try {
    const body   = req.body ?? {};
    const system = SYSTEM_PROMPTS[body.type] ?? SYSTEM_PROMPTS.morning;
    const options = GENERATE_OPTIONS[body.type] ?? GENERATE_OPTIONS.morning;

    const r = await fetch(`${ollamaUrl}/api/generate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:   ollamaModel,
        system,
        prompt:  buildPrompt(body),
        stream:  false,
        options,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    const data = await r.json();
    res.json({ summary: (data.response ?? "").trim() });
  } catch (err) {
    console.error("[AI] brief error:", err.message);
    res.status(502).json({ summary: null });
  }
});

export default router;
