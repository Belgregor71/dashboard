# Phase 10 — "One Character": The Personality Engine & Delight

_Plan drafted 2026-07-11. Part of the [Home OS vision](./home-os-vision.md) roadmap. Builds on and harmonises [Phase 6](./phase-6-intent.md) (intent), [Phase 7](./phase-7-dissolve.md) (substrate), [Phase 8](./phase-8-learn.md) (learning), and [Phase 9](./phase-9-remember.md) (memory). Final phase of "the Dissolve"._

**📝 Proposed — not yet built. Deliberately last: a temperament can only harmonise behaviours that already exist.**

## Key insight that de-risks this phase

**The house already speaks in several voices; Phase 10 gives it one.** Tone is currently scattered — `insightEngine.js` AI-phrases with a deterministic fallback, `arrivalGreeting.js` writes its own "welcome home" copy + TTS, `atmosphere.js` sets transition timing, the attention engine caps phrasing length. Each is fine alone; together they're a house with slightly different manners depending on which module is talking. Phase 10 introduces **one temperament authority** every surfacing path routes through — not a new behaviour, a **consistency layer** over the behaviours 6–9 built. That's why it's last: there's nothing to harmonise until they exist.

The **delight** moments ride the same layer: they are not new engines, they're **rare triggers** on signals the house already has (first rain after a dry spell = weather history; home-after-away = `arrivalGreeting`; DST sunrise = the clock; power-restored = a cold boot), each with a hard budget so they stay once-a-year magic, not features.

The through-line: _character isn't jokes — it's the thousand small decisions made the same way every time, so the house feels like **one** thing you live with._

## Why this phase (the reward)

The review asked for personality "in the sense of behaviour, not jokes" — and named consistency, not entertainment, as the goal. After Phase 10 the house is always, recognisably the same: through winter, through a hard week, through a birthday. Its defining trait is **restraint** — warm, unhurried, confident enough to say nothing, and when it does speak, short and plain and never nagging. That consistency is what turns behaviour into **identity**: a house that's gentle on Tuesday and chirpy on Wednesday has no character; a house that's the same every day becomes _someone_. And two or three times a year it does something small and perfect the household tells other people about.

## Goal & success criteria

One temperament authority governing tone, phrasing register, motion timing, warmth, celebration and **silence**, routed through by every surfacing path; plus a tightly-rationed delight registry. All behind `features.personality` (default off → reversible).

Done when:
1. Flag **on**: attention phrasing, memory surfacing, arrival copy, and atmosphere transition timing all draw their tone/timing from `personality.js` — one recognisable voice. Flag **off**: each module's current tone is unchanged.
2. The temperament is **restraint-first**: short/plain phrasing, no apologies, no nagging, no repetition-until-acknowledged; silence thresholds are centralised and honoured.
3. The delight registry fires its rare moments with **hard budgets** (once per season/year) persisted across reboots; a trigger **cannot fire twice** within its budget.
4. **Consistency is tested** — a snapshot across every surfacing path proves one voice; each delight trigger is unit-tested against its budget.

## The temperament (one set of manners)

| Facet | Centralised rule |
|---|---|
| **Phrasing register** | short, plain, active; no apology, no nag, no "I noticed…"; length already capped — now the _voice_ is too |
| **Silence thresholds** | when to say nothing — the default; the house's loudest setting is still quiet |
| **Motion timing** | settle durations + easing tokens (reuses the Phase 5 "settle, don't loop" curves) shared by every transition |
| **Warmth / colour** | tone of the atmosphere + accent, consistent across modes (Phase 7 substrate) |
| **Celebration** | how the house marks a good thing — a warmth, never confetti; scaled to the occasion |

## The delight registry (rare by design)

| Moment | Trigger source (already present) | Budget |
|---|---|---|
| **First rain after a long dry spell** | weather history (dry-days streak → rain) | once per dry-spell break |
| **First sunrise after daylight saving** | the clock / DST boundary | once per year |
| **Home after being away** | `arrivalGreeting` + a multi-day-away flag | per long absence |
| **Birthday morning** | structured memory (Phase 9) / occasion | once per birthday |
| **Christmas Eve** | the date | once per year |
| **Power restored after an outage** | cold boot after downtime | per outage |

