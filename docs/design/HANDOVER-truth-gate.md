# HANDOVER — the truth gate: nothing the house says may outrun what it was told

Written 2026-11-16 on Opus 5.5 for a **build session on Fable**. Nothing here is built.
The owner chose this as the best use of Fable while it is included; the plan below is a
proposal, and the decisions in §7 are the owner's.

---

## Verdict: **YES-BUT**

One shared claim check on every line the house speaks is buildable from code that already
exists (`claimFault`). **But** the first job is the open pizza/soup report, because its
cause decides how much of the gate is input-side (what the prompt is given) versus
output-side (what the model says), and the replay corpus in Phase 2 is what proves either.

## The problem, as measured

The house's most repeated live defect is **saying a particular it was never given**. Every
instance was caught by the owner's eye or ear, never by the suite:

| When | What was said | Source of truth |
|---|---|---|
| (history) | a briefing named "8:41", a time nothing happened at | CLAUDE.md, Definition of Done |
| (history) | a flag flip made the house invent a bin time | CLAUDE.md, Feature Flags; `ai.js` EXEMPLARS header (~L103-160) |
| (history) | one prompt shape invented a forecast **24 out of 24** times | comment in `server/routes/ai.js` ~L247 |
| 2026-11-12 | evening briefing said **pizza** for dinner; dinner was **soup** | memory `project-briefing-wrong-dinner-2026-11-12.md` — **not investigated** |

Today's defence is mostly **prompt wording** ("never invent…", the topic lock). Wording
lowers the rate; it cannot make it zero, and nothing measures the rate.

## What already exists (reuse it, don't rebuild it)

| Thing | Where | What it does |
|---|---|---|
| `claimFault(sentence, source, { toolRan })` | `server/services/castLines.js` | Drops a sentence holding a digit or spelled number (3+), a weekday, an invented past ("last time", "yesterday"), an invented household habit, or a claimed action with no tool run, when the claim is absent from `source` |
| `keepClaims` / `keepReply` | same file | Apply `claimFault` per sentence (and per speaker tag) |
| Cast briefing path | `server/routes/ai.js` L508-520 | `keepReply(raw, prompt)` — **checked** |
| Ordinary briefing + concierge (Claude) | `ai.js` L522-530 | **unchecked** — the raw model text goes to the wall |
| Ollama fallback | `ai.js` L532-535 | **unchecked** |
| Voice converse, cast on | `server/routes/voice.js` L509-522 (stream), L553 (non-stream) | **checked** |
| Voice converse, cast off | same lines, `if (!cast)` branch | **unchecked** |
| The briefing's facts | `src/js/modules/aiBriefing.js` (`weatherText`, `eventsText`, `binsText`, `choresText`, …) → `buildPrompt` in `ai.js` L388 | builds the `Label: value` user prompt |
| Black box of what was said | `server/tts-cache/*.wav` + `voice-stt` on the G11 (`127.0.0.1:8123/transcribe`) | memory `reference-tts-cache-is-a-black-box-recorder.md`. Per that note (2026-09-19): ~14-day retention, key is `sha256(text::rate)`; re-verify before relying on it |
| What the wall showed | `data/presentations/` (S6a presentation log) | read its format at plan time |
| Specs to extend | `tests/cast-ai.spec.js`, `tests/cast.spec.js`, `tests/unresolved.spec.js`, `tests/ai-brief-callers.spec.js` | |

Not yet inventoried — **do this in Phase 0**: every other route that puts model text in
front of the household (`/api/voice/assist`, `server/routes/recipe.js`,
`server/services/voiceTools.js`, `server/services/conversationLog.js`, anything calling
`generateWithClaude`/`generateWithOllama`). Hand the sweep to the `scout` subagent.

## Phase 1 — root-cause pizza/soup (before any gate code)

**HYPOTHESIS (unprobed, strongest from reading the code):** the evening briefing never told
the model about tonight's soup.

- `eventsText` (`aiBriefing.js` ~L65) keeps tonight's events only if
  `ev.allDay || ev.start > now`, and the evening briefing targets **18:00** and
  pre-generates before it (`src/js/services/briefingSchedule.js` L36, L44).
- A meal is a calendar event titled `Meal: …` (`src/js/services/mealEvent.js`). If
  tonight's `Meal: Soup` is a **timed** event starting at or before generation time, it is
  filtered out of `Tonight:`, while `Meal: Pizza` tomorrow survives under `Tomorrow:`.
  The model then sees exactly one dinner, and it is the wrong night's.
- If so, `claimFault` would **not** have caught it: "pizza" *was* in the prompt. That is
  why this is Phase 1 — the gate as specified would have passed the defect.

