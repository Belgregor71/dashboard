# Phase 4 — Give it a voice

_Status: **infrastructure shipped flag-off (2026-07-17)** — the Mode 3 conversation
loop is built and testable end-to-end without hardware; the microphone + wake word
are the only missing pieces. Flag: `features.voiceSession` (default OFF)._

## What this phase is

The last dormant seam in the presence FSM: `MODE.VOICE`. When someone explicitly
wakes the house, the display becomes an assistant — full attention, direct answers —
then gracefully recedes back through the modes. Voice is the only real input surface
the Home OS has (locked decision #1 deleted navigation).

The locked decision (#2, home-os-vision.md): **Assist + Claude, layered.** HA Assist
for wake + device control; a Claude house-voice for open conversation, reusing the
Haiku-primary / fallback pattern. **Guardrail: transcripts go upstream only on
explicit wake — never passive audio.** No audio ever reaches our server; the whole
pipeline is text-in, text-out.

## The loop (built now, hardware-free)

```
explicit wake ──► submitTranscripts(text)          src/js/core/voiceSession.js
                    │  presence → MODE.VOICE        (attention gate stands down —
                    │  overlay → listening/thinking  attentionRank already returns
                    ▼                                nothing in VOICE)
        Lane 1 · local commands                     voiceCommands.dispatchTranscripts
                    │ unmatched                     (actions → questions → nav,
                    ▼                                exactly today's matchers)
        Lane 2 · HA Assist                          POST /api/voice/assist
                    │ handled:false / HA down        → HA /api/conversation/process
                    ▼                                (device control, HA intents,
        Lane 3 · Claude house-voice                  conversation_id continuity)
                    │                               POST /api/voice/converse
                    ▼                                (VOICE_REGISTER system prompt,
        speak(reply) → linger ~8s for follow-up      Haiku primary → Ollama fallback,
                    │                                bounded 6-turn rolling context)
                    ▼
        recede: VOICE → GLANCE → (idle timer) → AMBIENT
```

- **Session state** is bounded and symmetric: rolling history capped at 6 turns,
  cleared on recede; one linger timer, cleared on every entry/exit path (the 24/7
  kiosk discipline).
- **Server shaping** is pure and unit-tested (`server/services/voiceShape.js`):
  HA's conversation payload → `{handled, speech, conversationId}`; converse history
  is re-bounded server-side (never trusted from the client).
- **The house voice** rides the same `VOICE_REGISTER` as every other prompt
  (docs/design/VOICE.md is the copy authority) — spoken replies are 1–2 plain
  sentences, no chatbot cheer.

## Wake sources (who may call `submitTranscripts`)

1. **Space-bar push-to-talk + Web Speech** — today's `voiceCommands.js` recogniser.
   With the flag on, its transcripts route into the session instead of dead-ending
   at "Didn't catch that."
2. **`__voiceTranscript("...")` over CDP** — the hardware-free driver used by the
   Playwright spec (`tests/voice-session.spec.js`) and by Pi-side verification.
   `__voiceSession()` probes {enabled, active, phase, turns, mode}.
3. **The microphone, when it lands** — see below. It becomes just another caller.

## When the hardware arrives (the seam)

Planned pipeline, all on-LAN until the explicit wake:

- A far-field mic (respeaker/USB) on or near the Pi running **wyoming-satellite**
  with **openWakeWord** — wake-word detection stays on-device.
- On wake: HA's Assist pipeline does STT (Whisper via wyoming), producing a
  transcript. HA can act directly (its own conversation agent) — but to keep the
  dashboard the single character, the satellite's transcript is forwarded to the
  kiosk (HA event → existing dashboard websocket lane, or a satellite-side hook)
  and enters `submitTranscripts(text, { source: "wakeword" })`.
- Nothing in voiceSession/voice routes changes: the input adapter is the only new
  code. Mic mute switch = physically severing the only audio path.

Alternative if the satellite route disappoints: push-to-talk hardware button →
Chromium getUserMedia + Web Speech (already wired). Decision deferred until the
mic is chosen.

## What ships in this change

| Piece | File |
|---|---|
| Session FSM, lanes, linger/recede, hooks | `src/js/core/voiceSession.js` |
| Local-lane extraction (behaviour unchanged) | `src/js/core/voiceCommands.js` |
| Assist proxy + Claude converse routes | `server/routes/voice.js` |
| Pure shaping helpers | `server/services/voiceShape.js` |
| Flag (default OFF, byte-identical) | `src/js/config.js` → `voiceSession` |
| Pure tests · contract tests · session drive | `tests/voice.spec.js`, `tests/api.spec.js`, `tests/voice-session.spec.js` |

Flag-off behaviour is today's exactly: local matchers or "Didn't catch that.",
no MODE.VOICE entry, no upstream calls. Revert = one line.

## Open items (blocked on hardware or later taste passes)

- Choose + install the mic; stand up wyoming-satellite + openWakeWord; wire the
  transcript forward into `submitTranscripts`.
- A Mode 3 conversation *surface* — today the reply is spoken with only the small
  overlay pill. A design-track WP should decide whether spoken-only is the right
  restraint or whether the reply deserves a transient hero line.
- Barge-in (interrupting TTS with a follow-up) and wake-word chime.
- `speak()` uses the shared TTS cache — conversational replies are unique text, so
  confirm the existing tts-cache prune keeps up once the mic makes replies frequent.