Each is a small, distinct **behaviour** (not a notification) with its budget enforced centrally and persisted (reuse the Phase 8 on-disk store), so it can't repeat.

## File-by-file changes

**New — `src/js/core/personality.js`**
- The temperament authority: `phrase(intent, kind, data)` (voice + register), `timing(kind)` (settle/easing tokens), `shouldSpeak(candidate, intent)` (silence thresholds), `celebrate(occasion)`. Pure where possible; the single place the house's manners live.

**New — `src/js/services/delight.js` + a persisted budget (Phase 8 store)**
- A registry of rare triggers, each `{ id, detect(ctx, history), budget, behaviour }`, with budgets persisted to disk so they survive reboots. Pure detection + budget math; the runtime fires the behaviour.

**Edit — `src/js/services/attentionEngine.js` / `insightEngine.js`**
- Route AI/deterministic phrasing through `personality.phrase` and gate on `personality.shouldSpeak` (the deterministic fallback still always exists). One voice, same queue.

**Edit — `src/js/modules/arrivalGreeting.js`**
- Draw its copy + timing from `personality` instead of local strings; expose the multi-day-away signal to `delight` for the "home after being away" moment.

**Edit — `src/js/services/atmosphere.js` / the transition CSS**
- Take settle/easing from `personality.timing` so the room's motion matches the house's manners.

**Config — `src/js/config.js`**
- Add `features.personality: false`. Default off; flip on the Pi; then default on after the consistency snapshot + delight-budget checks pass.

**Debug** — `window.__forceDelight(id)` (fire a moment on demand, then confirm the budget blocks a second fire) and `window.__voice(kind)` (preview the phrasing register), for CDP verification without waiting for a once-a-year trigger.

## Step sequence (each independently verifiable)

1. `personality.js` with phrasing + timing + silence + celebrate → verify: unit tests — register is consistent, silence thresholds honoured, deterministic fallback preserved.
2. Route attention phrasing + `shouldSpeak` through it behind the flag → verify: flag-off tone unchanged; flag-on, the hero copy matches the temperament and stays silent below threshold.
3. Route arrival + atmosphere timing through it → verify: welcome-home copy + transition easing come from the one authority.
4. `delight.js` registry + persisted budgets → verify: unit tests — each trigger detects correctly and **cannot fire twice** within budget; budgets survive a simulated reboot.
5. `tests/personality.spec.js`: a **consistency snapshot** across every surfacing path + delight-budget tests → verify: `npm test` green.
6. Deploy flag OFF (no-op) → flip ON on Pi → `__forceDelight` each moment (confirm behaviour + no re-fire) + `__voice` preview + a lived-with soak → default on.

## Testing

- **Pure (`insights.spec.js` style):** phrasing register consistency, silence thresholds, deterministic fallback intact; each delight trigger's detection + **budget-blocks-second-fire** invariant; budgets persist across a reboot.
- **Consistency snapshot:** golden output of tone across attention / memory / arrival / atmosphere — the phase-critical test that proves **one** voice.
- **Kiosk:** `__forceDelight(id)` fires the behaviour once and is then blocked; `__voice` previews match the snapshot; `/kiosk-metrics` flat (routing, not new UI).

## Rollout & risk

- **Drifting into gimmick** — personality "in the sense of jokes" is explicitly **not** the goal; a chatty or cute house would betray the whole project. Mitigated by a **restraint-first** temperament, the consistency snapshot, and silence being the default setting.
- **Delight over-firing** — magic that repeats is just a feature. Mitigated by **hard, centrally-enforced, persisted budgets** and the can't-fire-twice test. When in doubt, rarer.
- **Consistency regressions** — the risk that a later change quietly re-introduces a second voice. Mitigated by the snapshot test in the pre-push gate.
- **Reversibility** — `personality: false` = each module's current tone; delight budgets are additive data. One-line rollback.
- **Scope guard** — Phase 10 **harmonises and rations**; it adds no new engine and no new information. Delight moments are **rare triggers on existing signals**, not new sensors. Resist adding "fun" — the reward is coherence, not entertainment.

## Footprint

1 temperament authority + 1 rare-delight registry (on the Phase 8 store) + routing four existing surfacing paths through them + a flag + a consistency snapshot test. No new information, no new UI — the last phase makes everything already built feel like **one** house, and lets it be quietly, memorably magic a few times a year.
