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
  houseContext,
  unresolvedContext,
  takeSentences,
  todayLine,
  GRIEF_LINE,
  SPEAKER_UNKNOWN_LINE
} from "../services/voiceShape.js";
import { searchVault, buildContext } from "../services/vaultIndex.js";
import { createSoundDetector } from "../services/soundPresence.js";
import { toolDefs, entityRoster, planCall } from "../services/voiceTools.js";
import { houseCharacter, characterEnabled } from "../services/character.js";
import { recordExchange } from "../services/conversationLog.js";
import { openItems, resolvedItems } from "../services/unresolved.js";
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

/* The character build of the same block (docs/design/CHARACTER.md).
 *
 * ⚠ ORDERING IS LOAD-BEARING, not cosmetic. Everything in this array is
 * IDENTICAL on every turn, which is what makes it a cacheable prefix. The
 * volatile lines — todayLine()'s clock, the entity roster, the house digest,
 * the retrieved memories — are appended by converseSystem() AFTER this, and
 * they must stay after it. Promote any one of them into this array and the
 * prefix changes every turn, the cache read silently drops to zero, and
 * nothing anywhere reports that it happened.
 *
 * GRIEF_LINE and SPEAKER_UNKNOWN_LINE are reused verbatim rather than folded
 * into character.js: both are stable, both are already unit-tested, and both
 * are about correctness rather than personality. The character page restates
 * their substance for the model's benefit; these two are the enforcement. */
const CHARACTER_BASE = [
  houseCharacter(),
  GRIEF_LINE,
  SPEAKER_UNKNOWN_LINE,
  "Your reply is spoken aloud, so keep it to 1-2 short sentences of plain prose — no markdown, no lists, no follow-up question unless you genuinely need one to answer.",
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
// The tool lane, armed per request for the same reason VAULT_ENABLED is read
// here and not at module scope (see the note above): server.js's static imports
// all evaluate before its dotenv.config(), so a module-scope read sees undefined
// on the G11 every time.
//
// Default OFF. With the flag off — or with the roster left unseeded, which
// makes toolDefs() return [] — no `tools` key reaches the API and the request is
// byte-identical to before this lane existed.
function armedTools() {
  return process.env.VOICE_TOOLS_ENABLED === "1" ? toolDefs() : [];
}

/* ⚠ PROMPT CACHING WAS CONSIDERED HERE AND DELIBERATELY NOT ADDED. Measured
   2026-08-15: the stable prefix (character + grief + speaker lines) is 5,102
   characters, roughly 1,340 tokens. Claude Haiku 4.5's minimum cacheable
   prefix is 4,096 tokens — below it, a `cache_control` marker caches nothing,
   reports nothing, and errors on nothing. It would be a dead lever, and a
   flag-shaped comment claiming a saving that never happens is worse than no
   caching at all.

   The ordering below is kept anyway — stable block, then todayLine()'s clock,
   then the roster, then the volatile house digest — because it costs nothing
   and it is the precondition for caching ever working. If the prefix grows
   past 4,096 tokens, or the model moves to one with a lower floor (Sonnet 5 is
   1,024, Opus 5 is 512), a breakpoint on the last stable block is then the
   whole change. Prove it with `usage.cache_read_input_tokens`, never by
   reasoning: zero across two identical-prefix turns means an invalidator
   survived.

   Exported for tests/voice.spec.js only. The property that matters — flag-off
   is byte-identical to the pre-character prompt — is not observable from
   outside the route, and a rollback path nothing can assert is a rollback path
   nobody should trust. */
export function converseSystem(text, tools, digest = null) {
  const context =
    process.env.VAULT_ENABLED === "1" ? buildContext(searchVault(text)) : "";
  // todayLine() is appended per request, not baked into the base — the
  // date has to be current at answer time, and this route outlives midnight.
  // The roster rides along only when tools actually shipped: naming things the
  // model has no tool for is how you get a confident claim that the light is off.
  //
  // With the character off this is the pre-2026-08-15 prompt byte for byte,
  // which is the rollback path and the property tests/voice.spec.js asserts.
  const base = characterEnabled() ? CHARACTER_BASE : CONVERSE_BASE;
  const lines = [...base, todayLine()];
  if (tools.length) lines.push(entityRoster());

  /* What the house can see, appended AFTER the stable block and the clock.
     Read per call, not at module load — server.js's static imports all
     evaluate before its dotenv.config(), so a module-scope read sees undefined
     on the G11 every time. Off by default: this is the first thing that sends
     the family's calendar titles and shopping list upstream, which is a
     separate consent from giving the house a character. */
  if (process.env.VOICE_HOUSE_CONTEXT === "1") {
    const house = houseContext(digest);
    if (house) lines.push(house);

    /* What the house cannot account for. Rides the same flag as the rest of
       the live state — it is house state, just the part with a question mark
       over it — and is read here rather than passed in because it is the
       server's own observation, not the page's. */
    const wondering = unresolvedContext(openItems(), resolvedItems());
    if (wondering) lines.push(wondering);
  }

  return buildConverseSystem(lines, context);
}

// Raised from 150 when the tool lane landed. max_tokens caps tool_use blocks and
// the spoken reply TOGETHER, and 150 truncates mid-tool-call — which surfaces as
// a turn that says nothing and does nothing. The reply stays short because
// CONVERSE_BASE asks for 1-2 sentences, not because the ceiling forces it.
const CONVERSE_MAX_TOKENS = 400;

// A device turn costs a round-trip per tool round. Three is enough for "turn off
// the lamp and pause the music" (one round, two parallel calls) plus a retry
// after a rejection; past that the house is stuck in a loop nobody asked for.
const MAX_TOOL_ROUNDS = 3;

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

// Execute one tool_use block and shape its tool_result. Never throws: a refusal
// and a dead HA are both answers the model can speak, and an exception here
// would drop the whole turn into the Ollama fallback, which has no tools and
// would cheerfully claim the light is off.
async function runToolCall(block) {
  const plan = planCall(block.name, block.input);
  if (!plan.ok) {
    return { type: "tool_result", tool_use_id: block.id, content: plan.reason, is_error: true };
  }
  try {
    await haPost(`/api/services/${plan.domain}/${plan.service}`, plan.body);
    reportSuccess("ha");
    return { type: "tool_result", tool_use_id: block.id, content: "done" };
  } catch (err) {
    console.error(`[Voice] tool ${plan.domain}.${plan.service} failed:`, err.message);
    reportFailure("ha", err.message);
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: "the house did not respond",
      is_error: true
    };
  }
}

