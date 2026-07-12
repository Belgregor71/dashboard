# Phase 8 — "Learn Without Asking": Behavioural Learning

_Plan drafted 2026-07-11. Part of the [Home OS vision](./home-os-vision.md) roadmap. Builds on [Phase 6](./phase-6-intent.md) (house intent) and [Phase 1](./phase-1-presence-runtime.md) (context store). Third phase of "the Dissolve"._

**✅ Shipped & enabled on the Pi (commit `548c63b`, `features.routineLearning:true`); the multi-day observation window is running.** Pure `routineStore.js` + persistence route + observation runtime + advisory feeds into House Model / attention are in; `npm test` green (pure `tests/routines.spec.js` + contract); flag-on path verified (seeded history → learned departure sharpens the live `timeBudget`; below-threshold gates to null; nudges computed). Advisory-until-confident: it observes + persists bounded aggregates but stays inert until routines cross the confidence threshold, so there's no behaviour change until it has learned. Reversible → `routineLearning:false`. _(Original plan document; live status in the [roadmap](./home-os-vision.md).)_

## Key insight that de-risks this phase

**The heartbeat already exists; learning is a passive observer on it.** `contextStore.js` is the single seam every signal flows through, `presence.js` emits mode transitions with timestamps, `arrivalGreeting.js` already tracks `person.*` home/away with `lastKnownState`, and the Pi already persists JSON to disk (`data/holiday-cache/`). Behavioural learning adds **no new signal and no new UI** — it subscribes to what's already emitted, accumulates cheap distributions, and writes bounded aggregates to disk. It is deliberately **off the render path**: it observes and informs; it never draws.

Critically, it stays **advisory**. The House Model (Phase 6) already produces `timeBudget` and `tempo` from live signals; Phase 8 just lets those be **sharpened by history** once history is confident — nothing acts on a learned routine below a confidence threshold, and nothing is ever announced.

The through-line: _the house gets more useful every month by watching, never by asking — and by staying quiet until it's sure._

## Why this phase (the reward)

The review's test was *"more useful every month, and never once asks a question."* Configuration is an admission the house doesn't know you yet. By month three, the Sunday screen doesn't jump to full brightness at 7am; "leave by" and "welcome home" land on the real moment, not a timer; the information you always ignore stops being offered. The person can't say when it started getting this right — which is the point. **A good host never tells you they remembered how you take your coffee. It's just already made.**

## Goal & success criteria

A quiet, on-device observation store that learns household rhythms from existing events, persists bounded aggregates to disk, exposes a **confidence** per routine, and feeds the House Model + attention ranking — acting only above a confidence threshold, never announcing. All behind `features.routineLearning` (default off → reversible).

Done when:
1. Flag **on**: the store accumulates distributions (first-motion, departure, return, weekday-vs-weekend rhythm, per-source dwell attention) and persists them to `data/routines/`. Flag **off**: byte-identical; no observation, no writes.
2. Learned values feed the House Model (`timeBudget` sharpened by learned departure) and attention (sources the user never dwells on are down-weighted) — **only above the confidence threshold**; below it, Phase 6 behaviour is unchanged.
3. Storage is **bounded** — rolling windows, not append-forever — verified to not grow without limit over a 24/7 run (the kiosk memory discipline).
4. The learning math is **pure and node-unit-tested**; nothing is ever surfaced as "I noticed you usually…".

## What it learns (from signals already flowing)

| Routine | Source (already emitted) | Consumes into |
|---|---|---|
| **Wake / first-motion time** | first `GLANCE` after the night window (`presence` + `isNight`) | Mode-0 brightness ramp, morning tone |
| **Departure / return** | `person.*` home→away / away→home (`arrivalGreeting` source) | House Model `timeBudget`; leave-by + welcome-home timing |
| **Weekend vs weekday rhythm** | day-of-week + the above, bucketed | day-character (feeds Phase 9 timeline) |
| **Attention preferences** | which candidate sources get dwelt on vs ignored (attention engine already knows the hero/stack) | per-source weight nudge in `attentionRank` |
| ~~Coffee / appliance routine~~ | needs a power/appliance HA entity | **Only if such an entity exists** — else omitted (the "no phantom entity" rule) |

Everything is an **aggregate** (a time-of-day distribution + a confidence), never a log of individual events — smaller, safer, and enough to anticipate.

