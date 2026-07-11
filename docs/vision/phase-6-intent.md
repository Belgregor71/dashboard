# Phase 6 — "Know Why": The House Intent Engine

_Plan drafted 2026-07-11. Part of the [Home OS vision](./home-os-vision.md) roadmap. Builds on [Phase 1](./phase-1-presence-runtime.md) (presence FSM + context store), [Phase 2](./phase-2-attention-engine.md) (attention engine), and [Phase 3](./phase-3-anticipate.md) (predictive candidates) — all shipped & enabled._

**📝 Proposed — not yet built.** First phase of "the Dissolve" (Phases 6–10), the arc that turns the finished instrument into a home. Companion review: the "As Lived" product design review.

## Key insight that de-risks this phase

**Presence already knows _where_; the missing layer is _why_ — and everything it needs is already flowing.** `presence.js` emits Modes 0–3 off real motion/idle signals; `contextStore.js` already holds `{ presence, lastMotionAt, isNight, condition }` and is explicitly designed to "grow per phase"; `arrivalGreeting.js` already reads `person.*` entities to know who is home; `momentsEngine.js` and the calendar already surface today's events. The House Model does not add a sensor — it adds a **pure reducer** over slices the store already carries, exactly the `atmosphere.js` / `predictiveRules.js` shape (no DOM, no IO, node-unit-tested).

And the consumer seam is already open: `attentionRank.selectForMode` already takes the presence mode as a **floor**. Intent adds a second dimension to the same function — it does not touch the queue, the renderer, or the FSM.

The through-line: _Phase 1 named who is there; Phase 6 names what they're doing — one pure reducer between context and attention, invisible on the glass but the hinge every later phase turns on._

## Why this phase (the reward)

The review's core finding was that the system reasons in **items** when a home reasons in **states**. A person sprinting past for their keys and a person leaning in with a coffee register today as the same `GLANCE`. The House Model lets the screen tell them apart — so a rushed room gets left alone even when someone's technically "present," and an unhurried Sunday can be offered more. Nothing new appears on the wall in Phase 6. What changes is that the house starts having a **posture**, and Phases 7–10 all dress to it. Ship the hinge first, prove it reasons right, then let the visible phases consume it.

## Goal & success criteria

Insert a reasoning layer — `Sensors → Context → House Model → Intent → Attention → Screen` — that fuses existing signals into a single **intent state** on the context store, and let the attention gate read it. All behind `features.houseIntent` (default off → reversible, the Phase 1/2/3 pattern).

Done when:
1. Flag **on**: `contextStore` carries an `intent` slice `{ activity, tempo, timeBudget, company }` derived from real signals; `body.dataset.intent` tracks it; `intent:changed` fires on the bus. Flag **off**: byte-identical to Phase 3–5 behaviour.
2. The attention gate reads intent: a **rushed** room raises the floor (interrupt-only) even in `GLANCE`; an **unhurried** room permits the DWELL depth sooner. Presence remains the base floor; intent modulates it.
3. The House Model is **pure and node-unit-tested** — deterministic `{slices} → intent` with no DOM/IO, the `predictiveRules.js` discipline.
4. Intent does **not flap**: transitions settle (hysteresis), verified — no `rushed ↔ relaxed` oscillation on noisy motion.

## What the House Model reasons about (grounded in real signals)

| Dimension | Derived from (already flowing) | Notes |
|---|---|---|
| **activity** — cooking / leaving / arriving / entertaining / passing / winding-down | time of day + calendar + motion cadence (`lastMotionAt` deltas) + `person.*` arrivals (`arrivalGreeting` source) + light/appliance states **where such HA entities exist** | Appliance/oven entities are **not assumed** — the model degrades to time+calendar+motion if they're absent (the Phase 3 "don't build for a phantom entity" discipline). |
| **tempo** — rushed vs unhurried | cadence of presence transitions + proximity of a calendar event | Short, criss-crossing motion near a hard event = rushed; long steady dwell = unhurried. |
| **timeBudget** — minutes until the next thing that matters | next located calendar event (+ the shipped leave-by drive time) | Reuses the leave-by routing already in the queue. |
| **company** — alone / together / hosting | count of `person.*` entities home (`arrivalGreeting` already reads these) | Hosting = recede, not narrate. |

Output is a **posture**, not a candidate. The model emits one small object; the runtime writes it to the store and the gate reads it. No new card, no new render path.

## File-by-file changes

**New — `src/js/services/houseModel.js`**
- Pure `deriveIntent({ presence, lastMotionAt, isNight, condition, events, peopleHome, now }) → { activity, tempo, timeBudget, company }`. No DOM/IO; same contract as `atmosphere.js`. Exports the enum of activities so a test can assert the mapping surface.