/* One round of the model, streamed, emitting whole sentences as they land.
 *
 * ⚠ TOOL ROUNDS MUST NOT SPEAK THEIR BUFFER. A round that ends in tool_use is
 * not the answer — the loop below runs the tool and asks again — so anything
 * it wrote is a preamble, and today's non-streaming path never speaks it. The
 * moment a tool_use block opens, emission stops for the rest of the round.
 *
 * Anything already emitted before that point HAS been spoken, and that is a
 * deliberate trade rather than a leak: it can only be a leading sentence like
 * "Righto, let me get that", which is exactly what a person says before doing
 * something. Silence, then a click, is the worse of the two.
 */
async function streamRound(client, { system, turns, tools, onChunk }) {
  const stream = client.messages.stream({
    model:      process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
    max_tokens: CONVERSE_MAX_TOKENS,
    system,
    messages:   turns,
    ...(tools.length ? { tools } : {})
  });

  let buffer = "";
  let toolSeen = false;

  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
      toolSeen = true;
    }
  });

  stream.on("text", (delta) => {
    if (toolSeen) return;
    buffer += delta;
    const { chunks, rest } = takeSentences(buffer);
    buffer = rest;
    for (const chunk of chunks) onChunk(chunk);
  });

  const msg = await stream.finalMessage();

  // The trailing fragment: the only moment end-of-text really is the end of a
  // sentence, which is why takeSentences() refuses to guess at it.
  const tail = buffer.trim();
  if (!toolSeen && tail) onChunk(tail);

  return msg;
}

