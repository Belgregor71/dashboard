# Field Scan — the running ledger

What the wider field of AI home assistants and family/ambient dashboards is doing, held
against what this wall already does. **One ledger, amended monthly.** A scan that does not
diff against this file will re-propose things that were declined for good reasons.

## How to use this file

- **ADOPTED** — built here. Names the flag/commit. Only a main session that verified it on
  the live G11 moves an item here — never a scheduled routine.
- **CANDIDATE** — worth building. Each carries **how to measure it first**, because the vendor
  number is never the verdict on this hardware (G11: Ryzen R2514 / Vega 8, no CUDA;
  Mandragon: RX 9070 XT, Vulkan, no CUDA).
- **DECLINED** — each carries a **reopen condition**. Do not re-propose a declined item unless
  its reopen condition is met, and say which.
- Anything read only from a snippet, a rumour or a page that failed to load is marked
  **UNVERIFIED**. A claim is not promoted out of UNVERIFIED by being repeated.
- House guardrails every candidate is filtered through: **no continuous room audio to a
  cloud**, **no camera images to a cloud**, **no touch** (glance + voice only), the repo is
  **public** (no addresses, entity allowlists or names in tracked files), and *does this make
  the next glance more useful, calmer, or more delightful?*

---

## Scan 2026-09-15 — first scan

Three sweeps: an inventory of this repo, a survey of AI home assistants, a survey of
dashboards. Round 1 chosen by the owner the same day: **camera "what did I miss"**,
**wake word + STT**, **calm exceptions + voice timers**. Plan:
`~/.claude/plans/research-the-latest-ai-lovely-hartmanis.md` (local to the dev box).

### IN PROGRESS (round 1)

| Item | Source idea | Where it lands | Status |
|---|---|---|---|
| Voice timers & reminders | every commercial assistant; absent here (grep: no `timer`/`reminder` intents) | `voiceTimers` flag, local-intent lane | planned |
| Moonshine v2 as a **shadow** STT engine | moonshine-ai/moonshine, arXiv 2602.12241 | `STT_SHADOW_ENGINE=moonshine` | **built + measured on the G11**; awaiting the owner's service restart (see below) |
| livekit-wakeword as a **shadow** wake model | livekit.com/blog/livekit-wakeword (2026-04-06) | `WAKE_SHADOW_MODEL_PATH` | planned — gated on the ONNX loading in `openwakeword.Model` |
| Camera caption timeline + arrival recap | LLM Vision v1.7 Timeline, Gemini for Home "Home Brief" | `CAMERA_CAPTIONS` env, `server/services/cameraCaptions.js`; **local vision model on the G11, on demand** (owner, 2026-10-22) | **Phase 0 PASSED 2026-10-22; Phase 1 SHADOW built (`2a0a4e1`)** — see #3 below |

### Measured on the box, 2026-09-15 — moonshine, and what the OLD shadow had been saying

**🔑 The 24 days of shadow logs nobody had read.** `STT_SHADOW_MODEL=small.en` has been
running since 2026-08-22 and the journal holds **47 comparisons: 33 same, 14 DIFF (30%)**.
The disagreements are not cosmetic — the LIVE model (`base.en`) produced:

- `"Shown me the rest of people tonight"` where the shadow had *"show me the recipe for tonight"*
- `"no at least one"`, `"nope this one"`, `"not this"` for what is plainly *"not this one"* — the
  photograph veto, three separate nights
- `"showing what's flying"` for *"show me what's flying"*

Two of those are utterances the local lane is supposed to claim, so a mishearing there is a
turn that falls through to a slower lane or does nothing. `base.en` won some too
(*"what's for dinner tomorrow"*, *"show me what's playing"*), so this is **not yet a verdict
on which model to run live** — it is the first evidence that the transcriber, not the
grammar, is a real limit. A third opinion is the cheapest next fact.

**Moonshine, measured here** (two bundled human recordings, **speed only**; accuracy comes
from the journal, never from a bench — the house rule about synthetic audio still stands):

