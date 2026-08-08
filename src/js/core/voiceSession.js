import { getMode, setMode, MODES } from "./presence.js";
import { setVoiceState } from "./voiceOverlay.js";
import { speak, silence, setSpeakingObserver } from "./tts.js";
import { resetIdleTimer } from "../modules/screensaver.js";

// Phase 4 "Give it a voice" (docs/vision/phase-4-voice.md) — the Mode 3
// conversation session, built ahead of the microphone. An explicit wake
// (Space-bar Web Speech today, a wake word when the hardware lands, or the
// __voiceTranscript debug hook) submits TEXT here; the session enters
// MODE.VOICE (the attention gate already stands down), walks three lanes —
//   1. local commands (voiceCommands' matchers: actions/questions/nav)
//   2. HA Assist via /api/voice/assist (device control, HA intents)
//   3. Claude house-voice via /api/voice/converse (open conversation)
// — speaks the reply, lingers briefly for a follow-up, then recedes to
// GLANCE. GUARDRAIL: transcripts go upstream only from an explicit wake;
// there is no passive audio path anywhere in this module.
//
// When the mic lands, its wake-word pipeline just becomes another caller of
// submitTranscripts() — nothing here changes.

const LINGER_MS = 8_000;   // follow-up window after a reply before receding
const MAX_TURNS = 6;       // rolling converse context (3 exchanges), bounded

let enabled = false;
let active = false;
let phase = "idle";        // idle | routing | linger
let busy = false;
let history = [];          // [{ role: "user"|"assistant", text }] — bounded
let assistConversationId = null;
let lingerTimer = null;
let localLane = null;      // registered by voiceCommands (keeps imports acyclic)
let transcriptStream = null;
let streamOpen = false;    // is the mic-bridge SSE connected?

export function isVoiceSessionEnabled() {
  return enabled;
}

// voiceCommands hands us its transcript dispatcher at init so the session can
// try the local lane first without importing voiceCommands (no module cycle).
export function registerLocalLane(fn) {
  localLane = typeof fn === "function" ? fn : null;
}

function clearLinger() {
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
}

function endSession(reason = "linger-timeout") {
  clearLinger();
  history = [];
  assistConversationId = null;
  active = false;
  phase = "idle";
  // Graceful recede: VOICE → GLANCE; the idle timer takes it back to AMBIENT
  // naturally from there. Only touch the mode if voice still owns it.
  if (getMode() === MODES.VOICE) setMode(MODES.GLANCE, `voice-${reason}`);
}

function pushTurn(role, text) {
  if (typeof text !== "string" || !text.trim()) return;
  history.push({ role, text: text.trim() });
  if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS);
}

function finishTurn(userText, replyText) {
  pushTurn("user", userText);
  pushTurn("assistant", replyText);
  phase = "linger";
  clearLinger();
  lingerTimer = setTimeout(() => {
    lingerTimer = null;
    endSession();
  }, LINGER_MS);
}

async function postJson(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return await res.json(); // 502 bodies carry the same shape — parse them too
  } catch {
    return null;
  }
}

// The one entry point. `transcripts` is the recogniser's alternatives, best
// first (a single-element array is fine). Returns { handled }.
export async function submitTranscripts(transcripts, { source = "unknown" } = {}) {
  const cleaned = Array.isArray(transcripts)
    ? transcripts.filter((t) => typeof t === "string" && t.trim())
    : [];
  if (!enabled || cleaned.length === 0) return { handled: false };
  if (busy) return { handled: false, reason: "busy" };
  busy = true;
  clearLinger();
  active = true;
  phase = "routing";
  if (getMode() !== MODES.VOICE) setMode(MODES.VOICE, `voice-wake-${source}`);
  resetIdleTimer();

  try {
    // Lane 1 — local commands. They set their own overlay state + TTS.
    if (localLane) {
      const local = await localLane(cleaned);
      if (local?.handled) {
        finishTurn(cleaned[0], null);
        return { handled: true, lane: "local" };
      }
    }

    const text = cleaned[0];
    setVoiceState("processing", "Thinking");

    // Lane 2 — HA Assist (device control + built-in intents).
    const assist = await postJson("/api/voice/assist", {
      text,
      conversationId: assistConversationId
    });
    if (assist?.conversationId) assistConversationId = assist.conversationId;
    if (assist?.handled) {
      setVoiceState("success", "Done");
      if (assist.speech) speak(assist.speech);
      finishTurn(text, assist.speech);
      return { handled: true, lane: "assist" };
    }

    // Lane 3 — the Claude house-voice, with the bounded rolling context.
    const converse = await postJson("/api/voice/converse", { text, history });
    if (converse?.reply) {
      setVoiceState("success", "Answered");
      speak(converse.reply);
      finishTurn(text, converse.reply);
      return { handled: true, lane: "converse" };
    }

    setVoiceState("error", "Unavailable");
    speak("Voice replies aren't available right now.");
    finishTurn(text, null);
    return { handled: false };
  } finally {
    busy = false;
  }
}

