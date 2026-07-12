# Phase 7 — "Dissolve the Dashboard": The Ambient Substrate

_Plan drafted 2026-07-11. Part of the [Home OS vision](./home-os-vision.md) roadmap. Builds on [Phase 6](./phase-6-intent.md) (house intent) and [Phase 5](./phase-5-atmospherics.md) (ambient atmospherics). Second phase of "the Dissolve"._

**✅ Shipped & enabled on the Pi (`features.ambientSubstrate:true`).** The GPU prerequisite below was paid down first (Ken Burns → settle + hold dropped Mode-0 GPU 80%→0%). _(Original plan document; live status in the [roadmap](./home-os-vision.md).)_

## Key insight that de-risks this phase

**The atmosphere already exists — it's just trapped in Mode 0.** Phase 5's `atmosphere.js` maps real weather + light to an `atmo-*` token, but `screensaver.js` applies it to the `.screensaver` root, and `body.screensaver-active > *:not(#screensaver){visibility:hidden}` hides the dashboard behind it. So the room only "breathes" when nobody's home; the instant someone leans in, the atmosphere evaporates and the flat dashboard returns. **Phase 7 is mostly a move, not a build:** lift the token off the screensaver root onto a shared app root so the intent-dressed room persists through GLANCE and DWELL, and let engaged content render _over_ it.

Two things are already done for us: **navigation died in Phase 1**, so the rich legacy views (weather / cameras / briefing) are already user-unreachable; and the **dual CSS tree was already deleted in Phase 5**. What remains is to stop treating those views as an opaque substrate and let the atmosphere be a property of the whole screen.

The through-line: _Phase 5 made the room breathe when empty; Phase 7 lets it keep breathing when you walk up — the dashboard, as a thing you look **at**, quietly stops existing._

## The prerequisite — pay the GPU debt first (non-negotiable, gates the phase)

Phase 5's Pi verification uncovered a **pre-existing 80%-of-a-core** cost in Mode 0: `SoftwareImageDecodeCache::DecodeImageInTask` re-rasterising the full 1080p Ken Burns photo every frame (software raster on the Pi 4 despite `will-change:transform`). The atmosphere token itself adds **zero** cost — but Phase 7 makes the ambient layer render **during engaged states too**, so it cannot sit on a pinned baseline. This deferred follow-up (see `project-gpu-idle-freeze` / the Phase 5 memo) becomes Phase 7's **step 1 and its gate**:

- **Downscale the source photos** to display resolution before paint (kill the per-frame decode of oversized images), and/or
- **Longer holds instead of a continuous pan** (discrete settle, the Phase 5 "settle, don't loop" rule), and/or
- **Force a real compositor layer** so the transform composites instead of re-rasterising.

**Gate:** `gpucpu.sh <gpu-pid> 25` must **fall well below 80%** and stay low through GLANCE/DWELL, with `gpu-trace.cjs` showing `BeginMainFrame` **not** pinned at 60fps. Measured, not reasoned (the Phase 5 discipline). If the number doesn't drop, Phase 7 does not ship — full stop.

## Why this phase (the reward)

This is where the review's central complaint gets fixed: *"we made the house breathe, then arranged for it to hold its breath the moment anyone walks in."* After Phase 7, beauty stops being a screensaver costume and becomes the medium. Lean in during a storm and the storm is still there — in the warmth of the type, the pace of the light, the hush. The dashboard's cards don't sit on a white panel; they surface into a room that already has a mood. **Widgets → beauty**, made real.

## Goal & success criteria

Make the intent-dressed, weather-tinted room the **substrate for every presence mode**, not just Mode 0; render engaged content over it; and retire the now-redundant rich legacy views. All behind `features.ambientSubstrate` (default off → reversible).

Done when:
1. **GPU prerequisite met**: idle and engaged Mode-0→2 GPU cost is well below the 80% baseline, proven with `gpucpu.sh` (averaged, never `top -bn1`).
2. Flag **on**: the `atmo-*` token + intent tone apply to a shared root that persists across AMBIENT → GLANCE → DWELL; leaning in during `__atmosphere("atmo-storm")` keeps the storm present in the engaged room. Flag **off**: byte-identical to Phase 5/6.
3. Engaged content (the hero, the DWELL stack) is **legible over every atmosphere token** — contrast checked per token in the engaged state, not just the Mode-0 gradient.
4. The redundant rich views (weather / cameras full view / briefing view) are **gated off behind the flag** — not deleted mid-phase — with their real content already represented as candidates or event surfaces. Event-driven surfaces (doorbell/camera popup, voice) are **untouched**.

## What ships (grounded in what exists)

| Element | Today | Phase 7 change |
|---|---|---|
| **Atmosphere scope** | `atmo-*` on `.screensaver` root, hidden outside Mode 0 | Move to a shared app root; persists across modes | Ship |
| **Photo decode cost** | 80% core (software decode of 1080p pan) | Downscale / longer holds / compositor layer | **Ship (gate)** |
| **Engaged legibility** | readability gradient tuned for Mode 0 only | Per-token contrast for hero/stack over atmosphere | Ship |
| **Rich legacy views** (weather/cameras/briefing) | `viewManager` + modules, already unreachable since P1 | Gate off behind the flag once their content is candidate/event-represented | Ship (reversible) |
| **Event surfaces** (doorbell popup, voice) | event-driven, not nav | **Untouched** — these are not "the dashboard"; they're interrupts | Keep |
| Full deletion of the retired view code | — | **Defer** to a later cleanup — gate off first, delete once proven | Defer |

