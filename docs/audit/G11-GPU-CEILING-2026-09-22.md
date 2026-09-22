# G11 GPU ceiling — what the box actually charges for a continuous WebGL field

Measured 2026-09-22, 11:32–11:44 AEST, on the live wall. Stage 0 of the Living Window 2.0 arc
(`~/.claude/plans/pasted-content-id-3ed2-turn-v3-humble-gem.md`). **No code shipped from this
run.** The probe injected its own canvas over CDP, measured, removed itself, and the wall was
verified back as found.

Every percentage is **% of one logical CPU**, as `gpucpu.sh` reports it and as
`HOST-BASELINES.md` defines it. `nproc` is 8, so "% of the box" divides by eight.

## Method

`/home/dashboard/field-ceiling.cjs` — a full-panel `<canvas>` at `z-index: 2147483000` running
the **byte-identical** fragment shader from `src/v3/substrate/gl.js`, at a chosen backing store
and frame cap, forced continuously moving (`uWind = (0.8, 0.3)`, so the drift term advances).
CPU is the `/proc` delta method lifted from `lw-step3.cjs`: largest-RSS renderer plus the
gpu-process, over a 60 s window, × `nproc`.

Conditions: depth 0, `v3Archive` on, panel awake, page uptime 3.1 days, daylight, outside both
sky-ramp windows. `/proc/pressure/cpu` `avg10` was **0.00 on every single window**.

🔑 **The probe reports its own monotonic frame count**, and every row below states the fps it
actually delivered against the cap it asked for. A run under 60 % of its cap is void. This is
the counter whose absence blinded three earlier probes in this repo; none of these rows are
blind.

## The readings

| window | gpu-process | renderer | fps asked → got |
|---|---|---|---|
| control-1 | 23.9 | 20.3 | — |
| probe 480×270 @15 *(what ships today)* | 21.4 | 15.0 | 15 → **12** |
| control-2 | 19.9 | 14.0 | — |
| probe 1920×1080 @60 | **32.7** | 22.5 | 60 → **59.9** |
| control-3 | 30.6 | 25.7 | — |
| probe 1920×1080 @15 | 21.8 | 15.2 | 15 → **12** |
| probe 960×540 @60 | 27.6 | 18.8 | 60 → **60.0** |
| control-4 | 20.1 | 14.1 | — |
| `.photo` hidden under the opaque archive | 20.4 | 13.9 | — |
| control-5 | 19.8 | 13.7 | — |

⚠ **The controls disagree by 10.8 points (19.8 → 30.6), and that is the archive, not noise in
the instrument.** Three controls cluster tightly at **19.8 / 19.9 / 20.1** — that is the settled
wall. Two (23.9, 30.6) landed inside a Ken Burns settle. `arch-kenburns` is 96 s per photograph
against a 60 s window, so a window either contains a settle or does not, and there is no window
length that reliably avoids one. **Marginal costs below are taken against the settled cluster
mean, 19.93**, and any probe row could itself contain a settle — so these are upper bounds.

## Finding 1 — frame rate is the expensive axis. Resolution is nearly free.

| configuration | Mpx/s | marginal gpu |
|---|---|---|
| 480×270 @12 | 1.6 | **+1.5** |
| 1920×1080 @12 | 24.9 | **+1.9** |
| 960×540 @60 | 31.1 | **+7.7** |
| 1920×1080 @60 | 124.4 | **+12.8** |

Read rows 2 and 3 together: **near-identical pixel throughput (24.9 vs 31.1 Mpx/s), four times
the cost.** The sweep was designed so those two rows would separate per-pixel cost from
per-frame cost, and they do. The dominant term is the per-frame compositor cost of a
full-screen layer, not fragment shading — Vega 8 barely notices the shader.

The consequence is exact and it inverts the assumption written into `gl.js`:

> **Going from 480×270 to full 1920×1080 at the shipped 15 fps cap costs +0.4 gpu points.**

`gl.js:3-8` argues the 480×270 backing store is "the entire performance argument" because it is
6 % of the pixels. On this hardware that trade bought **0.4 points** and spent the field's entire
spatial detail. It was a correct trade on a Pi and is the wrong one here.

⚠ The 15 fps cap delivers **12 fps**, not 15: `FRAME_MS = 66` against a 60 Hz vsync skips to
every 5th frame as often as every 4th. If 15 is wanted, the cap is 64 ms, not 66.

## Finding 2 — the shader, not the resolution, is what limits how good this looks

Screenshots of the same scene at 480×270 and 1920×1080 are **nearly indistinguishable to the
eye**. The full-res frame has finer dither grain and slightly more structure near the sun glow;
it is not a different picture. PNG size tripled (344 KB → 1.1 MB), and that is almost entirely
the dither being at native pixel scale.

