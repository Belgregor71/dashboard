import express from "express";
import { EventEmitter } from "node:events";
import Anthropic from "@anthropic-ai/sdk";
import { haPost } from "../ha/haRest.js";
import { isLoopback, loopbackOnly } from "../middleware/security.js";
import { reportFailure, reportSuccess } from "../services/healthService.js";
import {
  shapeAssistResponse,
  buildConverseMessages,
  buildConverseSystem,
  todayLine,
  GRIEF_LINE,
  SPEAKER_UNKNOWN_LINE
} from "../services/voiceShape.js";
import { searchVault, buildContext } from "../services/vaultIndex.js";
import { createSoundDetector } from "../services/soundPresence.js";
import { VOICE_REGISTER } from "./ai.js";

// Phase 4 "Give it a voice" — the server half of the Mode 3 conversation lanes
// (docs/vision/phase-4-voice.md). Two text-only endpoints, layered per the
// locked decision (home-os-vision.md): HA Assist for device control, a Claude
// house-voice for open conversation. GUARDRAIL: these receive transcripts only
// on an explicit wake — the client never streams passive audio, and no audio
// ever reaches this server; text-in, text-out.

const router = express.Router();

// --- Lane 2: HA Assist (device control + HA's built-in intents) ---

// Loopback-gated like the converse lane, for a different reason: this one is
// free but it drives the house. It forwards to HA's conversation agent, which
// honours no SAFE_SERVICES allowlist — "turn off the lights" is a sentence, not
// a service call, so the careful gate on /api/ha/services routes around it.
// The only legitimate caller is the kiosk page, which runs on the Pi.
router.post("/api/voice/assist", loopbackOnly("The assist endpoint"), async (req, res) => {
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

const CONVERSE_BASE = [
  "You are the voice of an Australian family's home, answering a spoken question on their wall dashboard. Your reply is read aloud.",
  VOICE_REGISTER,
  GRIEF_LINE,
  SPEAKER_UNKNOWN_LINE,
  "Answer in 1-2 short sentences of plain prose — no markdown, no lists, no follow-up questions unless one is genuinely needed.",
];

// The house knowledge base (docs/design/VAULT.md) is what makes the concierge's
// "I don't know anything about this house" line answerable instead of a dead
// end: notes the household wrote in Obsidian are retrieved against the question
// and quoted in. Injected into the SYSTEM prompt rather than the messages array
// so buildConverseMessages() stays pure and its existing tests hold.
//
// The env var is read HERE, per request, NOT at module load: server.js's static
// imports all evaluate before its dotenv.config(), so a module-scope read would
// see undefined on the Pi every time. (Exactly how KOKORO_VOICE was silently
// ignored for weeks — see project-voice-blend.)
//
// With the vault off, or with no note clearing the score floor, the context is
// empty and buildConverseSystem returns the original prompt byte for byte.
function converseSystem(text) {
  const context =
    process.env.VAULT_ENABLED === "1" ? buildContext(searchVault(text)) : "";
  // todayLine() is appended per request, not baked into CONVERSE_BASE — the
  // date has to be current at answer time, and this route outlives midnight.
  return buildConverseSystem([...CONVERSE_BASE, todayLine()], context);
}

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

async function converseWithClaude(messages, system) {
  const client = getAnthropic();
  if (!client) return null;
  const msg = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
    max_tokens: CONVERSE_MAX_TOKENS,
    system,
    messages,
  });
  const text = msg.content.find(b => b.type === "text")?.text ?? "";
  return text.trim() || null;
}

