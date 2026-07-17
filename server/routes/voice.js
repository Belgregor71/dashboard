import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { haPost } from "../ha/haRest.js";
import { reportFailure, reportSuccess } from "../services/healthService.js";
import { shapeAssistResponse, buildConverseMessages } from "../services/voiceShape.js";
import { VOICE_REGISTER } from "./ai.js";

// Phase 4 "Give it a voice" — the server half of the Mode 3 conversation lanes
// (docs/vision/phase-4-voice.md). Two text-only endpoints, layered per the
// locked decision (home-os-vision.md): HA Assist for device control, a Claude
// house-voice for open conversation. GUARDRAIL: these receive transcripts only
// on an explicit wake — the client never streams passive audio, and no audio
// ever reaches this server; text-in, text-out.

const router = express.Router();

// --- Lane 2: HA Assist (device control + HA's built-in intents) ---

router.post("/api/voice/assist", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });

  const body = { text, language: "en" };
  if (typeof req.body?.conversationId === "string" && req.body.conversationId) {
    body.conversation_id = req.body.conversationId;
  }

  try {
    const payload = await haPost("/api/conversation/process", body);
    reportSuccess("ha");
    return res.json({ ...shapeAssistResponse(payload), source: "assist" });
  } catch (err) {
    // HA down/misconfigured — the client falls through to the converse lane.
    console.error("[Voice] assist error:", err.message);
    return res.status(502).json({ handled: false, speech: null, conversationId: null, source: "assist" });
  }
});

// --- Lane 3: Claude house-voice (open conversation) ---

const CONVERSE_SYSTEM = [
  "You are the voice of an Australian family's home, answering a spoken question on their wall dashboard. Your reply is read aloud.",
  VOICE_REGISTER,
  "Answer in 1-2 short sentences of plain prose — no markdown, no lists, no follow-up questions unless one is genuinely needed.",
  "If you don't know something about this specific house (device states, schedules), say so plainly rather than guessing.",
].join(" ");

const CONVERSE_MAX_TOKENS = 150;

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

async function converseWithClaude(messages) {
  const client = getAnthropic();
  if (!client) return null;
  const msg = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
    max_tokens: CONVERSE_MAX_TOKENS,
    system:     CONVERSE_SYSTEM,
    messages,
  });
  const text = msg.content.find(b => b.type === "text")?.text ?? "";
  return text.trim() || null;
}

async function converseWithOllama(messages) {
  const ollamaUrl   = process.env.OLLAMA_URL   ?? "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL ?? "llama3.2:1b";

  const r = await fetch(`${ollamaUrl}/api/chat`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:    ollamaModel,
      messages: [{ role: "system", content: CONVERSE_SYSTEM }, ...messages],
      stream:   false,
      options:  { temperature: 0.7, num_predict: 60 },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const data = await r.json();
  return (data.message?.content ?? "").trim() || null;
}

router.post("/api/voice/converse", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });

  const messages = buildConverseMessages(text, req.body?.history);

  try {
    const reply = await converseWithClaude(messages);
    if (reply) {
      reportSuccess("ai");
      return res.json({ reply, source: "claude" });
    }
  } catch (err) {
    console.error("[Voice] Claude converse error, falling back to Ollama:", err.message);
  }

  try {
    const reply = await converseWithOllama(messages);
    reportSuccess("ai");
    return res.json({ reply, source: "ollama" });
  } catch (err) {
    console.error("[Voice] converse error:", err.message);
    reportFailure("ai", err.message);
    return res.status(502).json({ reply: null });
  }
});

export default router;