// The mic bridge (project-voice-mic-bridge): the Pi's wake/STT agent POSTs the
// finished transcript to /api/voice/transcript; the server fans it out here. An
// init-once EventSource (native auto-reconnect) — the mic simply becomes another
// caller of submitTranscripts, exactly as the FSM was built to expect. Opened
// only when the flag is on, so flag-off stays byte-identical (no new connection).
function initTranscriptStream() {
  try {
    transcriptStream = new EventSource("/api/voice/stream");
  } catch {
    return;
  }
  transcriptStream.onopen = () => { streamOpen = true; };
  transcriptStream.onerror = () => { streamOpen = false; };
  transcriptStream.addEventListener("voice_transcript", (event) => {
    try {
      const { text } = JSON.parse(event.data);
      const clean = typeof text === "string" ? text.trim().toLowerCase() : "";
      if (clean) submitTranscripts([clean], { source: "mic" });
    } catch {
      // ignore malformed frames
    }
  });
}

/* ── Half duplex ────────────────────────────────────────────────────────────
   Two halves of one conversation rule: the house tells the mic when it is
   talking, and the mic can tell the house to stop.

   Without it the wake agent hears the reply through the kiosk's own speakers
   and answers it — the 2026-08-08 logs are full of the house transcribing
   "It's 18 degrees and clear." back at itself. With it, the agent simply does
   not capture while we are speaking, and a wake word over a reply means
   someone wants the floor rather than someone asking a question. */
function reportSpeaking(on) {
  // Fire and forget. The reply is already playing; nothing here is allowed to
  // await, retry or throw, because the only thing at stake is whether the mic
  // gates for the next two seconds.
  fetch("/api/voice/speaking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speaking: on === true }),
    // The kiosk does not unload, but a deploy-time teardown mid-utterance
    // would otherwise leave the agent gated on a page that no longer exists.
    keepalive: true
  }).catch(() => { /* the agent fails open — see its _speaking default */ });
}

function initHalfDuplex() {
  setSpeakingObserver(reportSpeaking);
  transcriptStream?.addEventListener("voice_barge_in", () => {
    silence();
    // Hold the session open. Someone who cuts a reply short is mid-turn, not
    // done — receding to GLANCE here would make the follow-up a cold start.
    if (active) {
      clearLinger();
      phase = "linger";
      lingerTimer = setTimeout(() => {
        lingerTimer = null;
        endSession("barge-in");
      }, LINGER_MS);
    }
    setVoiceState("listening", "Listening");
  });
}

export function initVoiceSession({ enabled: on = false, halfDuplex = false } = {}) {
  enabled = on === true;

  // Debug/verification hooks — the hardware-free drivers (match __presence /
  // __forceCandidate style). Defined even flag-off so the Pi can probe state.
  window.__voiceSession = () => ({
    enabled,
    active,
    phase,
    turns: history.length,
    conversationId: assistConversationId,
    streamOpen,
    halfDuplex: halfDuplex === true,
    mode: getMode()
  });
  window.__voiceTranscript = (text) =>
    submitTranscripts([String(text ?? "").toLowerCase().trim()], { source: "debug" });

  if (enabled) {
    initTranscriptStream();
    // After the stream exists — initHalfDuplex subscribes to it, and a listener
    // registered against a null EventSource is the kind of ordering bug this
    // suite has caught before.
    if (halfDuplex === true) initHalfDuplex();
    console.info("Voice session ready — Mode 3 lanes armed (local → assist → converse)");
  }
}
