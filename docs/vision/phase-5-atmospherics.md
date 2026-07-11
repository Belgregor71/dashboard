# Phase 5 — "Make it feel alive": Ambient Atmospherics

_Plan drafted 2026-07-11. Part of the [Home OS vision](./home-os-vision.md) roadmap. Builds on [Phase 3](./phase-3-anticipate.md) (predictive candidates, shipped & enabled), [Phase 2](./phase-2-attention-engine.md) (attention engine) and [Phase 1](./phase-1-presence-runtime.md) (presence FSM)._

## Why Phase 4 is skipped

Phase 4 ("Give it a voice", Mode 3) is **hardware-blocked — no mic on the Pi**, so it's deferred, not cut. It slots back in later at zero cost to Phase 5: the attention engine already reserves the seam — `selectForMode` returns `{ hero: null }` for `MODE.VOICE` ("floor handed to voice, Phase 4"), and nothing in Phase 5 touches Mode 3. When a mic arrives, Phase 4 drops onto the existing FSM + engine untouched.

## Key insight that de-risks this phase

**Mode 0 is already ~80% built, and the design constraint and the hardware constraint point the same way.**

- The ambient machinery exists: `screensaver.js` (Ken Burns photo pans via `ss-kb-*`), the night clock (SunCalc, `__isNight`), weather-tinted light (`tint-morning/day/evening` + `weather-fx.css`), and the GPU-freeze discipline (`freezeLotties()` + CSS pause under `.screensaver-active`). Phase 5 **coheres and budgets** what's there — it doesn't invent a new surface.
- The GPU idle-freeze finding says _any_ continuous animation re-composites the whole page at 60fps ≈ 1 core (`project-gpu-idle-freeze`). The vision independently says **avoid** "gamified ambient effects — fireflies/particles that pull the eye are the opposite of calm." **These agree.** "Feel alive" here means **slow state changes that settle** (a 60-second tint shift, a discrete photo cross-fade) — which are near-zero steady-state cost _and_ calmer — never continuous motion. The constraint is the aesthetic.

The through-line: _Phase 5 makes Mode 0 breathe with the weather and the light — using transitions that settle to rest, so the room's screen feels alive while the Pi's GPU stays asleep._

## Decision (resolved during planning): the CSS-tree kill stays IN Phase 5 — not a separate phase

The roadmap bundles "retire the dual CSS tree" into Phase 5. I checked whether that's a risky live migration deserving its own phase. **It isn't.**

- The built app (`dist/index.html`, from `src/index.html`) links **only** the bundled split-tree CSS (`/assets/index-*.css`). Zero references to legacy `styles.css`; `weather-fx-overlay` survives only as a **class name** already migrated into `src/css/utils/weather-fx.css`.
- `static/css/styles.css` (3,979 lines), `static/css/weather-fx-overlay.css`, and `static/index.html` are **dead in production** — served only by the `server.js` `/` fallback _when `dist/index.html` is missing_, which never happens on the Pi (it `npm run build`s every deploy). The CSS migration itself already landed in **Stage 2 (Vite + CSS split)**.

So the "kill" is a **verified dead-file deletion**, not a migration: the only code change is one `server.js` fallback line. Splitting a safe `rm` of orphaned files into its own phase would be ceremony without risk reduction. **Verdict: it rides in Phase 5 as one bounded, independently-verifiable cleanup step** (grep-clean + built app byte-identical + `/` still 200). If deletion ever felt risky mid-phase, it's trivially deferrable behind the same commit boundary — but the evidence says it won't.

## Goal & success criteria

Give Mode 0 a cohesive, weather- and time-driven atmosphere at the edge of perception, all behind `features.ambientAtmospherics` (default off → reversible, the Phase 1/2/3 pattern), and remove the dead legacy CSS/HTML tree.

Done when:
1. Flag **on**: in Mode 0 the ambient layer (light tint + photo cadence + the occasional earned memory) shifts with real weather and time of day and reads as _alive but calm_; flag **off**: byte-identical to today's Mode 0.
2. **GPU stays asleep** — averaged CPU of the Chromium `gpu-process` in a truly-idle Mode 0 stays at the idle baseline (~0%, `project-gpu-idle-freeze`), proven with `gpucpu.sh` over 25–30s (never `top -bn1`) and a `gpu-trace.cjs` that shows `BeginMainFrame` **not** pinned at 60fps. This is the gate, not reasoning.
3. The dead legacy tree (`static/css/styles.css`, `static/css/weather-fx-overlay.css`, `static/index.html`) is removed, the built app is byte-identical, and `/` still serves 200.
4. No continuous/particle motion is introduced (calm-tech "avoid" list); atmosphere is expressed as **settling transitions**, not loops.

## What ships (grounded in what exists)

| Element | Source today | Phase 5 change |
|---|---|---|
| **Weather-tinted light** | `tint-*` classes + `weather-fx.css` | Drive the tint from real condition + `isNight` via a pure mapper; slow settle (≈60s), zero steady-state cost | Ship |
| **Earned-memory cadence** | `on-this-day` candidate (Phase 3) | Surface it tastefully in Mode 0's near-silent frame, on a long cadence — the "occasional earned memory" | Ship |
| **Photo cadence / dim clock** | `ss-kb-*` Ken Burns, night clock | Keep; ensure discrete cross-fades settle (no perpetual pan) under the GPU budget | Tune |
| **Dead CSS/legacy index** | `static/css/*`, `static/index.html` | Delete; update the `server.js` fallback | Ship |
| Full dissolution of rich views (weather/cameras/briefing) | `viewManager` + view modules | **Defer** — they hold real content not yet candidate-representable; nav is already gone (Phase 1), so they're already unreachable by users. Retiring them is follow-on, not this phase. |