The reason is in the shader: `fbm(uv * 3.0 + …)` is a very low-frequency field, and the whole
program is a two-colour `mix`, one gaussian sun glow, two lerps for cloud and rain, and a
vignette. **There is almost no high-frequency content to lose**, which is exactly why 480×270
looked acceptable.

**So raising the backing store is not the quality win — it is the enabler for one.** Take it,
because it costs 0.4 points, but the visual work is fragment-program authoring: cloud with
form and layering, a real horizon, rain with depth, stars with position. Resolution only starts
paying once there is detail worth resolving.

## Finding 3 — ❌ HYPOTHESIS DISPROVED: the covered photograph is not costing anything

The plan predicted free money here. At depth 0 the full-bleed ground `<img>` (two of them, a
diptych, at the time of the reading) sits at `z-index: 1` under an opaque `.archive` at
`z-index: 3`, and the plan reasoned this was the same waste `v3SubstrateCoveredPause` already
fixed.

**It is not.** Hiding `.photo` read **20.4** between controls of **20.1** and **19.8** — inside
the noise, and if anything fractionally higher.

Why the analogy failed: the substrate was *animating* under the archive at 15 fps, so it was
paying a per-frame cost forever. A photograph is a **static** layer — composited once and then
fully occluded, it costs nothing per frame. Occlusion culling is not the same problem as an
animation nobody can see.

**Consequence for Stage 1: there is no saving to spend.** Uncovering the field must be paid out
of real headroom, which — per Finding 1 — it comfortably can be.

## Finding 4 — thermals and pressure are nowhere near a limit

`/proc/pressure/cpu` `avg10 = 0.00` on all ten windows, including 1920×1080 @60. `tempC` read
**48.4 °C** immediately after the run, against a 70 °C ceiling and a 33–34 °C idle baseline.

⚠ Honest gap: the probe did **not** sample `tempC` inside each window, only after the run. A
sustained-thermal claim needs a soak, not this sweep. Ryzen `Tctl` also swings ~10 °C instantly,
so 48.4 is one sample, not a trend.

## Proposed §5.4 — for the owner's sign-off

The surprise is that **the existing table already accommodates the whole ambition**, because the
resting state stays at a low frame cap and resolution is free there. What needs changing is not
the sustained ceiling but the things the table does not say.

| State | Ceiling | Measured today | Change |
|---|---|---|---|
| Quiescent ambient | ≤ 8 % | — | unchanged |
| Live ambient (sustained) | **≤ 25 %** | 19.9 settled · 20.3 projected at full-res 15 fps | **unchanged — no raise needed** |
| Peak episode (must decay) | **≤ 35 %** | 32.7 at 1920×1080 @60 | unchanged, but see below |

Three amendments, all of which are additions rather than relaxations:

1. **State the axis that actually costs.** The budget is written in pixels-per-second thinking
   and the hardware charges per frame. A row should read *"frame rate is the expensive axis;
   a full-panel layer costs ≈0.13–0.21 gpu points per fps, largely independent of resolution."*
2. **≤ 35 peak is now genuinely reachable** — 32.7 measured, where the previous peak entry was
   22.5. A 60 fps full-panel episode has ~2 points of margin, so peak episodes must be capped
   deliberately rather than assumed cheap.
3. **Add a renderer-column ceiling.** `HOST-BASELINES.md:605` already calls its absence "a gap
   in the budget, not a free pass". Renderer tracked gpu closely all run (13.7 settled → 22.5 at
   the extreme). Proposed: **≤ 25 % sustained**, the same number, since nothing here separates
   them.

**What this does not license.** Law 1 is untouched: none of the above is a reason to move for a
cause the room cannot name, and §5.1 remains the test. A field that can afford 60 fps must still
earn every frame it draws.

## Reproducing this

```bash
scp field-ceiling.cjs pi-dashboard:/home/dashboard/     # rm the target first — scp writes THROUGH a hardlink
ssh pi-dashboard 'node /home/dashboard/field-ceiling.cjs state'   # read-only, changes nothing
ssh pi-dashboard 'cd /home/dashboard && nohup node field-ceiling.cjs > field-ceiling.log 2>&1 &'
# progress: /home/dashboard/field-ceiling.status · results: /home/dashboard/field-ceiling/results.json
# stop early: kill $(cat /home/dashboard/field-ceiling.pid)   — never by matching a command line
```

The probe restores itself on SIGTERM, on an exception, and via an in-page watchdog that removes
the canvas if this process dies. Verified after this run: `probeGone: true`, `photoVis:
"visible"`, and the substrate's frame counter unchanged at 746562 across the whole sweep —
it stayed paused throughout and the probe never touched it.

Related: `DESIGN_SYSTEM.md` §5.4 · `HOST-BASELINES.md` (the Living Window baseline, step 3) ·
`src/v3/substrate/gl.js` · `src/js/config.js` `v3SubstrateCoveredPause`