## File-by-file changes

**New — `src/js/services/routineStore.js`**
- Pure accumulation + confidence math: `observe(event)` folds a signal into a rolling distribution; `confidence(routine)` returns 0–1 from sample count + variance; `predict(routine, now)` returns the learned value or `null` below threshold. No DOM/IO — the runtime feeds it events and flushes aggregates.

**New — `server/routes/routines.js` + persistence (+ contract test)**
- Small `GET`/`PUT` of the aggregate blob to `data/routines/*.json`, mirroring the `holiday-cache` precedent (bounded file, aggregates only). Contract test asserts the shape and that a missing file degrades to empty (cold start). **On-device only — no upstream, ever** (the privacy guardrail).

**Edit — `src/js/core/app.js` / a small runtime glue**
- Subscribe `routineStore.observe` to `presence:changed` and `person.*` transitions; load aggregates on boot; flush on a long interval (init-once timer — the safe kind). All under the flag.

**Edit — `src/js/services/houseModel.js`**
- When a routine is confident, let it sharpen `timeBudget` (learned departure) and `tempo` priors. Below threshold, unchanged — the model already works without it.

**Edit — `src/js/services/attentionRank.js`**
- Apply a bounded per-source weight nudge from learned attention preferences. Small, clamped — learning tilts, never overrides, the score.

**Config — `src/js/config.js`**
- Add `features.routineLearning: false`. Default off; flip on the Pi; then default on after a multi-day observation window proves the aggregates stabilise.

**Debug** — `window.__routines()` (dump distributions + confidence) and `window.__seedRoutines(history)` to inject synthetic history over CDP so a learned wake time can be verified without waiting days.

## Step sequence (each independently verifiable)

1. `routineStore.js` pure math → verify: unit tests — distributions fold correctly, confidence rises with samples/falls with variance, `predict` returns null below threshold.
2. Persistence route + `data/routines/` → verify: contract test (shape + cold-start empty); a `PUT` then `GET` round-trips; the file is bounded.
3. Wire observation behind the flag (boot-load, subscribe, flush) → verify: flag-off no writes; flag-on, `__seedRoutines` then `__routines()` shows a learned wake time.
4. Feed into House Model + attention weight → verify: above threshold sharpens `timeBudget` / nudges a source; below threshold, Phase 6 behaviour unchanged.
5. `tests/routines.spec.js` (pure) + contract test → verify: `npm test` green.
6. Deploy flag OFF (no-op) → flip ON on Pi → observe for several days → confirm aggregates stabilise + bounded + `/kiosk-metrics` flat → default on.

## Testing

- **Pure (`insights.spec.js` style):** folding, confidence, and `predict`-below-threshold-returns-null; the weight nudge is clamped.
- **Contract (`api.spec.js`):** the routines route round-trips and cold-starts empty; the file stays bounded.
- **Kiosk:** `__seedRoutines` → a learned departure sharpens the leave-by moment; `/kiosk-metrics` flat across a multi-day run (no unbounded growth — the phase-critical check).

## Rollout & risk

- **Unbounded 24/7 growth is the primary risk** (the kiosk's defining failure mode). Mitigated by **aggregates-not-logs** + rolling windows + a bounded on-disk blob, verified over a multi-day Pi run before default-on.
- **Acting wrong-confident, out loud** — a half-learned routine that announces itself would be worse than silence. Mitigated by **confidence-before-action** + the absolute rule that learning is never phrased ("I noticed…" is banned).
- **Privacy** — behavioural data stays **on the Pi**, aggregates only, never sent upstream (the same guardrail as the voice-transcript rule). No individual-event log persisted.
- **Reversibility** — `routineLearning: false` = Phase 6 behaviour; delete `data/routines/` to reset. One-line rollback.
- **Scope guard** — Phase 8 **learns and advises**; it adds no new surface and does not act above what Phase 6 already does except to sharpen it. Coffee/appliance routines are built **only if** a real HA entity exists. Resist turning learning into a visible "insights about you" feature — its value is that it disappears into being ready.

## Footprint

1 new pure learning module + 1 small persistence route (holiday-cache pattern) + observation glue + two advisory hooks into House Model / ranking + a flag + tests. No new UI, no new signal — it watches the heartbeat that already beats and quietly gets the timing right.