**Design rule (baked in):** every atmosphere state is a class/token that transitions to a **resting** value. The pure mapper must never emit a class whose CSS is an infinite animation — that's the testable guardrail against the idle-freeze.

## File-by-file changes

**New — `src/js/services/atmosphere.js`**
- Pure mapping `{ condition, isNight, hour } → atmosphereToken` (e.g. `atmo-clear-day`, `atmo-rain`, `atmo-night`), same discipline as `predictiveRules.js`: no DOM/IO, node-unit-tested. Exports the token set so a test can assert none maps to a looping-animation class.

**Edit — `src/js/core/contextStore.js`**
- Grow the slice (as designed — "migrate per phase") with `condition` (weather code/label) so atmosphere reads from the one store instead of re-fetching. Fed from the existing weather refresh.

**Edit — `src/js/modules/screensaver.js`**
- On Mode 0 enter and on `contextStore` change, apply the atmosphere token to the ambient root; keep the `freezeLotties()` + CSS-pause discipline; drive the earned-memory cadence. All under the flag; flag-off path untouched.

**Edit — `src/css/utils/weather-fx.css` / `layout/background.css` / `utils/time-context.css`**
- Add the `atmo-*` tint/gradient states with slow **settling** transitions (transition, not `@keyframes` loops). Reuse existing tint tokens.

**Delete — `static/css/styles.css`, `static/css/weather-fx-overlay.css`, `static/index.html`** + **Edit `server.js`**
- Drop the dead files; replace the `/` fallback `existsSync(distIndex) ? distIndex : staticIndex` with the built index unconditionally (a missing `dist` is a build failure to surface, not to paper over with the retired legacy app).

**Config — `src/js/config.js`**
- Add `features.ambientAtmospherics: false`. Default off; flip on the Pi after live verification; then default on.

**Debug** — `window.__atmosphere(token)` to force an atmosphere state over CDP (convention: `__isNight` / `__nowcastProbe`), so each state can be visually checked on the kiosk without waiting for the weather.

## Step sequence (each independently verifiable)

1. `atmosphere.js` pure mapper + `contextStore` `condition` slice → verify: unit tests (correct token per condition/night/hour; **no token maps to a looping animation**).
2. Wire atmosphere into Mode 0 behind the flag → verify: flag-off byte-identical; flag-on, `__atmosphere(...)` drives the tint on the kiosk and **`gpucpu.sh` in idle Mode 0 stays ≈ baseline**.
3. Delete the dead CSS/legacy index + update the `server.js` fallback → verify: `npm run build` byte-identical bundle; `/` returns 200 with the built index; grep shows no remaining references (+ contract test for `/`).
4. Deploy flag OFF (no-op) → flip ON on Pi → visual + `/kiosk-metrics` GPU pass (idle ≈ 0%, `BeginMainFrame` not pinned) → default on (Phase 1/2/3 rollout).

## Testing

- **Pure (`insights.spec.js` style):** the atmosphere mapper returns the right token across conditions/night/hour and — the phase-critical assertion — **never emits a looping-animation class** (the idle-freeze guardrail as a unit test).
- **Contract (`api.spec.js`):** `GET /` returns 200 and the built document after the legacy `static/index.html` removal.
- **GPU / kiosk (the real gate):** `gpucpu.sh <gpu-pid> 25` in a truly-idle Mode 0 must stay at the idle baseline; `gpu-trace.cjs 3` must **not** show ~60 `BeginMainFrame`/3s. Single-shot samples are useless here — averaged only.
- **Visual on the Pi:** each `__atmosphere` state renders as a calm, settled tint; the earned memory appears on its long cadence and recedes.

## Rollout & risk

- **The one real risk is the GPU budget.** An atmosphere that loops instead of settling would re-pin the core (`project-gpu-idle-freeze`). Mitigated three ways: the design rule (settle, don't loop), the unit-test guardrail (no looping-animation token), and the averaged `gpucpu.sh` gate before default-on.
- **Reversibility** — `ambientAtmospherics: false` = today's Mode 0. One-line rollback.
- **CSS deletion is safe** — dead in production (verified: built app references only the split bundle), reversible via git, and behaviour-neutral (the running app already never loads those files).
- **Memory discipline** — atmosphere is class/token swaps on existing nodes: no new per-event UI surface, symmetric with Mode 0 enter/exit, nothing new to teardown. Re-check `/kiosk-metrics` after deploy regardless.
- **Scope guard** — **no particle/firefly motion** (calm-tech "avoid"). **Full dissolution of the rich content views (weather/cameras/briefing) is deferred** — they carry real data not yet expressible as candidates, and they're already user-unreachable since Phase 1 killed nav; retiring their code is follow-on cleanup, not this phase. Phase 5 polishes Mode 0 and deletes the **dead** legacy surface — it does not rewrite the awake views.

## Footprint

1 new pure atmosphere mapper + a small `contextStore`/`screensaver`/CSS wiring + a flag + deletion of ~4,000 lines of dead legacy CSS/HTML (+1 server fallback line) + tests. No new heavy UI — the atmosphere rides the tint/photo layer Mode 0 already renders, and "alive" is bought with slow settling transitions the Pi can afford.
