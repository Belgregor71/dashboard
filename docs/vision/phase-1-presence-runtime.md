# Phase 1 — "Name the Engine": Presence Runtime

_Plan drafted 2026-07-11. Part of the [Home OS vision](./home-os-vision.md) roadmap._

## Key insight that de-risks this phase

The click-cycle is **effectively dead code on the Pi**. `viewManager.registerClickCycle()`
cycles views on a `document` click — but the hardware has no mouse, touch, or keyboard.
Nothing clicks. The non-home views (weather / cameras / timeline) are reached today by
**events**, not clicks:

- `doorbellAlert` / `cameraPopupOverlay` → cameras view
- `voiceCommands` → view switch
- `morningBriefing` → briefing view
- `screensaver.exit()` → home view

So deleting the navigation removes a phantom nobody triggers, while every real view
transition keeps working.

## Goal & success criteria

Extract a **presence FSM** and a minimal **context store** that observe and name the
behaviour the code already exhibits, delete the phantom click-navigation, and set
`body.dataset.presence` — all behind a feature flag so it ships reversibly. **No new
user-facing features.** Just the spine.

Done when:
1. Flag **on**: a `document` click no longer changes the view. Flag **off**: behaviour is byte-identical to today.
2. `presence:changed` fires on the event bus and `body.dataset.presence` tracks `ambient → glance` off real motion/idle signals.
3. Every existing event-driven `switchView` (doorbell, voice, briefing, screensaver-exit) still works.
4. No new leaks: `/kiosk-metrics` clean after 30 min on the Pi; all presence timers have symmetric teardown.

## The state machine

`AMBIENT (0) → GLANCE (1) → DWELL (2) → VOICE (3)`. Phase 1 drives only **0↔1** from real
signals; 2 and 3 are declared and emitted but **dormant** (nothing consumes them yet —
Phase 2/4 make them live). The FSM's shape is complete so later phases are purely additive.

| Mode | Phase 1 source (already exists) | Transition |
|---|---|---|
| `AMBIENT` | `screensaver` active / night / 5-min idle | screensaver `enter()` |
| `GLANCE` | motion (`ha:state-updated` kitchen sensors) or interaction | screensaver `exit()` / `wakeScreensaver()` |
| `DWELL` | 30s continuous presence timer | emitted, unconsumed in P1 |
| `VOICE` | — | dormant until Phase 4 |

Screensaver stays **authoritative for Mode 0** in Phase 1. Presence.js observes it; it
does not rip out screensaver's self-managed idle logic. Keeps the change surgical and
reversible.

## File-by-file changes

**New — `src/js/core/presence.js`**
- Owns `mode` state + `MODES` enum; `getMode()`, `setMode(m, reason)`, `initPresence({ enabled })`.
- Subscribes to `screensaver:changed` (new event), `ha:state-updated` (motion → GLANCE + arm dwell timer), and interaction events.
- Emits `presence:changed { mode, prev, reason }` via `eventBus`; sets `document.body.dataset.presence`.
- One dwell `setTimeout`, cleared on every transition (symmetric teardown; no `transitionend` reliance).
- Debug hook `window.__presence` (read + force a mode), matching `__switchView` / `__forceInsight`.

**New — `src/js/core/contextStore.js`**
- Tiny observable: `get()`, `set(patch)`, `subscribe(fn)`. Minimal scope — Phase 1 holds only `{ presence, lastMotionAt, isNight }`. This is the seam the ~45 pollers migrate into later; do NOT migrate them now (Phase 2+).

**Edit — `src/js/core/viewManager.js`**
- Gate `registerClickCycle()` and `scheduleExploreReturn()` behind the flag: when presence is enabled, skip both. Leave `switchView` fully intact.

**Edit — `src/js/modules/screensaver.js`**
- Emit `screensaver:changed { active: true }` in `enter()`, `{ active: false }` in `exit()`. Lets presence.js observe Mode 0 without polling.

**Edit — `src/js/core/app.js`**
- `initPresence({ enabled: isEnabled("presenceRuntime", false) })` after `initViews()`; pass the same flag into `initViews`.

**Config — `src/js/config.js`**
- Add `features.presenceRuntime: false`. Default off for the first deploy, flipped on the Pi after verification, then defaulted on in a follow-up commit.

## Step sequence (each independently verifiable)

1. Add `contextStore.js` + `presence.js` (flag OFF, unwired) → verify: `npm run build` clean, zero behaviour change.
2. Emit `screensaver:changed` in enter/exit → verify: smoke test sees the event on toggle.
3. Wire presence.js to motion + screensaver; set dataset → verify: motion → `dataset.presence="glance"`; engage → `"ambient"`.
4. Gate click-cycle + explore-return behind flag → verify: flag ON, `document` click does NOT change `dataset.view`.
5. `tests/presence.spec.js` (contract + smoke) → verify: `npm test` green (pre-push gate).
6. Deploy flag OFF → confirm no-op on Pi → flip flag ON → verify: `/kiosk-metrics` clean 30 min; doorbell/voice still switch.

## Testing (pre-push gate)

New `tests/presence.spec.js`, matching the existing Playwright smoke pattern:
- Flag on: dispatch a synthetic `ha:state-updated` kitchen-motion event → assert `body.dataset.presence === "glance"`.
- Flag on: `document.body.click()` → assert `body.dataset.view` unchanged.
- Flag off: click still cycles (guards the reversibility contract).
- `presence:changed` fires with correct `{mode, prev}` on screensaver toggle.

## Pi verification (post-deploy, CDP)

`__engageScreensaver()` → `dataset.presence === "ambient"`; fire kitchen motion → `"glance"`;
confirm `__switchView` debug hook intact; run `/kiosk-metrics` for leak/timer regression;
manually confirm a doorbell event still brings up the cameras view.

## Risks & guardrails

- **Reversibility** — flag off = exact current behaviour; ship off, flip on Pi, then default on. One-line rollback.
- **Don't double-own Mode 0** — screensaver remains the idle authority in P1; presence only observes.
- **Leak discipline** — single dwell timer, cleared on every transition; presence.js registers listeners once at init.
- **Scope creep** — the context store is deliberately tiny here. Resist migrating pollers into it now; that's Phase 2's job.

## Footprint

~2 new files (~120 lines) + 4 small edits + 1 test file + 1 flag. The smallest change
that makes the screen architecturally presence-driven without altering what anyone sees
on the wall.
