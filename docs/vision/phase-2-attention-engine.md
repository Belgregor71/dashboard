# Phase 2 — "One Hero, One Queue": Attention Engine

_Plan drafted 2026-07-11. Part of the [Home OS vision](./home-os-vision.md) roadmap. Builds on [Phase 1](./phase-1-presence-runtime.md) (presence FSM, shipped)._

## Key insight

The dashboard already has **two competing attention models**, and Phase 2 is mostly about deleting one of them:

1. `src/js/services/insightRules.js` — a real scored-candidate engine. Rules return `{ id, icon, score, text, cooldownMs }`; `evaluateInsights` filters + sorts best-first; `pickInsight` respects cooldowns; the current pick is exempt from its own cooldown. Pure, no DOM/IO, unit-tested in `tests/insights.spec.js`. **This is the model we keep.**
2. `src/js/services/focusEngine.js` (`computeFocus`) — a *separate* hardcoded if/else ladder: `bomWarning > severe-weather > insight > commute > nextEvent`. Not scored, not on cooldowns, reads pre-baked DOM strings. **This is the model we retire.**

`focusHero.js` renders whatever `computeFocus` returns (falling back to an AI "concierge" line). So today the BOM warning, commute and next-event "tiers" live outside the scored queue entirely.

Phase 2 makes **every** source a scored candidate in **one** ranked queue, gated by the Phase 1 presence mode, and finally gives the already-emitted `DWELL` mode a job.

## Goal & success criteria

Unify attention into one engine: all sources emit scored candidates; the hero renders the winner; the presence mode sets how much shows. Add the Mode 2 lean-in reveal. All behind `features.attentionEngine` (default off → reversible, exactly like `presenceRuntime`).

Done when:
1. Flag **on**: the focus-hero shows the top-ranked candidate across *all* sources (BOM, weather, leave-by, bins, fuel, commute, next-event) — same visible behaviour as today for the common cases, but now driven by scores, not an if/else ladder.
2. An interrupt-level candidate (BOM severe warning / storm) can override even Mode 0 (AMBIENT); ordinary candidates only show from Mode 1 (GLANCE) up.
3. Dwelling 30s (Mode 2 `DWELL`, already emitted by Phase 1) reveals the **top 3** as a small stack; leaving/idle collapses back to one (GLANCE) or none (AMBIENT).
4. Flag **off**: byte-identical to today (`computeFocus` path untouched).
5. `insightRules` stays pure and unit-tested; new candidate sources are unit-tested the same way.

## The unified candidate model

Extend the existing shape with two optional fields; everything else is already there:

```
{ id, icon, text, score, cooldownMs,
  source,        // "bom" | "weather" | "insight" | "commute" | "nextEvent" | …
  expiresAt?,    // epoch ms; candidate is dropped past this (e.g. "rain in 14 min")
  interrupt? }   // true → may override the AMBIENT floor (security, storm)
```

**Score bands** (so sources rank fairly and the old ladder falls out of the numbers):

| Band | Range | Examples |
|---|---|---|
| Interrupt | 90–100 | BOM severe warning, storm, security alert (`interrupt: true`) |
| High | 70–89 | leave-by (already scores 84+) |
| Medium | 50–69 | bins-vs-rain, fuel-cycle, tomorrow-rain, next-event |
| Low | 40–49 | plain commute readout, ambient concierge |

The current `computeFocus` order (`bom > weather > insight > commute > nextEvent`) is reproduced simply by these bands — no special-casing.

## Presence gates the queue (Phase 1 → Phase 2 join)

The presence mode sets the **floor** and the **depth**:

| Mode | Shows |
|---|---|
| `AMBIENT` (0) | only `interrupt` candidates (score ≥ 90) — otherwise nothing |
| `GLANCE` (1) | the single top candidate (the hero) |
| `DWELL` (2) | the top 3 (hero + a 2-item lean-in stack) |
| `VOICE` (3) | nothing — hands the floor to voice (Phase 4) |

`DWELL` is already emitted by `presence.js` (dormant in Phase 1). Phase 2 is its first consumer.