**New — `src/js/core/intentEngine.js`**
- Runtime that gathers the live inputs (context store + calendar + `person.*` state), calls `deriveIntent`, applies a **settle/hysteresis** guard (a transition must persist N seconds before it commits — the atmospherics "settle, don't flap" instinct applied to state), writes the `intent` slice, sets `body.dataset.intent`, and emits `intent:changed { intent, prev, reason }`. Registers its listeners **once** at init (leak discipline).

**Edit — `src/js/core/contextStore.js`**
- Grow the slice with `intent` (default a neutral `{ activity: "unknown", tempo: "neutral", timeBudget: null, company: "unknown" }`), same per-phase growth the file already documents.

**Edit — `src/js/services/attentionRank.js`**
- `selectForMode(queue, mode, intent?)` gains an optional intent argument: raise the floor when `tempo === "rushed"`, permit DWELL depth sooner when `unhurried`. Presence stays the base floor; intent only modulates. Pure — still node-testable.

**Edit — `src/js/services/attentionEngine.js`**
- Pass the current `intent` slice into `selectForMode`. Guarded by the flag so flag-off calls the two-arg form unchanged (byte-identical).

**Edit — `src/js/core/app.js`**
- `initIntent({ enabled: isEnabled("houseIntent", false) })` after `initPresence()`.

**Config — `src/js/config.js`**
- Add `features.houseIntent: false`. Default off; flip on the Pi after live verification; then default on.

**Debug** — `window.__intent()` (read the current intent + inputs) and `window.__forceIntent(patch)` to drive a state over CDP, matching `__presence` / `__atmosphere`.

## Step sequence (each independently verifiable)

1. `houseModel.js` pure reducer → verify: unit tests — each activity/tempo/company derives correctly from synthetic slices; degrades cleanly when appliance signals are absent.
2. Grow the `contextStore` `intent` slice (unwired, flag off) → verify: `npm run build` clean, zero behaviour change.
3. `intentEngine.js` wired behind the flag, sets dataset + emits event, with the settle guard → verify: `__forceIntent` drives `dataset.intent`; noisy input does **not** flap (settle holds).
4. `selectForMode` reads intent → verify: unit test — a `rushed` intent raises the floor in GLANCE; `unhurried` permits DWELL depth; flag-off path (no intent arg) unchanged.
5. `tests/intent.spec.js` (pure model + a UI smoke) → verify: `npm test` green (pre-push gate).
6. Deploy flag OFF (no-op) → flip ON on Pi → CDP-verify (`__intent` reflects a real morning; force `rushed` and watch the gate raise the floor) → `/kiosk-metrics` flat → default on.

## Testing

- **Pure (`insights.spec.js` style):** the House Model derives the right `{activity, tempo, timeBudget, company}` across representative days; missing appliance entities fall back to time+calendar+motion; `selectForMode` respects the intent-modulated floor.
- **UI smoke (`presence.spec.js` style):** flag-on, `__forceIntent({tempo:"rushed"})` → assert the GLANCE floor rises (an ordinary candidate that showed at neutral is suppressed); flag-off, the two-arg gate is unchanged.
- **Anti-flap:** feed a burst of alternating signals → assert the committed intent changes at most once (settle guard).

## Rollout & risk

- **Reversibility** — flag off = Phase 3–5 behaviour; ship off, flip on Pi, verify, default on. One-line rollback.
- **No engine surgery** — Phase 6 adds a pure reducer + one slice + one optional gate argument. The queue, decay, cooldowns, stack UI and FSM are untouched. This is the guardrail against scope creep.
- **Flapping is the real risk** — an intent that oscillates would make the floor jitter. Mitigated by the settle/hysteresis guard and the anti-flap test — the same "settle, don't loop" discipline that de-risked Phase 5.
- **Don't assume entities** — oven/appliance/light sensors are **not** presumed to exist; the model degrades gracefully. (The Phase 3 "no rule for a phantom entity" rule.)
- **Memory discipline** — `intentEngine` registers listeners once at init; no per-event UI surface. Re-check `/kiosk-metrics` after deploy regardless (a new event path).
- **Scope guard** — Phase 6 **only reasons**; it renders nothing new and dissolves no views. Making intent _visible_ (atmosphere/tempo across all modes) is **Phase 7**. Resist surfacing the intent as a card — its whole value is that it's felt, not shown.

## Footprint

1 new pure reducer + 1 small runtime + 1 store slice + 1 optional gate argument + a flag + tests. No new UI, no new data source — the House Model fuses signals the dashboard already gathers into a posture the later phases dress to.
