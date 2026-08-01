# Home Operating System — Vision & Direction

_Direction locked 2026-07-11. Companion artifact (visual): the "Home OS — Vision & Direction" page._

## The reframe

Stop building a dashboard. Build a **presence**.

A wall display earns nothing by showing more. It earns its place by knowing what
deserves attention right now — and by disappearing when nothing does.

The breakthrough is not context awareness — it's **presence**. Context tells the
screen _what is true_. Presence tells it _who is there and what they need_. A screen
with navigation asks the passer-by to do the work of finding information. A screen with
presence does that work for them, in the two seconds they're looking.

**Recommendation: remove the page structure entirely.** No tabs, no click-cycle, no
navigation. The display has exactly one job at any moment, and presence decides what
that job is.

## The four presence modes (the spine)

| Mode | Trigger | Behaviour |
|---|---|---|
| **0 · Architecture** | Nobody near | The screen becomes part of the wall. Slow photography, weather-tinted light, a dim clock, the occasional earned memory. Almost no text. |
| **1 · Glance** | Motion, <2s | Answer one question — "what do I need to know right now?" The single most important thing. One hero, not a grid. |
| **2 · Lean-in** | Dwell 30s+ | Reveal depth: agenda, shopping list, tonight's meal, a camera preview. Richer, still curated — the next three things, never everything. |
| **3 · Conversation** | Voice | Become an assistant — full attention, direct answers — then gracefully recede back through the modes. Voice is the only real input surface. |

Why this beats pages: navigation assumes a user with time and intent. Our user has
neither — they're carrying a kettle. Presence removes the ask entirely.

## Research synthesis

**Adopt**
- **Calm Technology (Weiser & Brown).** Information lives in the periphery, moves to the centre only when needed. This _is_ the presence ladder.
- **Apple HIG — deference.** Content is the light, the photo, the one line. Chrome recedes.
- **NASA / information-radiator hierarchy.** Readable at a glance and at a distance. Encode state in _form_ (colour, size, position), not paragraphs.
- **Museum / large-format signage.** Legible from 3+ metres, one idea per frame, motion slow enough to ignore.
- **Scandinavian restraint.** Negative space is the feature; warmth from light, not decoration.

**Avoid**
- **Humane AI Pin's mistake** — removing the screen and asking voice to carry everything. We _have_ a screen; voice augments it.
- **Rabbit R1 novelty** — interaction models that demand learning. A passive display needs zero onboarding.
- **Material 3 density defaults** — tuned for a phone at 30cm, wrong for a wall. Borrow tokens, not card density.
- **"Gamified" ambient effects** — fireflies/particles that pull the eye are the opposite of calm.
- **Dashboard maximalism** — every "might be useful" widget is cognitive tax paid 100× a day.

## Repository audit — you've already built ~40%, unnamed

Not a greenfield rewrite: 299 commits, a clean Vite build, a split `server/routes` +
`src/js` tree. The presence/attention machinery exists in fragments. The work is
**promotion and consolidation**, not invention.

- **Already presence** — `motionTrigger.js` listens to the Eufy kitchen motion/person sensors via HA and wakes the display. That's the Mode 1 transition, live today.
- **Already ambient** — `screensaver.js` + night-clock (SunCalc) is Mode 0; `energySaver.js` handles deep-sleep monitor power.
- **Already attention** — `insightEngine` + `insightRules` + `focusHero` scores candidates, applies cooldowns, ranks _warning > insight > commute_, AI-phrases with a deterministic fallback. A mini attention engine.
- **Already single-ish** — `viewManager` has an `AMBIENT_VIEW` and auto-returns after 90s. The "recede to ambient" instinct is already coded — it just competes with a click-cycle that shouldn't exist.
- **Debt · CSS** — two parallel CSS trees: legacy `static/css/styles.css` (~3,980 lines) beside the newer split `src/css`.
- **Debt · modules** — `app.js` fires ~45 independent `init*` calls, each polling on its own timer. No shared context store — the seam where a presence runtime belongs.

## The attention engine

Generalise what `insightRules` already does. Any source emits **candidates**; each
carries a score and an expiry. The screen stays calm 95% of the time by letting almost
everything lose.

- **score** = importance × urgency × confidence. Low-confidence signals are damped, not shown as fact.
- **decay & expiry** — every candidate has a lifespan. "Rain in 14 min" dies at minute 15.
- **cooldown** — already in the codebase (`dashboard:insight-cooldowns`). Once shown, a candidate rests before returning.
- **one hero** — exactly one thing may dominate. Only a candidate above the _interrupt threshold_ (security, storm) overrides the current mode.

The presence mode sets the **floor**: Mode 0 shows only interrupt-level candidates;
Mode 1 the single top candidate; Mode 2 the top three; Mode 3 hands the floor to voice.
One engine, one ranked queue, four thresholds.

## Technical architecture (Pi 4) — a strangler migration

- **context store** — one observable state object fed by HA events, weather, calendar, presence. Modules subscribe; stop polling privately. Replaces ~45 timers with one heartbeat.
- **presence FSM** — a tiny state machine (Modes 0–3) driven by motion, dwell timers, voice. Home for logic scattered across `motionTrigger`, `screensaver`, `viewManager`.
- **render budget** — transforms & opacity only; never animate width/filter/box-shadow on the whole page (GPU idle-freeze finding). Freeze lottie + pause CSS under Mode 0. Verify with `/kiosk-metrics`, not reasoning.
- **memory discipline** — setTimeout fallbacks (transitionend never fires while hidden), revoke every objectURL, prune text-keyed caches, symmetric teardown per presence transition.

