# Voice upgrades — the field, reviewed against what is already on the wall

> Written 2026-08-22, answering "review these two Jarvis repos and research anything more
> advanced that could make Mycroft better." Two repos were named:
> [FatihMakes/Mark-LI](https://github.com/FatihMakes/Mark-LI) and
> [jaredrhod/fullstack-agent](https://github.com/jaredrhod/fullstack-agent).
>
> **The owner's constraint, taken as absolute: nothing leaves the box until the wake word
> fires.** Every recommendation below runs on the G11 or the PC. That single line rules out
> most of what the "Jarvis" genre is currently built on, and the rejections in §4 are mostly
> downstream of it.
>
> Companion: `VOICE.md` (the copy authority) · `CHARACTER.md` (who the house is) ·
> `../vision/phase-4-voice.md` (the lane design this implements).

## 0. What is actually running, so the comparisons have a baseline

| Stage | Implementation | Where | Measured |
|---|---|---|---|
| Wake | openWakeWord `hey_mycroft`, threshold **0.60 × 1 frame** | G11, `voice_agent.py` | genuine wakes peak 0.93–1.00; 11 h of TV never above 0.3 |
| Barge-in | same model, **0.70 × 2 frames**, through the house's own speakers | G11 | **1 fire in the agent's entire life** vs 43 ordinary wakes |
| Capture / endpointing | silero speech probability ≥ `SPEECH_ON` 0.5, then **800 ms** of trailing silence; 1500 ms lead give-up; 8 s cap | G11, `capture_utterance()` | spoken turn ends at ~4.0 s, silent wake at 1.5 s |
| STT | faster-whisper **`base.en`**, int8, beam 5 | G11 `voice-stt.service`, port 8123 | 6400 ms audio → **1185 ms** (RTF 0.19) |
| Lanes | local regex (~0.015 ms) → HA Assist → Claude `claude-haiku-4-5`, streamed by sentence | server | TTFA 0.96–1.73 s streamed |
| TTS | Kokoro `bm_george+bm_lewis`, PC primary + G11 fallback | PC / G11 | **~1.75 s is the TTFA floor** for a short uncached line |
| Memory | exchange → daily JSONL → distilled vault note → retrieved by `searchVault` | server | proven end to end 2026-08-16 |

Half duplex, barge-in, the `unheard` cue, the three failure cues, deixis, and depth-aware
answering all exist here and none of them appear in either reviewed repo.

## 1. The two repos, honestly

### FatihMakes/Mark-LI

One PyQt6 desktop app built around the **Gemini Live API**. Google's socket does wake-free
turn-taking, STT, TTS and emotion detection; `main.py` is the event loop and tool dispatch,
`ui.py` is a HUD, `actions/` holds ~20 capability modules, `memory/long_term.json` is a flat
persistent store, `core/prompt.txt` is the personality.

**Its architecture is its bet, and the bet is the one thing this house cannot make.**
Wake-free "proactive audio" and affective dialog both require streaming continuous room audio
to a third party. That is the guardrail, not a preference.

Genuinely worth taking:

- **The plugin drop-in directory.** A single `.py` in `plugins/` becomes a skill at next
  launch, with three-layer crash isolation — a broken plugin renders `BROKEN` and the core
  survives. This house's equivalent surface is `localIntents` + `localAnswers` + `voiceTools`
  + `subjects/`, which is better factored but needs four coordinated edits to add one
  capability. A registry would not be wasted work, but it is a refactor with no user-visible
  effect, so it is not ranked in §3.
- **Affective dialog.** Adapting tone to detected frustration or fatigue is a real idea and
  the *only* part of Gemini Live that survives a local-only rule — see §5.

What it does **not** have that this house does: any notion of the microphone hearing its own
speakers, any failure cue, any local fast lane, any grounding in live house state.

### jaredrhod/fullstack-agent

A Claude Code install wizard that assembles four repos: `ai-memory-vault` (markdown notes in
an Obsidian vault), `backtalk` (voice), `ai-visualizer` (full-screen faces), `barehands`
(webcam gestures). The install experience is genuinely novel — the wizard *is* an agent — but
that is packaging, not architecture.

**The voice half is this stack.** `backtalk` is faster-whisper for STT and Kokoro for TTS, and
its default voice is **`bm_lewis`** — half of this house's `bm_george+bm_lewis` blend. It
claims 1–2 s to first audio; the measured TTFA here is 0.96–1.73 s. It is push-to-talk by
default, where this house is wake-word with half duplex and barge-in.

**The memory half is also this stack.** Markdown notes, no vector database, read at need —
which is `vaultIndex.js` plus `conversationLog.js`'s distillation pass, and this house's
version additionally *decides what is worth keeping* rather than storing everything.

One idea worth taking:

- **The spoken permission gate.** Before doing something real it asks out loud and waits for a
  spoken yes, and it accepts a spoken refinement ("no, put that in drafts instead"). See §5.

### The summary judgement

Neither repo is more advanced than what is here. Both are **broader** — screen control,
messaging, gestures, code assistance — because both are personal-computer assistants and this
is a house. Breadth is not the axis this wall is judged on.

## 2. The field, by pipeline stage

### 2.1 Wake word — the lever that unlocks barge-in

The standing defect is not the wake word, it is that **the barge-in bar is higher than the
ordinary wake bar, in the acoustic condition that makes the score worse.** 0.70 across two
frames, through the house's own voice, versus 0.60 across one in a quiet room. The moment a
person most needs to be heard is the moment the house is talking over them.

The bar is high **because** openWakeWord's false-accept rate forced it there — TV dialogue
false-woke `hey_jarvis` nine times in three hours, scoring 0.87–0.97, the same band as genuine
wakes. No threshold could separate them, so the phrase was changed instead.

[`livekit-wakeword`](https://livekit.com/blog/livekit-wakeword) (2026) trains a custom wake
word in one command and claims **~100× fewer false positives** than openWakeWord. Critically,
it **exports the same ONNX format and inference pipeline** — a drop-in for
`resolve_model_path()` with no code change at all.

A far lower false-accept rate is what lets the bar come **down**. That is the actual fix for
barge-in, and it arrives as a file rather than a rewrite.

⚠ The 100× claim is a vendor number and must be verified against **this kitchen's TV**, using
the `PROBE_ONLY` mode that already exists in `voice_agent.py` for exactly this measurement.
Do not re-tune `BARGE_THRESHOLD` from the claim; tune it from the probe.

A second, cheaper option worth knowing about:
[openWakeWord custom verifier models](https://github.com/dscripka/openWakeWord/blob/main/docs/custom_verifier_models.md)
— a small second-stage classifier trained on *specific voices*, which cuts false accepts hard
at the cost of being less likely to respond to a new voice. For a four-person household that
trade may well be right, and it doubles as a poor-man's speaker ID.

### 2.2 Endpointing — the largest felt defect, and the cleanest fix

`capture_utterance()` ends a turn after 800 ms below a speech-probability threshold. That rule
is structurally incapable of distinguishing:

- *"what's on today —"* (a person thinking, about to continue), from
- *"what's on today."* (a person finished).

It clips the first and taxes the second 800 ms. The V2 comment block in `voice_agent.py`
already records that re-tuning a threshold here is a coin flip rather than a fix; this is why.

**Semantic turn detection** is a model trained on precisely this question. Two open
implementations:

- [`pipecat-ai/smart-turn`](https://github.com/pipecat-ai/smart-turn) (Apache-2.0). v2 was a
  360 MB wav2vec2 + linear classifier. **v3 exports to ONNX at 8 MB int8 with ~12 ms CPU
  inference** — and `onnxruntime` is *already* a hard dependency of the installed openWakeWord.
  Weights, training script and datasets are all open.
- [LiveKit's turn-detector](https://docs.livekit.io/agents/build/turns/) — open weights,
  listens to audio directly rather than waiting on a transcript, fuses semantic and acoustic
  cues. Stronger, but it arrives attached to the LiveKit Agents framework.

**Smart Turn v3 is the recommendation**: it adds a file, not a stack, and it plugs into a knob
(`CAPTURE_VAD`) that already exists to switch this exact behaviour and already has a
no-deploy systemd rollback.

It does **not** replace silero. Silero stays the cheap per-frame gate that says *someone is
talking*; Smart Turn answers the different and more expensive question *are they finished*,
and only needs to run on the trailing window.

### 2.3 STT — accuracy, and whether the model is even the problem

On record from a live turn: *"is it a good day for hanging the washing out"* was heard as
**"It's at a good day for hanging out the washy."** Haiku answered sensibly anyway, which is
exactly why a spoken test *feels* fine while the STT is degraded.

Also on record: 3.4 s of pure room tone reached whisper and it **hallucinated `"Okay."`** — a
latency bug that was one step from acting on a word nobody said.

The field has moved:

| Model | Shape | Claim |
|---|---|---|
| **Moonshine v2** ([paper](https://arxiv.org/html/2602.12241v1)) | Ergodic streaming encoder, ONNX, CPU-first, tiny (27 MB smallest) | Base beats Whisper `base.en` on WER; Small at **148 ms**, 13× faster than Whisper Small; runs on a Pi |
| **NVIDIA Parakeet TDT** | NeMo, Apache-2.0 | Among the fastest on Open ASR, strongest raw English accuracy |
| Whisper `large-v3-turbo` | the incumbent family | Only worth it if 100 languages matter — they do not here |

Parakeet's headline speed numbers are GPU numbers and it brings the NeMo stack; the G11 is
CPU-only (Vega 8, no CUDA) and the voice services are bounded at `MemoryMax=2G`. **Moonshine
is the right shape for this box.**

**But the engine is not yet proven to be the limit.** `stt_server.py` passes `language="en"`
and `beam_size` and *nothing else*. Three settings that cost nothing are absent:

1. **`hotwords` / `initial_prompt` biasing** toward the nouns actually being misheard. The
   domain vocabulary already exists in this repo — `voiceTools.entityRoster()`,
   `services/vocabulary.js`, the `show.*` subject list.
2. **`condition_on_previous_text=False`** — the classic whisper hallucination source.
3. **An explicit `no_speech_threshold`** — the direct guard against inventing `"Okay."` from
   room tone.

Root-cause discipline says measure before swapping. §3 ranks the measurement first.

### 2.4 Speaker identification — the biggest character unlock

`SPEAKER_UNKNOWN_LINE` sits permanently in the converse prompt. The house is therefore
*structurally* incapable of three things it is otherwise designed for:

- the **family-tease licence** `VOICE.md` §3 grants only to "known household members
  identified by name";
- resolving *"am I free next Tuesday"* against the right person's calendar;
- remembering per person, rather than per house.

The mechanism is settled and cheap: extract a speaker embedding, compare by cosine similarity
against per-person centroids built at enrolment, reject outside a confidence band.
[ECAPA-TDNN](https://ieeexplore.ieee.org/document/10544021/) is the standard architecture.

**Use a wespeaker ONNX export (~25 MB), not SpeechBrain** — SpeechBrain pulls torch, and these
services are memory-bounded. `onnxruntime` is already present.

**Where it goes is the elegant part: `stt_server.py` already holds the whole utterance WAV.**
Speaker ID is an embedding of the same bytes. One round trip, no new audio path, no new hop,
no new privacy surface beyond the one that already exists.

⚠ Two hard constraints, both learned here the expensive way:

- **It must fail toward unknown**, with a reject band, never a best guess. A house that
  confidently names the wrong person is the "invents particulars" failure that was caught live
  twice and rolled back within a minute each time.
- **Voiceprints are biometrics.** Enrolment centroids live in untracked `data/`. They never go
  near `config.js`, which is tracked and shipped in the public bundle.

### 2.5 The LLM lanes — one free lever, unpulled

Prompt caching was measured dead on 2026-08-15 and the reasoning was correct at the time: the
stable prefix is 5,102 characters ≈ **1,340 tokens**, and Haiku 4.5's minimum cacheable prefix
is **4,096**. Below the floor, `cache_control` caches nothing, reports nothing and errors on
nothing.

**Sonnet 5's floor is 1,024 tokens. Opus 5's is 512.** The existing prefix already clears both.

The stable → volatile ordering in `converseSystem()` was deliberately kept as the precondition
for exactly this. If the converse lane's model moves, a `cache_control` breakpoint on the last
stable block is the *whole* change.

⚠ Prove it with `usage.cache_read_input_tokens`, never by reasoning. Zero across two
identical-prefix turns means an invalidator survived.

### 2.6 Memory — already at the 2026 state of the art, and worth saying so

The [2026 literature](https://vectorize.io/articles/best-ai-agent-memory-systems) converges on
*episodic reflection and consolidation*: agents get smarter not by storing more but by
consolidating what they store, with reflection reading episodic memory and writing
context-independent semantic insight.

That is `conversationLog.js` → distilled vault note → `searchVault`, verified end to end on
2026-08-16, where three seeded exchanges produced **exactly one** note and the two transient
ones were discarded. The raw log was then deleted, keeping the retention promise.

Two genuine gaps against mem0/Letta, neither urgent:

- **Retrieval is keyword, not semantic.** A local embedding model over the vault would catch
  paraphrase. Cost: a model, an index, and a rebuild trigger.
- **The vault index only re-scans every 10 minutes**, so a fresh note is not recallable until
  then. That is a scheduling fix, not an architecture one.

**Do not adopt mem0 or Letta.** Both would replace a working, auditable, plain-markdown store
the household can read and edit in Obsidian, with a vector database, to gain retrieval quality
on a corpus of a few dozen notes.

### 2.7 TTS

Kokoro at ~1.75 s for a short uncached line is the TTFA floor, and the streaming-by-sentence
work already collapsed the rest of the wait. The largest remaining term is the **6 s primary
timeout** when the PC is asleep — roughly 70 % of that wait — which is a tuning question
already recorded in `project-voice-compute-on-g11`, not a model question. Nothing in the
current field changes this materially.

## 3. Ranked recommendations

| # | Change | Fixes | Cost | Rollback |
|---|---|---|---|---|
| 1 | **Smart Turn v3** as `CAPTURE_VAD=smart` | "it cuts me off / waits too long" | 8 MB file, no new stack | systemd drop-in, no deploy |
| 2 | **STT shadow measurement**, then decode hardening, then Moonshine *if warranted* | "it mishears me" | none, then none, then a model swap behind an unchanged HTTP contract | env var + restart |
| 3 | **Speaker ID** in `stt_server.py` | "it doesn't know who's talking" | 25 MB model, an enrolment flow, one optional response field threaded through 4 files | env var + restart |
| 4 | **Retrain `hey mycroft` on livekit-wakeword**, then lower the barge bar from the probe | barge-in never fires | a training run; drop-in ONNX | keep both model files, env var |
| 5 | **Spoken permission gate** on the tool lane | the house claims it turned on a light that ignored the call | copy + a state re-read | flag |
| 6 | **Prompt caching** when the converse model moves to Sonnet 5 / Opus 5 | cost, marginally latency | one `cache_control` marker | remove the marker |
| 7 | **Affective signal** into the prompt | tone-deafness | a small classifier | flag |

## 4. Explicitly rejected, and why

- **Speech-to-speech / realtime APIs** (Gemini Live as in Mark-LI, OpenAI Realtime). They are
  genuinely the lowest-latency architecture available and they would obsolete half this
  pipeline. They require streaming continuous room audio to a third party. **The guardrail is
  the answer and it is not a close call.**
- **Wake-free "proactive audio."** Same reason. It is also a worse fit for a kitchen than for
  a desk — the whole `soundPresence` design exists because this room is noisy.
- **Adopting Pipecat or LiveKit Agents as the framework.** Both are excellent and both are the
  right answer for a greenfield build. Here, `voice_agent.py` *is* the pipeline, and every
  constant in it — `SPEECH_ON` 0.5, `FRAME_STALL_S` 45, the detector-flush snapshot, the
  drain-before-reset ordering — was paid for with a live failure. A framework migration throws
  all of that away to gain plumbing that already works. **Take their models, not their
  runtimes.**
- **mem0 / Letta.** See §2.6.
- **The `ai-visualizer` / `barehands` halves of fullstack-agent.** A full-screen animated face
  is the opposite of this wall's design — the surface is a photograph and an hour, and depth 0
  is the resting state. Gesture control has no story here.
- **Swapping the STT engine before measuring.** Ranked as step two of #2, not step one, on
  purpose.

## 5. The two ideas taken from the reviewed repos

### The spoken permission gate (from `backtalk`)

There is an open item where the house says *"backyard light's on now"* when the device never
responded — four of five floodlights ignore `switch.turn_on` entirely. `runToolCall()` in
`server/routes/voice.js` reports `"done"` on a 200 from HA, which is not the same fact.

`backtalk`'s pattern is to ask out loud before acting and wait for a spoken yes. The narrower
and better fit here is to **verify after acting**: re-read the entity, and if it did not move,
say so. The house already has the machinery — `onToolError` exists precisely to get "understood
you, and genuinely cannot" out of band, and `reportCannot()` raises the third failure cue. A
device that silently ignored the call should reach that same cue.

### Affective dialog (from Mark-LI)

Gemini Live detects excitement, frustration and fatigue from the audio and adapts its tone.
The local version is a small classifier over the captured utterance producing **one word** of
mood, appended to the prompt after the stable block.

⚠ It must not become a new source of invented particulars. The rule that already governs this
character applies: state a **kind**, never a particular, and weld the exception into the rule's
own sentence rather than three paragraphs later.

## Sources

- [Smart Turn v3 — CPU inference in 12 ms](https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/) · [pipecat-ai/smart-turn](https://github.com/pipecat-ai/smart-turn)
- [Smart Turn v2 — 13 new languages](https://www.daily.co/blog/smart-turn-v2-faster-inference-and-13-new-languages-for-voice-ai/)
- [LiveKit turn detection](https://docs.livekit.io/agents/build/turns/) · [livekit/turn-detector](https://huggingface.co/livekit/turn-detector)
- [Moonshine v2 — Ergodic Streaming Encoder](https://arxiv.org/html/2602.12241v1) · [Local STT models 2026](https://www.onresonant.com/resources/local-stt-models-2026)
- [Open-source wake word training in a single command](https://livekit.com/blog/livekit-wakeword) · [openWakeWord custom verifiers](https://github.com/dscripka/openWakeWord/blob/main/docs/custom_verifier_models.md)
- [Multi-speaker diarization with ECAPA-TDNN](https://ieeexplore.ieee.org/document/10544021/)
- [Agent memory systems compared, 2026](https://vectorize.io/articles/best-ai-agent-memory-systems) · [Mem0 vs Letta](https://vectorize.io/articles/mem0-vs-letta)
- [FatihMakes/Mark-LI](https://github.com/FatihMakes/Mark-LI) · [jaredrhod/fullstack-agent](https://github.com/jaredrhod/fullstack-agent) · [jaredrhod/backtalk](https://github.com/jaredrhod/backtalk) · [jaredrhod/ai-memory-vault](https://github.com/jaredrhod/ai-memory-vault)
