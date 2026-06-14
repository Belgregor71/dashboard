import express from "express";

const router = express.Router();

const SYSTEM_PROMPTS = {
  morning: [
    "You are a concise home assistant for an Australian family's wall dashboard.",
    "Always respond in exactly 2-3 complete sentences.",
    "Use plain conversational English — no bullet points, no markdown, no lists.",
    "Focus on the most time-sensitive or important information. Be warm and direct.",
  ].join(" "),
  evening: [
    "You are a concise home assistant for an Australian family's wall dashboard.",
    "Always respond in exactly 2-3 complete sentences.",
    "Use plain conversational English — no bullet points, no markdown, no lists.",
    "Summarise what's left of the evening and preview tomorrow. Be warm and relaxed in tone.",
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

router.post("/api/ai/brief", async (req, res) => {
  const ollamaUrl   = process.env.OLLAMA_URL   ?? "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL ?? "llama3.2:1b";

  try {
    const body   = req.body ?? {};
    const system = SYSTEM_PROMPTS[body.type] ?? SYSTEM_PROMPTS.morning;

    const r = await fetch(`${ollamaUrl}/api/generate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:   ollamaModel,
        system,
        prompt:  buildPrompt(body),
        stream:  false,
        options: { temperature: 0.72, num_predict: 120 },
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