async function converseWithOllama(messages, system) {
  const ollamaUrl   = process.env.OLLAMA_URL   ?? "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL ?? "llama3.2:1b";

  const r = await fetch(`${ollamaUrl}/api/chat`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:    ollamaModel,
      messages: [{ role: "system", content: system }, ...messages],
      stream:   false,
      options:  { temperature: 0.7, num_predict: 60 },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const data = await r.json();
  return (data.message?.content ?? "").trim() || null;
}

router.post("/api/voice/converse", loopbackOnly("The converse endpoint"), async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });

  const messages = buildConverseMessages(text, req.body?.history);
  // Retrieved once and shared by both legs, so the Ollama fallback answers from
  // the same notes rather than reverting to "I don't know".
  const system = converseSystem(text);

  try {
    const reply = await converseWithClaude(messages, system);
    if (reply) {
      reportSuccess("ai");
      return res.json({ reply, source: "claude" });
    }
  } catch (err) {
    console.error("[Voice] Claude converse error, falling back to Ollama:", err.message);
  }

  try {
    const reply = await converseWithOllama(messages, system);
    reportSuccess("ai");
    return res.json({ reply, source: "ollama" });
  } catch (err) {
    console.error("[Voice] converse error:", err.message);
    reportFailure("ai", err.message);
    return res.status(502).json({ reply: null });
  }
});

// --- Mic bridge: transcript injection + SSE fan-out to the kiosk page ---
// The mic's last mile (project-voice-mic-bridge): the Pi's on-device wake/STT
// agent (openWakeWord + whisper) POSTs the FINISHED TRANSCRIPT here, and we fan
// it out over an SSE stream the kiosk subscribes to, which then calls
// submitTranscripts(). Audio never reaches this server — only the final text,
// and only from loopback (the agent runs on the Pi; the dashboard also serves
// on the LAN, so the guard keeps arbitrary LAN clients from injecting speech).
// GUARDRAIL unchanged: text arrives only after an explicit on-device wake.

const voiceBus = new EventEmitter();

function toSse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

router.post("/api/voice/transcript", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });
  voiceBus.emit("transcript", { text, source: "mic" });
  return res.json({ ok: true });
});

// Microphone LEVEL, not audio. The wake agent already computes an RMS per 80ms
// frame for its endpointing, so this is a number it has in hand — no new audio
// processing, and still no audio anywhere near this server.
//
// It exists for one reason: the listening light. A rim that animates on a timer
// rather than on the room reads as fake within about two seconds, and once it
// reads as fake the room stops trusting that it was heard.
//
// ~12.5 frames/sec. Two things make that safe rather than reckless:
//  - the global rate limiter is `skip: isLoopback`, and the agent posts to
//    localhost, so 750 req/min never touches the 600/min budget;
//  - 204 with no body, no logging and no health reporting, because a hot path
//    that writes a log line per frame is how you turn a UI cue into a disk cost.
router.post("/api/voice/level", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  // typeof, not Number(): Number(null) is 0, which is finite and non-negative,
  // so a null rms would have sailed through as "silence" rather than being
  // rejected as the malformed frame it is.
  const rms = req.body?.rms;
  if (typeof rms !== "number" || !Number.isFinite(rms) || rms < 0) {
    return res.status(400).json({ error: "rms must be a non-negative number" });
  }
  voiceBus.emit("level", { rms });
  return res.status(204).end();
});

// --- Half duplex: the house must not answer its own voice ---
// The mic and the HDMI speakers share a room. On 2026-08-08/09 the wake agent
// transcribed the dashboard's own replies straight back into this pipeline —
// "It's 18 degrees and clear.", "Everything's healthy." — and the house
// answered itself. The agent's half of that fix needs one fact it cannot
// observe: whether a reply is playing right now. The page knows, so the page
// says, and this holds the answer between them.
//
// One boolean of shared state, deliberately. It is a property of the single
// kiosk's single pair of speakers, not of a session or a connection.
let speaking = false;

router.post("/api/voice/speaking", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  // Strict boolean, not truthiness: "false" and 0 are both things a caller
  // sends by accident, and either would silently invert the gate.
  const on = req.body?.speaking;
  if (typeof on !== "boolean") {
    return res.status(400).json({ error: "speaking must be a boolean" });
  }
  speaking = on;
  voiceBus.emit("speaking", { speaking });
  return res.status(204).end();
});