| engine | RTF | cores | RSS |
|---|---|---|---|
| moonshine base | 0.11–0.16 | 1 | ~550 MB |
| moonshine small-streaming | 0.22–0.36 | 1 | ~630 MB |
| whisper small.en (today's shadow) | 0.41–0.73 | 2 | ~865 MB |
| whisper base.en (today's live) | 0.09–0.15 | 4 | ~365 MB |

🔑🔑 **`MOONSHINE_ORT_SINGLE_THREAD=1` IS NOT A TUNING KNOB, IT IS A GUARDRAIL.** Left alone,
ONNX Runtime took **~6.5 of this box's 8 cores** — and it **escaped `taskset -c 6,7`**,
because it pins its own pool. Forced single-threaded it ran on exactly 1.0 core and was **no
slower** (it had been spinning). On the box that also renders the wall, that is the whole
difference between a safe shadow and a stutter. `stt_server.py` sets it before the library
loads; `STT_SHADOW_THREADS` does not apply to this engine.

⚠ `moonshine-voice` is installed in the G11's STT venv (adds only — numpy 2.5.2 and
onnxruntime 1.28.0 untouched), and the new `stt_server.py` is staged there. **The shadow is
NOT running yet**: the engine is chosen in a root-owned systemd drop-in, and `sudo` here is
passwordless for four commands that do not include it. The owner's two lines are in the
session handover.

### CANDIDATE

| Item | Link | Why it could matter here | Measure first |
|---|---|---|---|
| **LLM Vision v1.7.x** (HA integration) + Glimpse-v1 | https://github.com/valentinfrlch/ha-llmvision/releases (v1.7.2, 2026-09-03) | `get_events` timeline API; snapshot-based so it tolerates Eufy's flaky RTSP | Glimpse-v1 distribution and AMD speed are **UNVERIFIED**. Compare against the in-repo caption lane before adding an HA dependency |
| **Frigate 0.18** | https://github.com/blakeblackshear/frigate/discussions/24252 (2026-09-12) | GenAI review summaries, threat labels, ROCm 7.2 for RDNA4 | Needs stable RTSP from six Eufy cams — measure stream uptime before anything else |
| **House exceptions — blank means fine** | Timeframe https://hawksley.org/2026/02/17/timeframe.html | Only abnormal states surface (door open after dark), and quietly resolve | **PARKED by owner 2026-09-15.** A live read of `/api/ha/states` found NO door/window/garage/lock/washer sensors — the idea has nothing to read. What exists (NAS drive health, Eufy security mode, vacuum problems) was judged not worth a new lane. **Reopen when** door/garage contact sensors or an appliance power plug are added. Design sketch kept in the round-1 plan: rules in `.env` only, `last_changed` for the held duration (⚠ a re-stamp shortens it — safe direction), a pill in the fault pill's register |
| **Distance-adaptive density** (mmWave) | Kinboard LD2410 support https://github.com/svenger87/kinboard ; Echo Show "adapts with distance" | Photo + sky from across the room, larger text within ~2 m — more useful glances with no touch | Owner **would buy** an LD2410 (2026-09-15). Round 2. Measure false presence from a ceiling fan / TV first |
| **HA 2026.9 Active alerts** | https://www.home-assistant.io/blog/2026/09/02/release-20269/ | A user-curated "needs attention" set — a possible rule source for house exceptions | Not probed on this HA instance; check the HA version first |
| **HA 2026.8 llama.cpp / OpenAI-compatible agents** | https://www.home-assistant.io/blog/2026/08/05/release-20268/ | A sanctioned local fallback via Mandragon instead of `llama3.2:1b` | llama.cpp #26663: Vulkan on 9070 XT 5–7× slower decode for hidden size ≥ 4096. Mandragon sleeps overnight |
| **Pocket TTS** (Kyutai, 100M) | https://github.com/kyutai-labs/pocket-tts | Streaming, ~200 ms first audio, voice cloning | Published ~2.3–2.5× real time on cloud x86 — **measure RTF on the G11**; the house's TTS law is RTF < 1. ⚠ "Everywhere or nowhere" — no half-adopted voice |
| **Supertonic 3** (99M, emotion tags) | https://github.com/supertone-inc/supertonic | `<laugh>`/`<sigh>` tags, Node SDK | ⚠ repo shown **archived 2026-09-09**; weights OpenRAIL-M. Check maintenance before spending a minute |
| **Skylight/Hearth-style capture** | https://techcrunch.com/2026/01/07/skylight-debuts-calendar-2-to-keep-your-family-organized | Forward an email / photo a flyer → events, confirmed aloud | Calendars here are read-only ICS — needs a write target first |
| **Aura-style memory lane** | https://auraframes.com/news | Weight the archive toward birthdays/anniversaries this week | Needs an occasion source the archive can read |
| **Parcel-day card** | https://www.home-assistant.io/integrations/seventeentrack/ | Shows only on delivery day; tags the doorbell popup "likely the parcel" | No dedicated Australia Post integration found |
| **Next-hour rain line** | Timeframe | "Rain in ~20 min" matched to the rain-burst layer | Check whether the forecast week already carries this |
| **Motion-burst grouping + one AI line** | Ring Video Descriptions https://ring.com/support/articles/97l0i | One caption per burst, not a popup per trigger | Folded into the camera caption lane |
| **Per-speaker behaviour** | Alexa+ Voice ID; Apple home hub (**UNVERIFIED** rumour) | Once speaker ID lands: per-person agenda, reminders to the right person | Blocked on `docs/design/HANDOVER-SPEAKER-ID.md` |
| **Family ETA while en route** | Waze Travel Time https://www.home-assistant.io/integrations/waze_travel_time/ | Shown only while someone is on the way; gone on arrival | ⚠ Corrected same day: the first sweep said no person entities exist — **wrong**; `server/services/occupancyDays.js` records two `person.*` entities measured on the G11, and `arrival.js` watches them; a live read of `/api/ha/states` on 2026-09-15 also shows 4 `device_tracker.*`. Measure first whether they carry GPS coordinates (companion app) or only home/not_home (router/zone) — ETA needs the former. Owner did not tick "HA app on phones" |
| **Generated art for occasions only** | HA AI Task `generate_image`; Fraimic (CES 2026) | Rare = delightful; daily = noise | No local image model measured |

### DECLINED

| Item | Why | Reopen condition |
|---|---|---|
| **QLD school-term awareness** | No children in the house (owner, 2026-09-15) | A school-age child in the house |
| **Solar / Amber price nudge** | Owner did not tick "rooftop solar / Amber" when asked (2026-09-15) — confirm before treating as settled | Solar installed or an Amber account |
| **Chore charts, streaks, rewards** (Skylight, Hearth) | Built for children and touch; a chore roster already exists | Children in the house |
| **Speech-to-speech / realtime APIs** (Gemini Live, OpenAI Realtime) | Streams continuous room audio to a third party | Never on the guardrail as written |
| **Wake-free proactive audio** | Same guardrail; the kitchen is noisy | Never on the guardrail as written |
| **Pipecat / LiveKit Agents as the framework** | `voice_agent.py` constants were paid for with live failures. Take their models, not their runtimes | The pipeline is rewritten for another reason |
| **mem0 / Letta** | Vector retrieval over a few dozen notes; the Obsidian vault is editable by the household | Vault grows beyond what `searchVault` handles |
| **FatihMakes/Mark-LI**, **jaredrhod/fullstack-agent** | Reviewed 2026-08-22 — both behind this stack | A new release adds something not already here |
| **k2-fsa OmniVoice** | CUDA-only fast path; RTF 1.45+ on AMD iGPU, ~4.9 on CPU | `omnivoice.cpp` Vulkan RTF < 0.5 on Mandragon |
| **scorbo2/TalkWithMe** | Its headline feature (sentence-streamed TTS) already ships | — |
| **Qwen3.8-27B as a local agent** | Called tools and still produced no answer; weights deleted | A different model — not a re-run |
| **Third-party HA MCP npm packages** | Do not exist (npm 404) and would need the HA token | Use HA's own `/api/mcp` if enabled |
| **Soniox STT (HA 2026.9 Labs)** | Cloud STT | Never on the guardrail as written |
| **Touch-first HA dashboards** (Mushroom, Bubble Card, Sections) | No touchscreen | A touch panel is added |
| **Full-screen animated assistant face** | The surface is a photograph and an hour | — |
| **Camera snapshots to a cloud vision model** | Owner chose local-only (2026-09-15) | Owner reverses it |

### Notes that are not items

- **HA 2026.9 renamed LLM tool ids** (`HassTurnOn` → `intent__HassTurnOn`). Grepped
  2026-09-15: this repo names none of them — nothing to change.
- **HA 2026.9 persistent notifications** fire `updated` rather than `added` on update — no
  listener here depends on it (grep: no `persistent_notification`).
- **Amber Case, "The ambient revolution"** (IDEO Edges, 2025-10-21) — success measured as
  *less mental effort, not more interaction*; degrade by hiding a lane, not by showing an error.

## Scan 2026-10-16 — round 2

A web sweep, filtered against every DECLINED row above. Nothing here reopens a declined item
whose reopen condition has not been met. Ranked by "next glance more useful / calmer / more
delightful", divided by cost. **All CANDIDATE: nothing is chosen yet, and every item is
measured before it is built.** Round 1's items that are still unbuilt are re-ranked here
rather than duplicated.

### CANDIDATE (round 2, ranked)

| # | Item | Link | Why it could matter here | Measure first |
|---|---|---|---|---|
| 1 | **The house knows who is speaking** (Build 3) | WeSpeaker https://arxiv.org/abs/2210.17016 · ESPnet-SPK https://arxiv.org/abs/2401.17230 | Per-person answers, reminders to the right person, a named greeting. `docs/design/HANDOVER-SPEAKER-ID.md` is "fully unblocked" | The owner's decisions in handover §6. Introspect the ONNX export. Must fail toward UNKNOWN; voiceprints never in `config.js` |
| 2 | **Distance-adaptive wall + room presence** (mmWave) | LD2410 / LD2450, native in ESPHome since 2025.3 https://esp32.co.uk/ld2450-zones-home-assistant-coordinates-exclusion-zones/ | Webcam presence is retired and presence is MIC-ONLY. Radar gives a photo + sky from across the room, larger text within ~2 m, and better presence for screensaver/briefing/arrival. Supersedes the round-1 "Distance-adaptive density" row | One LD2410, 48 h false-presence log against the ceiling fan and the TV before any flag |
| 3 | **"What did I miss" camera timeline + arrival recap** | Gemma 4 E2B/E4B (Apache-2.0, 2026-04) https://simonwillison.net/2026/apr/2/gemma-4 · qwen3-vl:4b per https://docs.frigate.video/configuration/genai/genai_config | Round-1 item, still unbuilt (grep 2026-10-16: no caption code in `server/` beyond Immich). One line per burst; "while you were out…" | **Phase 0 DONE 2026-10-22.** Gemma 4 E4B Q4_0 over 187 real event images, which the owner marked by hand: **1 invented person** (of 37 claims), 4 missed (of 40). Vehicles: 5 invented, 10 missed (the misses all said "Nothing.", probably parked cars, unchecked). The G11 gave the same verdict as the GPU box on a 30-frame sample, 30/30, at a median 34 s (4–109 s); cold load ~6 s; ~2.9 GB private + 4.4 GB reclaimable with `-c 2048` (the default context costs 2 GB more). **Phase 1 = SHADOW** (owner): G11 on demand, rows on disk 7 days untracked, nothing on the wall, read via `/api/camera-captions` (loopback). Phase 2 (the "while you were out" card) waits on a few days of real rows |
| 4 | **One small local model for vision AND the offline `/converse` fallback** — ⛔ MEASURED NO on the G11 2026-10-17, see below | llama.cpp `llama-server` (OpenAI-compatible; HA 2026.8 integration) + the same Gemma 4 E4B | Replaces `llama3.2:1b` and shares weights with #3: one resident model, not two | tok/s + RSS on the G11 with the wall running. ⚠ A resident model has turned GPU specs red. Check kiosk GPU headroom before and after |
| 5 | **First audio in ~200 ms** | Kyutai Pocket TTS https://github.com/kyutai-labs/pocket-tts (the round-1 row) | Time-to-first-word is the most felt latency in a voice turn | RTF on the G11 with real house lines, then a blind A/B with the owner. "Everywhere or nowhere" |
| 6 | **A real wake phrase + a barge-in that stops the reply** — ✅ CLOSED 2026-10-18: barge-in LIVE at 0.60×1 (spoken test passed 10-16, `76244a1`), and a stop with nothing after it no longer shows the "didn't catch that" cue. Owner kept "Hey Mycroft", so the wake-phrase training is dropped | livekit-wakeword shadow (round 1, never armed); custom openWakeWord via https://home-assistant.io/voice_control/create_wake_word | Two things are owed: the wake phrase, and barge-in 0.70×2 vs wake 0.60×1 | Arm the shadow and read a week of journal agreement, the way moonshine was proven |
| 7 | **Family ETA while en route** | Waze Travel Time https://www.home-assistant.io/integrations/waze_travel_time/ (the round-1 row) | Shown only while someone is on the way; gone on arrival | Do the `device_tracker.*` entities carry GPS? That needs the companion app on the phones, which is the owner's call |
| 8 | **Calendar you can add to by voice** | HA Local Calendar / CalDAV as a write target (the Skylight capture row) | Today's calendars are read-only ICS. "Add the dentist Tuesday at 3", confirmed aloud | The owner picks the write target. Then `calendar.create_event` via the HA proxy behind `SAFE_SERVICES` |
| 9 | **Occasion-aware archive** — ▶ BUILT 2026-10-24 behind `IMMICH_OCCASIONS` (server-only, unset = identical) | Immich search v2 (merged 2026-08, web modal in v3.2) https://immich.app/blog/2026-august-recap | Combined people + date filters weight the archive toward this week's birthdays/anniversaries (the Aura row), with no new hardware | **Measured 2026-10-24.** NAS runs Immich **3.1.0**, so there is no migration to do. `personIds` search works and the key has `person.read`. 10 of 186 named people carry a `birthDate`, and both DOG_BIRTHDAYS people match. ⚠ Only **13** photographs in the library were taken ON anyone's birthday, and **3** survive the filters. So on a birthday the pool leads with the person's 12 photos (true birthday ones captioned "X's birthday 2019", the rest captioned as usual, with crowd shots of more than 4 faces last), and the remaining pool is thinned to as many again, floor 6. Dry run on the G11 for all 10 dates: every one leans, 0.3–1 s, nothing leaks. Anniversaries: no source exists (the vault only dates trips) |
| 10 | **"Blank means fine" house exceptions** | ~A$40 of Zigbee door/garage contacts + a power-metering plug on the washer | Hardware is the PARKED row's own reopen condition. "Washing's done", "garage open after dark" | Hardware first; the design sketch is in the round-1 plan |

**Suggested order:** #6 and #1 first (no cost, already owed). Order the hardware for #2 and #10
now so it soaks while code is built. #3 and #4 are one Phase 0 measurement. Then #5, #7, #8
and #9 as the owner picks.

### Measured 2026-10-17 — #4 on the G11: NO, it is too slow for a voice turn

Phase 0 for row #4. Gemma 4 E4B-it `Q4_0` (ggml-org, 4.59 GB) on llama.cpp `b11706`, run from
`~/llm-probe` on the G11 with the wall live. No service was installed. The prompt was the
**real** converse system prompt, built on the box by `converseSystem()` with its `.env`:
9,861 chars, **2,291 tokens**, 3 tools armed. `digest` was null, so a live turn is larger.

| Backend | Prompt read | 2,291-token prompt | Generate | 60 tokens | RSS | Wall during inference |
|---|---|---|---|---|---|---|
| CPU, 4 threads | 6.7 tok/s | **341 s** | 2.8 tok/s | 21 s | 7.0 GB | 30 fps · gpu 13.9 / renderer 14.0 |
| Vulkan, Vega 8, `-ngl 99` | 23.2 tok/s | **99 s** | 1.9 tok/s | 31 s | 0.3 GB (+VRAM carve-out) | 30 fps · **gpu 36.9** / renderer 27.5 |
| *(wall idle, no model)* | | | | | | *30 fps · gpu 11.5 / renderer 11.1* |

- `/converse` gives the fallback **30 s** (`AbortSignal.timeout(30_000)`). The best case
  here is about 130 s. With the stable prefix cached (llama-server did reuse the prompt
  cache: a repeat re-read only 6–8 tokens), the volatile ~950 tokens still take ~40 s on
  Vulkan before a word is generated.
- Vulkan triples gpu-process (11.5 → 36.9 % of one core), past the §5.4 ceiling of 25
  sustained, although the substrate held 30 fps. CPU leaves the wall alone but is 3.4×
  slower to read the prompt.
- Gemma 4 thinks by default. Every 60-token reply was spent inside "Thinking Process:",
  and `--reasoning-budget 0` did NOT stop it on this build. A real lane would need the
  chat-template switch, which was not tested.
- **Vision (#3) was not measured.** An image costs prompt tokens at the same 23 tok/s, so a
  non-interactive caption may still be viable. That is #3's own Phase 0.

**Baseline found on the way: the CURRENT offline fallback is dead.** Ollama on
192.168.0.179 lists `llama3.2:1b`, but a 20-token generate returned HTTP 500 after 175 s:
"model runner has unexpectedly stopped … resource limitations". It was exercised for real
on 2026-10-15 18:00, when the Anthropic credit ran out ("credit balance is too low"). The
briefing fell back to Ollama and timed out at 30 s. **Today the house has no working
offline voice or briefing.**

Reopen #4 when: a smaller model (Gemma 4 E2B, untested) reads a trimmed fallback prompt
in under ~10 s, or the lane moves to hardware that is awake (Mandragon sleeps overnight).

### Watch, not do (round 2)

- **Frigate 0.16+**: face recognition and plate labels without Frigate+ (https://heise.de/-10539498), plus GenAI review summaries. Still gated on Eufy RTSP uptime, and 2 of the cams are dead (2026-10-10).
- **HA 2026.10** (2026-10-07, https://www.home-assistant.io/changelogs/core-2026.10/): one-click AI connection, a vector-tile map, Matter improvements. Nothing to change here yet. Cloud is being renamed "Home Assistant Link" in December.

---

## Watched sources (the monthly routine reads these)

- Home Assistant release notes — https://www.home-assistant.io/blog/categories/release-notes/ (first Wednesday monthly)
- GitHub releases:
  [ha-llmvision](https://github.com/valentinfrlch/ha-llmvision/releases) ·
  [frigate](https://github.com/blakeblackshear/frigate/releases) ·
  [livekit-wakeword](https://github.com/livekit/livekit-wakeword/releases) ·
  [moonshine](https://github.com/moonshine-ai/moonshine/releases) ·
  [openWakeWord](https://github.com/dscripka/openWakeWord/releases) ·
  [faster-whisper](https://github.com/SYSTRAN/faster-whisper/releases) ·
  [kokoro](https://github.com/hexgrad/kokoro/releases) ·
  [pocket-tts](https://github.com/kyutai-labs/pocket-tts/releases) ·
  [ImmichFrame](https://github.com/immichFrame/ImmichFrame/releases) ·
  [immich](https://github.com/immich-app/immich/releases) ·
  [MagicMirror](https://github.com/MagicMirrorOrg/MagicMirror/releases) ·
  [TRMNL plugins](https://github.com/usetrmnl/plugins) ·
  [pipecat smart-turn](https://github.com/pipecat-ai/smart-turn/releases) ·
  [wespeaker](https://github.com/wenet-e2e/wespeaker/releases) ·
  [llama.cpp](https://github.com/ggml-org/llama.cpp/releases)
- Immich blog (monthly recaps, search v2) — https://immich.app/blog
- Timeframe — https://hawksley.org/
- Skylight — https://releasebot.io/updates/skylight · Hearth — https://hearthdisplay.com/pages/features
- Alexa+ — https://www.aboutamazon.com/news/devices/new-alexa-top-features
- Gemini for Home — https://support.google.com/googlehome/answer/15542305
- Hacker News search: "home dashboard", "wall display", "e-paper dashboard", "voice assistant local"

## Monthly scan — procedure

1. Read this whole file first.
2. For each watched source, list only what is **new since the previous scan's date**.
3. Drop anything already ADOPTED, IN PROGRESS, or DECLINED without a met reopen condition.
4. For each survivor: link, date, one line of what it is, one line of why it matters to *this*
   wall, and how to measure it on this hardware. Mark UNVERIFIED honestly.
5. Append a new `## Scan YYYY-MM-DD` section above the previous one. Never edit an earlier
   scan's rows except to move an item between tables with a dated note.
6. Commit to a `field-scan/YYYY-MM` branch and open a PR. **Never push to `main`** — `main`
   deploys to the live kiosk.