## File-by-file changes

**New — `src/js/services/candidateSources.js`**
- Pure(ish) adapters that turn today's `focusEngine` inputs into scored candidates: `bomCandidate`, `weatherSevereCandidate`, `commuteCandidate`, `nextEventCandidate`. Same discipline as `insightRules` — logic pure, the runtime passes state in. Keeps the "rules are pure, runtime does IO" split intact.

**New — `src/js/services/attentionEngine.js`**
- Collects candidates from `insightRules` (via existing `evaluateInsights`) **and** `candidateSources`, drops expired (`expiresAt`), ranks by score, applies the existing `pickInsight`/`claimCooldown` cooldown logic.
- Exposes `getHero()` (top 1) and `getStack(n=3)` (top n) for the renderer; reuses the `dashboard:insight-cooldowns` store.
- Absorbs the AI-phrasing already in `insightEngine.js` (template is always the fallback).

**Edit — `src/js/modules/focusHero.js`**
- When the flag is on, render from `attentionEngine` + the current presence mode instead of `computeFocus`. When off, unchanged. `focusEngine.js` stays as the flag-off path (retired for real in a later cleanup, not deleted mid-phase).

**New UI — lean-in stack (Mode 2)**
- A small stack region near `#focus-hero` showing candidates 2–3, revealed on `presence:changed → dwell`, collapsed on `glance`/`ambient`. Opacity-fade only (transform breaks fixed descendants — see leak-audit memory); `setTimeout` teardown, never `transitionend` on a hidden node.

**Config — `src/js/config.js`**
- Add `features.attentionEngine: false`. Flip on the Pi after live verification, then default on (the Phase 1 rollout pattern).

**Debug hook** — `window.__attention` (return the ranked queue + current hero/stack), matching `__presence` / `__forceInsight` for CDP verification.

## Step sequence (each independently verifiable)

1. `candidateSources.js` — convert the four `computeFocus` tiers to scored candidates → verify: unit tests assert scores land in the right bands.
2. `attentionEngine.js` — merge insight + source candidates, rank, cooldown → verify: unit test that BOM outranks commute, expired candidates drop, cooldown respected.
3. `focusHero.js` renders from the engine behind the flag → verify: flag-on hero matches flag-off hero for common cases (same top pick).
4. Wire the `DWELL` consumer + stack UI → verify: driving presence to `dwell` reveals top 3; back to `glance` collapses to 1.
5. `tests/insights.spec.js` extended + a UI smoke for the reveal → verify: `npm test` green.
6. Deploy flag OFF (no-op) → flip ON on Pi → CDP-verify (`__attention`, force an interrupt candidate, drive presence to dwell) → default on.

## Testing

- **Pure (node, `insights.spec.js` style):** each new candidate source scores in-band; `attentionEngine` ranking (interrupt > high > medium > low), `expiresAt` drop, cooldown claim/exempt-current.
- **UI smoke (`presence.spec.js` style):** flag-on, force a stack via `__attention`/`__forceInsight`, drive `__presence("dwell")` → assert 3 items visible; `__presence("glance")` → 1; `__presence("ambient")` → 0 unless interrupt.

## Rollout & risk

- **Reversibility** — flag off = today's `computeFocus`; ship off, flip on Pi, verify, default on. One-line rollback.
- **Keep `insightRules` pure** — new sources follow the same pattern so they stay node-testable; the runtime remains the only place with DOM/HA reads.
- **Memory discipline** — the stack is the only new per-event UI; symmetric teardown, opacity-only, `setTimeout` fallback. Re-check with `/kiosk-metrics` after deploy (this touches a render path + a timer).
- **Scope guard** — Phase 2 *unifies and ranks*; it does NOT add new predictive rules (leave-by already shipped; rain-incoming, package-expected, garage-open are **Phase 3**). Resist adding candidate sources beyond converting the existing `computeFocus` tiers.

## Footprint

~2 new service files + 1 small UI surface + `focusHero` rewired + a flag + tests. No new data sources — it re-ranks signals the dashboard already has, and switches on the presence mode Phase 1 already emits.
