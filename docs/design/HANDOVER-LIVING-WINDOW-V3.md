# HANDOVER — bringing the Living Window to V3 (design arc)

Opened 2026-09-11 from the F1 flag census (`docs/audit/F1-FLAG-CENSUS-2026-09-11.md`,
family 3). **Owner's decision: port as a design arc** — competing directions on the
real wall, each behind its own default-off V3 flag, GPU measured, flipped one at a time.
Nothing below is built yet. Facts are cited; everything marked HYPOTHESIS is not probed.

## ▶ Status 2026-09-12 — steps 0 and 1 DONE and live; step 2 BUILT, awaiting the owner

Read this block first; the sections below are the 09-11 handover as written, and four of
its facts were corrected by measuring the wall.

- **Step 0 — the baseline is taken** (`HOST-BASELINES.md`, "the Living Window baseline").
  Depth 0, archive on, plane composition: **19.4-19.8 settled / 27.4 mid-settle**, engine +
  SSE running. Archive off, still air: **0.2**. `V3-MIGRATION.md:537` ticked.
- **Correction to fact 1: at depth 0 the archive covers EVERYTHING**, not only the substrate.
  `.archive` is `inset:0` over an opaque `--surface` (z3) — the full-bleed photograph (z1)
  and its scrim (z2) are under it too. A shader-only effect is invisible at depth 0, full stop.
- **Found on the way: the substrate drew 15 fps under that opaque layer** — ~1.9 gpu / ~7.4
  renderer for nothing. `v3SubstrateCoveredPause` (`9db0d96`) pauses it; **flipped default-on
  `56270a4`**, live, rollback proven in-page.
- **Correction to fact 2's arithmetic: the headroom is ~5 points live, not ~19** (the 5.9
  ambient row predates the archive) — ~7 with the covered pause. The owner has since
  **raised the ceiling for weather episodes** (draft row in `LIVING-WINDOW-VARIANTS.md`, branch).
- **Fact 3 is done: step 1 shipped (`8083ee1`, live)** — V3 writes the store's `weather`
  slice `{category, intensity, thunder, windKph, tempC}` from the WMO code, change-guarded;
  read off the wall matching `/api/weather/now` field for field. Season already existed on
  V3 (`intent.season` via `intentEngine`). The stale `main.js` comment is fixed (it was at
  `:161-167`, not `:149-155` — `6707979` moved it).
- **Fact 6 is resolved by the owner: the monopoly is WIDENED on purpose** — `tokens.css` now
  names the four things atmosphere may move (hue, the mat, the grade, the scrim).
- **Step 2 — three directions BUILT on branch `lw-variants`** (worktree `../pi-lw-variants`),
  each behind its own default-off flag, 12 specs, 11/11 injections red, suite 2050 green,
  and each **served to the real panel** for 16 min by CDP fetch interception (no deploy).
  Evidence + recommendation: `docs/design/LIVING-WINDOW-VARIANTS.md` **on that branch**;
  screenshots locally in `C:\Users\gdee7\projects\lw-variants-shots\` (family photographs —
  never in this public repo). 🛑 **Waiting on the owner's pick.**

## What is missing from the wall

Seven incumbent effects have not been on the wall since the V3 cutover, whatever their
flags say (all seven are marked `INERT-ON-V3` in `src/js/config.js`):

| Flag | The incumbent effect | How it was built |
|---|---|---|
| `weatherFxRain` | droplets + sliders + (heavy) streaks on the glass | rAF canvas episodes, bounded then held static — `src/js/services/atmoFx/runtime.js:217-398`, budgets `planner.js:16-17` |
| `weatherFxLightning` | one strike + 0–2 aftershocks, 40–160 s apart, only while thunder is live | a 1.6 s CSS one-shot on a screen-blend horizon veil — `atmo-fx.css:40-62`, zero rAF |
| `reactiveGlass` | glass tokens recolour with the weather; a strike pulses the sheen | pure CSS on the `atmo-*` token — `background.css:67-113` |
| `skyRamp` | sunrise/sunset warm the room gradually | `--sky-warmth` stepped once a minute, mixed ≤22% — `atmosphere.js:101-114`, `background.css:266-272` |
| `nightSky` | clear-night starfield + a rare 2–4-star twinkle | static 110-star canvas + a planner episode every 180–360 s |
| `atmoTextures` | fog vignette, heat glow, frost corners, season hue; fog drift / heat pulse episodes | body classes on the substrate `::before` + two planner lanes |
| `livingAccent` | `--accent` follows the weather token | `background.css:47-54`, 60 s settle |

V3 today has only two faint relatives: rain *darkens* its substrate (`gl.js:63`, `uRain`)
and the substrate's glow follows sun altitude.

## The six facts that shape the design

1. **At depth 0 the substrate is UNDER the photograph.** Layer order is substrate z0,
   full-bleed photo z1, scrim z2, stage z10 (`src/v3/css/compose.css:42-50`). A
   shader-only effect is mostly invisible — it shows only through gaps such as the
   diptych matting. The incumbent drew its effects on layers ABOVE the photo
   (`#atmo-fx-canvas` z390, `#atmo-fx-veil` z400). **Where the effects live is the
   arc's first design question, not an implementation detail.**
