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
| Moonshine v2 as a **shadow** STT engine | moonshine-ai/moonshine, arXiv 2602.12241 | `STT_SHADOW_ENGINE=moonshine` | planned |
| livekit-wakeword as a **shadow** wake model | livekit.com/blog/livekit-wakeword (2026-04-06) | `WAKE_SHADOW_MODEL_PATH` | planned — gated on the ONNX loading in `openwakeword.Model` |
| Camera caption timeline + arrival recap | LLM Vision v1.7 Timeline, Gemini for Home "Home Brief" | `cameraCaptions` flag; **local vision model on Mandragon only** | planned — Phase 0 measurement first |

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
  [pipecat smart-turn](https://github.com/pipecat-ai/smart-turn/releases)
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