Migration principle: the presence layer ships first as an _orchestrator over today's
views_. Only once stable do we dissolve views into candidates. Every phase is
independently deployable and reversible via feature flag.

## Locked decisions

1. **Navigation → deleted.** Zero user-facing nav; `__switchView` survives as a CDP-only hook for Pi-side verification.
2. **Voice → Assist + Claude, layered.** HA Assist on-device for wake + device control; a Claude house-voice for open conversation (reusing the Haiku-primary / deterministic-fallback pattern). Guardrail: transcripts go upstream only on explicit wake — never passive audio.
3. **Docs → both.** This markdown set for version control + future-Claude context; the artifact for glancing and sharing.

## Roadmap — five deployable phases

1. **Name the engine** — presence FSM + context store orchestrating today's views; kill the click-cycle; behind a flag. No new surfaces. _(shipped — `phase-1-presence-runtime.md`)_
2. **One hero, one queue** — generalise `insightRules` into the attention engine; retire per-widget show/hide; add dwell → lean-in reveal. _(shipped — `phase-2-attention-engine.md`)_
3. **Anticipate** — predictive candidates (leave-by shipped, rain-incoming, bin night, package expected, garage-left-open); tasteful memory surfacing; dissolve first legacy views. _(shipped — `phase-3-anticipate.md`)_
4. **Give it a voice** — add the mic; wake behaviour, conversational Mode 3 over Assist + Claude; graceful recede. _(**infrastructure shipped flag-off 2026-07-17** — the full text loop (session FSM, MODE.VOICE, local → Assist → Claude lanes, linger/recede) is built and hardware-free-testable via `__voiceTranscript`; only the mic + wake word remain. See `phase-4-voice.md`)_
5. **Make it feel alive** — ambient atmospherics at the edge of perception; retire the last legacy view + the dual CSS tree; every effect GPU-budgeted and proven on the Pi. _(shipped & enabled — `phase-5-atmospherics.md`)_

_Order note (2026-07-11): Phase 4 is hardware-blocked, so Phase 5 is taken first. The two are independent — Phase 4 is Mode 3 (voice), Phase 5 is Mode 0 (ambient) — so reordering costs nothing._

## Roadmap, part two — "the Dissolve" (Phases 6–10)

_Drafted 2026-07-11 after the "As Lived" product design review. Phases 1–5 built an excellent **instrument** — one you'd miss for its information. Part two aims past that: a home you'd miss for itself. The review's finding was that the system still reasons in **items** when a home reasons in **states**; these five phases add the one missing reasoning layer, then let it reach every part of the screen. Order is deliberate — **substrate first, character last.**_

6. **Know why** — the House Intent Engine: a pure reasoning layer between context and attention (`Sensors → Context → House Model → Intent → Attention → Screen`) that infers activity / tempo / time-budget / company from signals already flowing. Invisible on the glass, the hinge everything else turns on. _(shipped & enabled — `phase-6-intent.md`)_
7. **Dissolve the dashboard** — lift the atmosphere off the screensaver onto a shared substrate so the intent-dressed room persists through every mode; retire the already-unreachable nav views. The 80%-core Ken Burns decode debt was paid down first (settle + hold dropped Mode-0 GPU 80%→0%). _(shipped & enabled — `phase-7-dissolve.md`; **the 80%→0% figures are tool artefacts — see the correction note at the top of that document**)_
8. **Learn without asking** — a quiet on-device observer that learns wake / departure / weekend rhythm / attention preferences from existing events, acts only above a confidence threshold, and never announces. _(shipped & enabled — `phase-8-learn.md`)_
9. **Remember on purpose** — replace regex-on-calendar memory with structured memory objects surfaced rarely and context-appropriately; generalise `momentsEngine` into an anticipation → afterglow timeline. Handles grief/nostalgia with a hard-gated "tender" class. Photo source: read-only Immich proxy (`photo-source-immich.md`). _(shipped & enabled — `phase-9-remember.md`)_
10. **One character** — the Personality Engine: a single temperament (restraint-first, not jokes) every surfacing path routes through, plus a rare, hard-budgeted delight registry. Last, because a temperament can only harmonise behaviours that already exist. _(shipped & enabled — `phase-10-temperament.md`)_

_The measure of success shifts here — from "shows the right thing" to what someone should **feel** after six months: that the house is on their side. See the "As Lived" review for the full critique behind these five._

## Status — the Dissolve is complete (2026-07-12)

All ten phases are shipped, enabled, and Pi-verified (Phase 4 / voice remains the one
hardware-blocked seam, reserved as `MODE.VOICE` for when a mic lands). The dashboard is
now the presence it set out to be: an ambient, weather-tinted room that surfaces one
curated thing on a glance, learns the household's rhythm without asking, remembers on
purpose, and speaks — when it speaks at all — in one restrained voice. Every phase stays
reversible from `src/js/config.js` (`features.*`). What remains is not building but
**living with it**: multi-week soaks confirming the learned aggregates stay bounded, the
delight budgets hold to their two-or-three-times-a-year cadence, and `/kiosk-metrics`
stays flat — after which each flag becomes the default.

## The one rule

Don't optimise for showing more information. Optimise for showing the right thing at the
right moment — and for showing nothing at all, beautifully, the rest of the time.