2. **The shader is frozen by its measurement.** `gl.js:16-17`: "THE SHADER BELOW IS
   BYTE-FOR-BYTE WHAT WAS MEASURED. If it changes, the measurement is void." Any
   shader change re-opens the GPU reading (live ambient 5.9% gpu at 15 fps,
   `HOST-BASELINES.md:216-222`).
3. **The inputs are half-wired.** `/api/weather/now` already carries `thunder`,
   `temp_c`, `wind_bearing` and `cloud_pct`. V3 forwards wind, cloud, category and
   intensity to the substrate (`main.js:145-164`), but **not `thunder` or `temp_c`**,
   has no season, and V3's context store has **no `weather` slice** (the incumbent
   planner would read `null`). ⚠ The comment at `main.js:149-155` saying
   `wind_bearing`/`cloud_pct` "DO NOT EXIST" is stale — the server sends both.
4. **The law is the cause test** (`docs/design/DESIGN_SYSTEM.md` §5.1, rewritten for
   the G11): never move for a reason the room can't see. A cause that outlives the
   effect may drive continuous motion; an instantaneous cause is a *moment* —
   lightning must stay a one-shot. §5.2: night amplitude scales on the `--clock-dim`
   curve (see `v3SunClock`, family 4 — the same curve). §5.4 budget: quiescent ≤8%,
   live ≤25%, peak ≤35% and decaying; "motion implemented in JS per frame is the wrong
   implementation" — which puts the incumbent's rain canvas in question.
5. **V3's own budget has never been re-measured** with the attention engine and the SSE
   running (`V3-MIGRATION.md:537`), and the peak row "is not measurable on V3 at all"
   (`HOST-BASELINES.md:268-270`). There is no baseline to add an effect to yet.
6. **V3's tokens forbid part of this as written.** `src/v3/css/tokens.css:24`:
   "`--atmo-hue` is the ONLY thing atmosphere is allowed to move." `reactiveGlass` and
   `livingAccent` move more than that. Either the rule is widened on purpose or those
   two are expressed through `--atmo-hue` alone. (`--sun-warmth` is already written to
   the root every minute and nothing reads it — the sky ramp's natural input.)

## Proposed arc

0. **Baseline.** `/kiosk-metrics` on V3 at depth 0, day and night, engine + SSE running.
   Without it no effect can be judged against §5.4.
1. **Inputs, no pixels.** Forward `thunder` and `temp_c`; give the context store a
   `weather` slice; derive a season. Flag-off byte-identical. Fix the stale comment.
2. **Where it lives — `/variants`, 2–3 directions, screenshotted on the wall:**
   (a) a thin effects layer above the photo, as the incumbent did;
   (b) effects expressed through the scrim and the photograph's own grade;
   (c) substrate-only, visible where the ground leaves gaps.
3. **One effect at a time, cheapest first**, each behind its own `v3…` flag:
   sky ramp + living accent (tokens; inputs already written) → lightning (CSS one-shot)
   → textures (static vignettes) → night sky → rain (hardest: per-frame work vs §5.4).
   Each: inject the defect both ways, deploy flag-off, verify live, `/flag-flip`.

## Open questions for the owner

- Direction (a), (b) or (c) — decided on the wall after step 2, not before.
- Is widening `--atmo-hue`'s monopoly acceptable, or must glass/accent stay fixed on V3?
- Rain: accept a bounded per-frame canvas (the incumbent's shape, measured 22.5% gpu at
  60 fps on the G11 for heavy rain), or find a non-JS form?

Research for this handover: the F1 census session, 2026-09-11. Every file:line above
was cited by that read; re-verify before building on any single one.
