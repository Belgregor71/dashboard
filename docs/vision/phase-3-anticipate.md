# Phase 3 — "Anticipate": Predictive Candidates

_Plan drafted 2026-07-11. Part of the [Home OS vision](./home-os-vision.md) roadmap. Builds on [Phase 2](./phase-2-attention-engine.md) (unified attention engine, shipped & enabled) and [Phase 1](./phase-1-presence-runtime.md) (presence FSM)._

**✅ Shipped & enabled 2026-07-11.** Code `0987e33` (flag-off), default-on `6656fe0` — both deployed and live on the Pi. Verified on the kiosk over CDP: `__nowcastProbe(15, 80)` + `__refreshAttention()` fired a rain-incoming hero at the confidence-scaled score (75 = `55 + round(80×0.25)`), decaying past its window; flag-off regression clean; `/kiosk-metrics` flat across 15 refresh cycles (no leak — `refresh()` is pure fetch + rule eval, no new UI). Rain-incoming, bin-night, and on-this-day ship; package-expected and door/garage stay deferred as planned.

## Key insight that de-risks this phase

Phase 2 already built everything anticipation needs. The attention engine's candidate model has **`expiresAt` (decay)**, **`interrupt`** (override the AMBIENT floor), **score bands**, and the **cooldown store** — and `rankQueue` already drops expired candidates. So Phase 3 does **not** touch the engine, the renderer, the presence gate, or the stack UI. It adds **pure rules and the data they read**, exactly like `insightRules.js` — the lowest-risk shape of work in this codebase.

The through-line: _Phase 2 built the queue; Phase 3 fills it with things the house sees coming._

Reactive today (Phase 2): "It **is** raining" (severe-weather candidate). Anticipatory (Phase 3): "It will rain in ~15 min — bins are still out." Same engine, same hero, one new rule + one small backend field.

## Goal & success criteria

Add a small set of **grounded** predictive candidates to the existing engine, each with a real data source, a decay (`expiresAt`), and confidence baked into its score — all behind `features.predictiveCandidates` (default off → reversible, the Phase 1/2 pattern).

Done when:
1. Flag **on**: the focus-hero can surface an anticipatory candidate (rain-incoming, bin-night, on-this-day memory) ranked fairly against today's reactive sources; flag **off**: byte-identical to Phase 2.
2. A short-lived candidate (`rain-incoming`, "~15 min") **decays**: it disappears once its `expiresAt` passes, with no manual teardown (the engine already drops it).
3. Every new rule is **pure and node-unit-tested** (the `insightRules.js` / `insights.spec.js` discipline); any new server route ships with its contract test in the same change.
4. Low-confidence signals are **damped, not shown as fact** — the score carries confidence, so a 55%-probability nowcast loses to a firm commitment.

## The predictive candidates (grounded in what exists)

| Candidate | Band | Data source | Decay | Status |
|---|---|---|---|---|
| **rain-incoming** | Medium→High (55–80, confidence-scaled) | **new** Open-Meteo `minutely_15` precip via a nowcast route | `expiresAt` = start of the rain window | Ship |
| **bin-night** | Medium (50) | `ctx.bins` (already gathered) | end of the evening | Ship |
| **on-this-day** (memory) | Low (40–45) | `occasionPopup` occasion logic + calendar anniversaries | end of day | Ship |
| **package-expected** | Medium | _none in repo_ | — | **Defer** (needs a parcel/email source) |
| ~~door/garage-left-open~~ | Interrupt | — | — | **N/A** — no such HA entity exists (was a vision example only) |
| leave-by | High (84+) | shipped in the leave-by insight | — | Already live |

There is **no interrupt-level candidate in Phase 3** — the garage/door-left-open safety idea from the vision was illustrative; no `cover`/door entity exists on this HA install. Severe-weather (Phase 2) remains the only AMBIENT-overriding interrupt. If a door/cover sensor is ever added, a safety candidate is a trivial `interrupt:true` rule on the same engine — noted for a future phase, not built here.

**Confidence damping (vision: score = importance × urgency × confidence).** Predictive rules bake confidence into the returned `score` — no new field, keeping rules pure. E.g. `rain-incoming` scores `55 + round(prob% × 0.25)` so a 90% nowcast (≈78) outranks a 60% one (≈70) and a marginal 40% reading falls below the Medium floor and never shows. This is the "damped, not shown as fact" rule made concrete.

## Presence fit (already handled by Phase 2)

No new gating. The predictive candidates flow through `selectForMode` unchanged:
- `rain-incoming` / `bin-night` show from **GLANCE** up; they join the **DWELL** top-3 stack when they don't win the hero.
- `on-this-day` is Low-band by design: it only ever surfaces when nothing else is competing — the "occasional earned memory" of Mode 0/1.
- None of the Phase 3 candidates are interrupt-level, so **AMBIENT stays quiet** — on-brand: the screen still says nothing to an empty room unless Phase 2's severe-weather fires.

## File-by-file changes

**New — `src/js/services/predictiveRules.js`**
- Pure rules over the shared context, same contract as `insightRules.js` (return `{ id, icon, text, score, cooldownMs, source, expiresAt? }` or `null`; `id` doubles as the cooldown key). `rainIncoming`, `binNight`, `onThisDay`. Exports `evaluatePredictive(ctx, now, extras)` mirroring `evaluateInsights`.