**Design rule (carried from Phase 5):** the substrate expresses mood through **settling transitions**, never loops. Moving atmosphere to a shared root must not introduce a perpetual animation on an always-visible node (that would re-pin the core the GPU fix just freed).

## File-by-file changes

**Fix (step 1, the gate) — `src/js/modules/screensaver.js` + `src/css/views/screensaver.css`**
- Pre-downscale photos to display resolution; convert the continuous Ken Burns pan to discrete holds with a settle (or force a compositor layer). Verified by `gpucpu.sh` before anything else in the phase proceeds.

**Edit — `src/js/modules/screensaver.js` / a new shared applier**
- Apply the `atmo-*` token (and the Phase 6 intent tone) to a **shared root** (e.g. `body.dataset` / an `#atmosphere` layer) instead of only the screensaver root, so it survives `exit()` into GLANCE/DWELL. Keep `freezeLotties()` for Mode 0.

**Edit — `src/css/layout/background.css` (+ the atmosphere token CSS)**
- Let the atmosphere layer sit behind the awake dashboard, not only the screensaver; add per-token contrast/scrim so the hero + DWELL stack stay legible over each mood.

**Edit — `src/js/core/viewManager.js`**
- When the flag is on, gate the rich legacy views (weather/cameras/briefing) off — their content already flows through the attention queue (Phases 2–3) or event surfaces. Leave `switchView` and the event-driven paths (doorbell/voice) intact.

**Config — `src/js/config.js`**
- Add `features.ambientSubstrate: false`. Default off; flip on the Pi after the GPU gate + visual pass; then default on.

**Debug** — reuse `window.__atmosphere(token)` and `window.__intent()`; add a check that the token persists across a `__presence("glance")` transition.

## Step sequence (each independently verifiable)

1. **GPU fix first** → verify: `gpucpu.sh` in Mode 0 drops well below 80%; `gpu-trace.cjs` shows no 60fps pin. **This gates the rest of the phase.**
2. Move token application to the shared root behind the flag → verify: flag-off byte-identical; flag-on, `__atmosphere("atmo-storm")` then `__presence("glance")` — storm persists into the awake screen.
3. Per-token legibility pass → verify: hero + DWELL stack contrast meets the readability bar over every `atmo-*` token in the engaged state.
4. Gate the rich legacy views off behind the flag → verify: their content still reaches the screen as candidates/events; doorbell + voice surfaces still fire.
5. `tests/dissolve.spec.js` (token persists across a mode change; legacy views hidden flag-on, present flag-off) → verify: `npm test` green.
6. Deploy flag OFF (no-op) → flip ON on Pi → `/kiosk-metrics` GPU pass (engaged states low) + visual pass of each atmosphere/mode combination → default on.

## Testing

- **GPU / kiosk (the real gate):** averaged `gpucpu.sh` well under the old 80% in idle **and** engaged modes; `BeginMainFrame` not pinned. Single-shot samples are useless — averaged only.
- **UI smoke:** flag-on, token applied → drive `__presence` through ambient→glance→dwell and assert the atmosphere class stays on the shared root; flag-off, the screensaver-scoped behaviour is unchanged.
- **Legibility:** automated contrast check of hero/stack text against each token's engaged-state background.
- **Regression:** doorbell popup + voice view still fire with the legacy nav views gated off.

## Rollout & risk

- **The GPU budget is the gating risk.** If the decode cost doesn't drop, an always-visible ambient layer re-pins the core. Mitigated by making the fix step 1 with a hard measured gate; the phase does not proceed until it passes.
- **Legibility over atmosphere** — the readability gradient was tuned for Mode 0's near-silent frame; engaged text over a storm tint could fail contrast. Mitigated by the per-token contrast pass + automated check.
- **Reversibility** — `ambientSubstrate: false` = Phase 5/6 behaviour, legacy views restored. One-line rollback. Views are **gated, not deleted**, mid-phase.
- **Memory discipline** — moving the token is a class swap on an existing node; no new per-event surface. But confirm the shared-root layer introduces no loop and no leaked listener; re-check `/kiosk-metrics`.
- **Scope guard** — Phase 7 dissolves the **ambient boundary** and retires the **already-unreachable** nav views; it does **not** touch event-driven interrupts (doorbell/voice), and it does **not** delete the retired code (that's later cleanup). Resist rebuilding the rich views' content as new UI — it's already candidates and events.

## Footprint

1 GPU fix (the gate) + moving the atmosphere token to a shared root + a legibility pass + gating the dead nav views + a flag + tests. Almost no new UI — the phase mostly **relocates** what Phase 5 built and pays down the decode debt so it can run all the time.