Other hypotheses from the memory entry, still live: (a) the briefing meant tomorrow and
worded it ambiguously; (c) the model invented or misattributed the dish.

**Probe, in order:**
1. The menu calendar for 12 and 13 Nov: is `Meal: Soup` timed or all-day, and at what time?
2. The spoken text: TTS-cache WAVs around 17:30-18:30 on 12 Nov (`find -newermt`, size picks
   the long one), transcribed by `voice-stt`. It is past the cache's retention window if
   that is still 14 days on 26 Nov, so **do this first**.
3. Did it say "tonight" or "tomorrow"? That separates (a) from (b)/(c).

Write the confirmed cause into the memory entry. Fix the input side (e.g. tonight's meal is
always passed, whatever its start time) only after the cause is confirmed.

## Phase 2 — the replay corpus (measure before building)

Build an offline eval: real **inputs** paired with real **outputs**, replayed through the
checker. Without it, the gate's precision and recall are guesses.

- Inputs: the briefing prompt is not stored today. Either log it (prompt + output, server
  side, pruned like every dynamic-text cache here) or reconstruct historical cases by hand.
  Logging is the durable answer; a decision for §7.
- Outputs: the TTS cache transcripts, plus seeded cases from every row of the table above.
- Also generate fresh outputs: run the real briefing prompt over a spread of fact sets
  (meal timed / all-day / missing, bins due / not, no weather) with the production model,
  N samples each. **Every run spends API money: get the owner's yes and a budget first.**
- Score: invented claims caught, real claims wrongly dropped, whole briefings blanked.

Privacy: outputs name household members and real plans. The corpus lives under a
**gitignored** `data/` path, never in `tests/` fixtures. Specs use invented lines only, as
the cast does.

## Phase 3 — one gate, every speaking path

- Promote the check out of `castLines.js` into a neutral shared service; `castLines.js`
  keeps its exports (re-export) so nothing that imports it changes.
- Apply it on every unchecked path from the table above and from the Phase 0 inventory:
  ordinary briefing, concierge, Ollama fallback, non-cast converse.
- **Widen what counts as a claim only where the corpus shows the hole**: candidates are
  food/dish nouns, person names, "tonight"/"tomorrow" attached to an event from the other
  day, and clock words ("half past"). Each widening needs a corpus case that motivated it.
- **Fall-through, not silence:** a briefing whose sentences are all dropped must still say
  something true (the cast path already falls through to the ordinary briefing; the
  ordinary path needs its own floor, e.g. a templated line from the facts).
- Log every drop with its reason (the cast path already `console.warn`s), so the journal
  answers "what did it nearly say?".

Behind a new flag, default **off**; flag-off behaviour identical to today.

## Phase 4 — prove it, ship it

House rules, no shortcuts:
- Suite green in **both** flag states. `lms ps` first: a resident local model turns the
  suite red.
- `/inject-defect` **both directions**: (1) remove the gate on one path and see a spec go
  red on an invented claim; (2) make the gate drop everything and see a spec go red on a
  true briefing being blanked. One direction is half a test.
- Assert the text, not just a count. A spec that checks "a sentence was dropped" passes on
  a gate that drops the wrong one.
- Deploy flag-off, verify live, then `/flag-flip`, then flip back once to prove the rollback.
- Live check: read the next real evening briefing off the box (TTS cache + `voice-stt`) and
  compare it with the prompt that produced it.

## §7 — decisions for the owner (ask, don't assume)

1. **Store briefing prompts + outputs on the box?** Needed for a durable corpus and for
   every future "it said X" report. Text names the family; it stays in gitignored `data/`
   with pruning.
2. **API budget** for Phase 2 generated samples.
3. **Deterministic only, or add a model judge?** A second cheap-model call that asks
   "is every claim here in the facts?" catches what regexes cannot (a wrong dish that *is*
   in the prompt but for the wrong night), at the cost of latency and spend on every line.
   Recommendation: deterministic first, and add a judge only if the corpus shows misses
   that regexes can't reach.
4. **What a fully-dropped briefing says** (silence, a templated true line, or the cast
   fallback).

## Don'ts

- ⛔ Don't weaken `claimFault` to keep a joke (CLAUDE.md, The Cast).
- ⛔ Don't write a hypothesis from this file into a runbook, doc or memory as fact.
- ⛔ Don't put real briefing text in any tracked file: the repo is public.
- ⛔ Don't patch the prompt wording to fix pizza/soup until Phase 1 has confirmed the cause.
- Hand bulk work (route inventory, suite runs, log matching) to `scout` / `suite-triage`
  per CLAUDE.md, Model Routing. Keep the design and verdicts in the main session.