// --- Sound as presence ---
// The agent reports room loudness once a second; soundPresence.js decides
// whether that is a person. See that file for why the statistic is an excursion
// above an adaptive floor rather than a threshold.
//
// ⚠ Deliberately NOT /api/voice/level. That one is the listening rim: ~12.5 Hz,
// only during a capture, and it decays on the client. This is 1 Hz, always, and
// it must not touch the rim — conflating them would make the ring glow whenever
// the kitchen was noisy and never stop.
//
// The SSE carries TRANSITIONS, not samples. The detector lives here rather than
// on the page precisely so that a permanent 1 Hz feed does not ride a stream the
// page keeps open for weeks.
const ambient = createSoundDetector();

router.post("/api/voice/ambient", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  const rms = req.body?.rms;
  // typeof, not Number(): Number(null) is 0, which is finite and non-negative,
  // so a null rms would be recorded as genuine silence and drag the floor down.
  if (typeof rms !== "number" || !Number.isFinite(rms) || rms < 0) {
    return res.status(400).json({ error: "rms must be a non-negative number" });
  }
  // `speaking` is read from the server's own flag, not the body: the page is
  // the author of that fact and already posts it, so asking the agent to
  // re-assert it would create a second, laggier source of the same truth.
  const result = ambient.push({ rms, speaking });
  if (result.emit) {
    voiceBus.emit("sound_presence", {
      at: Date.now(),
      db: Math.round(result.db * 10) / 10,
      floorDb: Math.round(result.floor * 10) / 10,
      excursionDb: Math.round(result.excursion * 10) / 10
    });
  }
  return res.status(204).end();
});

// Read-only, and not loopback-gated: it is a handful of loudness statistics
// with no audio in it, and it is the only way to tune the thresholds against
// this actual kitchen rather than a guess.
// `?series=1` adds the raw dB series behind it — the only thing that can tune
// `consecutive`, since a lone 12 dB peak and two adjacent 9 dB samples share
// every summary statistic and disagree about whether anyone is there.
router.get("/api/voice/ambient", (req, res) => {
  res.json(ambient.state(Date.now(), { series: req.query?.series === "1" }));
});

// The agent asking for the floor. It POSTs this when the wake word is spoken
// over a reply; the page listens for the fan-out and calls tts.silence().
router.post("/api/voice/barge-in", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  voiceBus.emit("barge_in", { at: Date.now() });
  return res.json({ ok: true });
});

router.get("/api/voice/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(": voice-stream open\n\n");

  // Two flavours of subscriber on one route. The wake agent wants ONLY the
  // speaking state; handing it the kiosk's feed would push ~12.5 level frames a
  // second at the process that generated them. The kiosk wants everything
  // except the speaking state, which it is the author of.
  const forAgent = req.query?.agent === "1";
  const listeners = [];
  const subscribe = (event, name) => {
    const fn = (payload) => res.write(toSse(name, payload));
    voiceBus.on(event, fn);
    listeners.push([event, fn]);
  };

  if (forAgent) {
    // Current state first. The agent reconnects after every deploy, and a
    // subscriber that learns nothing until the next CHANGE would sit on a
    // stale default through the whole reply that is playing as it connects.
    res.write(toSse("voice_speaking", { speaking }));
    subscribe("speaking", "voice_speaking");
  } else {
    subscribe("transcript", "voice_transcript");
    // Level rides the SAME connection as the transcript rather than opening its
    // own. Six connections per host is the browser's ceiling, and two
    // never-ending SSE streams have already starved a media request in this
    // house — a second stream for a cosmetic cue would be a poor trade.
    subscribe("level", "voice_level");
    subscribe("barge_in", "voice_barge_in");
    // Transitions only — a rising edge, then at most one every 10s while the
    // room stays busy. Cheap enough to ride the same connection.
    subscribe("sound_presence", "voice_sound_presence");
  }

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    // Symmetric teardown per SSE client — this page runs for weeks.
    for (const [event, fn] of listeners) voiceBus.off(event, fn);
  });
});

export default router;