**Edit — `server/services/weatherService.js`**
- Add `minutely_15=precipitation` (and/or `precipitation_probability`) to the Open-Meteo request; expose a small `nowcast` shape: the next precip window `{ startsInMin, probabilityPct, mm }` or null.

**Edit — `server/routes/weather.js`** (+ **contract test** in `tests/api.spec.js`)
- Surface the nowcast (extend `/api/weather/now` or add `/api/weather/nowcast`). Contract test asserts the shape + that it degrades to `null` when upstream is down (the "upstreams may be down" test philosophy).

**Edit — `src/js/modules/briefingData.js`**
- Add `nowcast` and `anniversaries` (dated calendar events / occasion matches for today) to the gathered context. Add a `__nowcastProbe(minToRain, prob)` debug hook (convention: `__leaveByProbe` / `__forceInsight`) so rain-incoming can be verified on the kiosk without waiting for weather.

**Edit — `src/js/services/attentionEngine.js`**
- In `refresh()`, merge `evaluatePredictive(ctx, now, extras)` into the candidate list alongside `evaluateInsights(...)`. One added line of collection + concat; ranking, decay, cooldowns, phrasing are already there. Guard the whole predictive block behind the flag so flag-off is untouched.

**Edit — `src/js/modules/binReminder.js`** (dissolve-a-view foothold, optional within phase)
- The vision's "dissolve first legacy views" starts here: `bin-night` in the queue supersedes the standalone bin popup. If it proves out, gate the popup off behind the flag (don't delete mid-phase). Keep this as the phase's _second half_, not a prerequisite.

**Config — `src/js/config.js`**
- Add `features.predictiveCandidates: false`. Default off for the first deploy; flip on the Pi after live verification; then default on (Phase 1/2 rollout).

**Debug** — reuse `window.__forceCandidate` (Phase 2) for interrupt/decay checks; add `window.__nowcastProbe` for the rain path.

## Step sequence (each independently verifiable)

1. Backend nowcast: `minutely_15` in weatherService + route + **contract test** → verify: `npm test` green, shape holds with upstream stubbed off.
2. `predictiveRules.js` with `rainIncoming` + `binNight` (pure) → verify: unit tests — in-band scores, confidence scaling, `expiresAt` set, sub-threshold nowcast returns null.
3. Wire `evaluatePredictive` into `attentionEngine.refresh()` behind the flag → verify: flag-off byte-identical; flag-on, a forced/probed rain candidate appears in `__attention().queue` and **drops after `expiresAt`**.
4. `onThisDay` memory rule + `anniversaries` in context → verify: unit test fires on a matching date; Low-band so it yields to any Medium+ candidate.
5. Extend `tests/insights.spec.js` (pure) + a UI/CDP smoke for decay → verify: `npm test` green (pre-push gate).
6. Deploy flag OFF (no-op) → flip ON on Pi → CDP-verify (`__nowcastProbe` shows a rain hero, then watch it decay past its window) → `/kiosk-metrics` clean → default on.

## Testing

- **Pure (`insights.spec.js` style):** each predictive rule scores in-band and scales with confidence; `rain-incoming` sets `expiresAt` and returns null below the probability floor; `bin-night` fires only on bin eve; `on-this-day` matches its date and stays Low-band. Reuse the Phase 2 `rankQueue` test to prove a decayed candidate drops out of the queue.
- **Contract (`api.spec.js`):** the nowcast route returns the documented shape and a safe `null` when Open-Meteo is unreachable.
- **UI/CDP smoke:** `__nowcastProbe` → assert a `rain-incoming` hero appears, then disappears once its window passes (decay).

## Rollout & risk

- **Reversibility** — flag off = Phase 2 behaviour; ship off, flip on Pi, verify, default on. One-line rollback.
- **No engine surgery** — Phase 3 adds rules + one backend field + one concat line. The queue, decay, cooldowns, presence gate, and stack UI are all Phase 2 and untouched. This is the guardrail against scope creep.
- **Confidence, not certainty** — low-confidence signals are damped in-score; a marginal nowcast simply loses. Never phrase a prediction as a fact (the AI-phrase guard already caps length).
- **Memory discipline** — no new per-event UI surface (the stack is reused); nothing to teardown beyond what the engine already prunes. Still re-check `/kiosk-metrics` after deploy since `refresh()` gains work and a route.
- **Scope guard** — Phase 3 ships **grounded** predictive candidates only. **Package-expected is deferred** (no data source — would need a parcel/email/17track integration; name it, don't build it here). **Garage/door-left-open does not exist** on this HA install — it was a vision example; don't build a rule for a phantom entity. **Dissolving legacy views** beyond the single bin-popup foothold is Phase 5 cleanup, not this phase. Resist inventing candidates without a real source.

## Footprint

1 new pure rules file + 1 backend field/route (+contract test) + 2 small context/engine edits + a flag + tests. No new UI, no engine changes — anticipation is almost entirely new **rules** dropped into the queue Phase 2 already ranks, decays, and renders.