async function converseWithClaude(messages, system, tools = [], onChunk = null) {
  const client = getAnthropic();
  if (!client) return null;

  const turns = [...messages];
  for (let round = 0; ; round += 1) {
    // Streaming is opt-in per request. With no onChunk this is the original
    // call, unchanged — the non-streaming path stays the contract every
    // existing caller and test relies on.
    const msg = onChunk
      ? await streamRound(client, { system, turns, tools, onChunk })
      : await client.messages.create({
          model:      process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
          max_tokens: CONVERSE_MAX_TOKENS,
          system,
          messages:   turns,
          // Omitted entirely when disarmed, so the flag-off request is unchanged.
          ...(tools.length ? { tools } : {})
        });

    const text = (msg.content.find(b => b.type === "text")?.text ?? "").trim();
    if (msg.stop_reason !== "tool_use") return text || null;

    if (round >= MAX_TOOL_ROUNDS) {
      // Still asking for tools at the cap. The pending calls are deliberately
      // NOT run. Answer honestly rather than returning null: null falls through
      // to the Ollama leg, which has no tools, no idea a device was involved,
      // and would happily say the light is off.
      console.warn(`[Voice] tool loop hit ${MAX_TOOL_ROUNDS} rounds; stopping`);
      return text || "I got tangled up doing that — can you ask me again?";
    }

    // The full content, not just the text: dropping the tool_use blocks breaks
    // the pairing the next request validates against.
    turns.push({ role: "assistant", content: msg.content });

    const calls = msg.content.filter(b => b.type === "tool_use");
    const results = await Promise.all(calls.map(runToolCall));
    // ALL results in ONE user message. Splitting them across messages trains the
    // model out of asking for parallel calls, and "lights off and pause the
    // music" is exactly the turn that wants them.
    turns.push({ role: "user", content: results });
  }
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
  // Armed once per turn so the roster in the prompt and the tools in the request
  // can never disagree — naming a light the model has no tool for is how you get
  // a confident lie about it.
  const tools = armedTools();
  // Retrieved once and shared by both legs, so the Ollama fallback answers from
  // the same notes rather than reverting to "I don't know".
  // `house` is the client's houseDigest() — the page already holds the snapshot
  // at submit() time, so grounding the model costs tokens and not a millisecond.
  const system = converseSystem(text, tools, req.body?.house);

  /* Episodic memory, recorded HERE rather than from the page.
     Only this lane is worth remembering: local and Assist turns are the
     weather, the time, the lights — precisely the transient chatter the
     distillation prompt is told to throw away. Recording server-side costs
     the client nothing and needs no new endpoint.

     ⚠ FLOATED, NEVER AWAITED. The room already has its answer by the time
     this runs, and a slow or failing disk write must not delay the next turn
     or fail this one. recordExchange() never throws by contract; the .catch
     is belt and braces on a promise nobody is holding. */
  const remember = (reply) => {
    recordExchange({ said: text, replied: reply }).catch(() => {});
  };

  /* ── The streamed turn ──────────────────────────────────────────────────
     Opt-in per request. The room's wait used to be strictly serial — the whole
     answer, then the whole WAV — so nothing was heard for the sum of both.
     Sentences go out as they are written and the page synthesises the first
     while the model is still on the second.

     SSE rather than chunked JSON so the client uses the same EventSource-shaped
     handling it already has for the transcript stream, and so a mid-reply
     failure can be reported as an event rather than a truncated body.

     ⚠ There is no Ollama fallback on this path, deliberately. Falling back
     mid-stream would mean speaking the first half of one model's answer and
     the second half of another's. If Claude fails here the client is told, and
     it retries the ordinary JSON route — which does have the fallback. */
  if (req.body?.stream === true) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const spoken = [];
    // The socket can close mid-reply — someone walks off, the page reloads.
    // Writing to a dead response throws; stop generating instead.
    let open = true;
    res.on("close", () => { open = false; });

    try {
      const reply = await converseWithClaude(messages, system, tools, (chunk) => {
        spoken.push(chunk);
        if (open) res.write(toSse("chunk", { text: chunk }));
      });
      if (!open) return res.end();

      // `reply` is the model's full text; `spoken` is what actually went out.
      // They agree except when a tool round suppressed emission, and the
      // client needs the authoritative version for its transcript.
      const full = reply ?? spoken.join(" ");
      reportSuccess("ai");
      remember(full);
      res.write(toSse("done", { reply: full, source: "claude" }));
      return res.end();
    } catch (err) {
      console.error("[Voice] streamed converse failed:", err.message);
      reportFailure("ai", err.message);
      if (open) res.write(toSse("failed", { spoken: spoken.length }));
      return res.end();
    }
  }

  try {
    const reply = await converseWithClaude(messages, system, tools);
    if (reply) {
      reportSuccess("ai");
      remember(reply);
      return res.json({ reply, source: "claude" });
    }
  } catch (err) {
    console.error("[Voice] Claude converse error, falling back to Ollama:", err.message);
  }

  try {
    const reply = await converseWithOllama(messages, system);
    reportSuccess("ai");
    remember(reply);
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
  /* Silero's speech probability, when the agent is new enough to send it. It is
     OPTIONAL on purpose: the agent lives outside the repo and is copied by hand,
     so a dashboard newer than the agent is a real state, and it must degrade to
     loudness rather than 400 the mic's only presence relay.
     Out-of-range values are dropped rather than clamped — a 7 from a mismatched
     future agent means something we do not understand, and clamping it to 1
     would silently assert "definitely a person" forever. */
  const rawSpeech = req.body?.speech;
  const speech = typeof rawSpeech === "number" && Number.isFinite(rawSpeech)
    && rawSpeech >= 0 && rawSpeech <= 1 ? rawSpeech : null;
  // `speaking` is read from the server's own flag, not the body: the page is
  // the author of that fact and already posts it, so asking the agent to
  // re-assert it would create a second, laggier source of the same truth.
  const result = ambient.push({ rms, speech, speaking });
  if (result.emit) {
    voiceBus.emit("sound_presence", {
      at: Date.now(),
      db: Math.round(result.db * 10) / 10,
      floorDb: Math.round(result.floor * 10) / 10,
      excursionDb: Math.round(result.excursion * 10) / 10,
      // What actually decided, carried to the client for the same reason
      // presence reports lastReason: two sources that look identical from
      // outside are how 22 hours got lost to a dead camera.
      speech: result.speech,
      decidedBy: result.speech === null ? "loudness" : "speech"
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
