# Host rendering baselines

Tracked on purpose. The measurement skills live in `.claude/`, which is **gitignored** — so
any baseline recorded only in a `SKILL.md` is one machine rebuild away from being lost. This
file is the durable copy; the skills should point at it rather than inline numbers.

`gpucpu.sh` normalises by `nproc`, so **every percentage below is "% of one logical CPU"**.
That figure is directly comparable across hosts as *absolute work*. Any derived "% of the
box" divides by that host's `nproc` — which differs (Pi 4, G11 8), so the two denominators
are not interchangeable. `nproc` counts SMT threads, so on the G11 "% of the box"
understates physical-core pressure in a way it did not on the Pi.

---

## Raspberry Pi 4 Model B (4 GB) — ARCHIVED 2026-07-30/31

The rollback host. Kept because a rollback target's numbers stay operationally relevant.

| | |
|---|---|
| SoC / cores | Broadcom BCM2711, VideoCore VI · `nproc` **4** |
| OS | Raspberry Pi OS, Debian 13 (trixie), X11 + LXDE |
| Chromium | **143**.0.7499.169 |
| Node | v20.20.0 |
| Panel | HDMI-1, 1920x1080@60, 698mm x 392mm, DPR 1 |
| Idle CPU temp | **59–63 °C**, `vcgencmd get_throttled` = `0x0` |

Measured post-`560a32d` (i.e. with the fixed `gpucpu.sh`). Percentages are of **one core**;
`nproc` 4, so divide by 4 for "% of the box".

| State | night 18:55 `night-clear` | day 08:40 `clear-day` | midday 12:30 `cloudy` |
|---|---|---|---|
| ambient gpu / renderer | 1.5 / 2.8 | 7.6 / 7.9 | 8.4 / 7.8 |
| worstcase `rain-heavy` | **54.8 / 40.5** | **53.6 / 39.1** | **53.9 / 37.9** |
| view-cycle (6 real views) | *void* | **44.8 / 23.9** | **41.8 / 27.5** |

**Worst case ≈ 13.4% of the box**, and it is a real ceiling — 54.8 / 53.6 / 53.9 across three
runs and three atmo tokens.

Heap/DOM at 80.6 min uptime: `usedJSHeapMB` 4.9 · `domNodes` 853 · `lottieWrappers` 5 ==
`lottieSvgs` 5 · `cdpNodes` 2257 · `cdpJsEventListeners` 71.

Trace shape at worst case: `SkiaOutputSurfaceImplOnGpu::SwapBuffers` 196.3ms/8,
`NativeViewGLSurfaceEGL:RealSwapBuffers` 175ms/8, `ProxyMain::BeginMainFrame` 68.5ms/9 —
**GPU/raster-bound, main thread idle.** That shape is the thing to compare, not just the
magnitude.

### Three corrections that invalidate older numbers

1. ⚠ **The ambient row is not reproducible and must be compared at `anims=0`.** Measured the
   same photo and same `atmo-cloudy` minutes apart: `anims=2` → **35.0 / 22.3**; `anims=1` →
   **11.3 / 9.2**; `anims=0` → **8.6–9.3 / 8.2–9.3**. A 4× spread, driven entirely by whether
   the 25 s window caught a photo-change **Ken Burns settle** — and with ~30 s rotation
   against a 25 s window, it usually does. Daylight true rest is **~9% of a core**, not the
   7.6/8.4 above. `kiosk-sweep.sh` logs `state(pre)`/`state(post)`; **check `anims` before
   believing any ambient number, on any host.**
2. ⚠ **The pre-2026-07-30 `gpucpu.sh` could only emit 0/40/80/120.** It ran
   `bc "scale=1; dp/dt*NCPU*100"`, and bc truncates the *division* before the multiply, so on
   4 cores anything under ~25% of a core printed as literally **0** and a pinned core printed
   **80.0**. The "binary 80% of a core" model came from that bug. Directions drawn from it
   were real; magnitudes are not citable.
3. ⚠ **"0% GPU at rest" is measurably false in daylight.** Daylight Mode-0 ambient costs ~5×
   night (7.6 vs 1.5 gpu) with `anims:0` in both, so it is not animation. The daylight trace
   shows `SwapBuffers` 680ms/**45** + `RealSwapBuffers` 637.8ms/45 in a 3 s window (~15 fps of
   compositing) where the night trace had no SwapBuffers in the top list at all. DOM was 4150
   nodes vs 3006.

### And one void row

**"Cycling all 6 views" from before `f0eadd4` is VOID — do not cite it.** `RETIRED_VIEWS`
gates `weather`/`cameras`/`briefing` off *passive* navigation while `ambientSubstrate` is on
(it is), so `kiosk-drive.cjs cycle` alternated `weather` (rejected) and `home` (already
current) — a **total no-op**. The 34.8/21.7 it appeared to measure was an awake home view
with the preceding forced `rain-heavy` episode still decaying. Fixed in `f0eadd4`, which
forces all six in `ui.spec`'s order and exits non-zero if one does not land.
`tests/ui.spec.js:61` was **never** affected — it pins `ambientSubstrate` off via a route
intercept, so the CI leak guard always held; only the kiosk-side heap-delta leg was inert.

---

## GMKtec G11 (16 GB) — took the wall 2026-08-01

| | |
|---|---|
| SoC / cores | AMD Ryzen Embedded R2514, Radeon Vega 8 · **4 cores / 8 threads**, `nproc` **8** |
| RAM | 16 GB dual-channel (13 Gi visible; ~2 GB to the iGPU) |
| Storage | 256 GB NVMe |
| OS | Debian 13 (trixie) x86_64, X11 + openbox + lightdm |
| Chromium | **151**.0.7922.71 |
| Node | v20.19.2 · Mesa 25.0.7-2+deb13u1 · kernel 6.12.100+deb13-amd64 |
| Panel | HDMI-A-0, 1920x1080@60, 698mm x 392mm, DPR 1 |
| Idle CPU temp | **33–34 °C** (`k10temp`) |

### Software-bound metrics — the "code-neutral" tripwire

Architecture, GPU **and** browser major all changed at once, so these are the numbers that
say whether anything structural moved. Measured 2026-08-01 at 4.1 min uptime, `home` view:

| Metric | Pi 4 (Ch 143) | G11 (Ch 151) | |
|---|---|---|---|
| `usedJSHeapMB` | 4.9 | **4.2** | within noise |
| `domNodes` | 853 | **926** | within noise |
| `lottieWrappers` | 5 == 5 svgs | **5 == 5 svgs** | no zombies |
| `cdpNodes` | 2257 | **2315** | within noise |
| `cdpJsEventListeners` | 71 | **67** | within noise |

**Eight Chromium majors moved nothing structural.** That is what licenses attributing any
GPU/renderer movement below to the hardware rather than to the browser.

### Rendering cost — measured 2026-08-01 15:54 AEST

`kiosk-sweep.sh`, 26 s shared windows, `atmo-rain`, temp 52.3 °C, `/proc/pressure/cpu`
`avg10=0.00`, load 1.47. **% of one core** (÷8 for "% of the box").

| State | gpu-process | renderer | Pi 4 equivalent | absolute-work ratio |
|---|---|---|---|---|
| ambient, `anims:0` | **3.1** | **2.1** | ~9 / ~8–9 (daylight true rest) | **~2.9× less** |
| worstcase `rain-heavy`, `anims:4` | **22.5** | **15.7** | 54.8 / 40.5 | **2.4× / 2.6× less** |
| view-cycle (6 forced) | **18.9** | **12.6** | ~43 / ~25.7 | **~2.3× / 2× less** |

**Worst case ≈ 2.8% of the box**, against the Pi's 13.7% — **4.9× less of the machine**, of
which ~2.4× is real speed and the rest is the denominator doubling (4 → 8 threads).

Software-bound metrics post-sweep (uptime 12.6 min): `usedJSHeapMB` 4.7 · `domNodes` 958 ·
`lottieWrappers` 5 == `lottieSvgs` 5 · `cdpNodes` 2368 · `cdpJsEventListeners` 73 — all
within noise of the Pi's 4.9 / 853 / 5 / 2257 / 71. **No leak, no zombie lotties, nothing
structural moved.**

### ⚠ The trace shape CHANGED — the CPU numbers badly understate the improvement

The plan anticipated "GPU% down with an unchanged shape = same work, faster raster". That is
**not** what happened. In a 3 s `gpu-trace.cjs` window at worst case:

| | Pi 4 | G11 |
|---|---|---|
| `SwapBuffers` | 196.3 ms / **n=8** | 2319.7 ms / **n=179** |
| `ProxyMain::BeginMainFrame` | 68.5 ms / **n=9** | 319.7 ms / **n=180** |
| effective frame rate | **≈ 2.7 fps** | **≈ 60 fps** |

**The Pi was rendering `rain-heavy` at about 3 fps** — the heaviest atmoFx effect was
frame-starved on the old host, so "moments not loops" was visibly stuttering rather than
smooth. The G11 delivers the same effect at a full 60 fps **while using 2.4× less CPU**.

So the honest statement is: the G11 does roughly **20× the frames for 0.4× the cost**. Any
"2.4× faster" summary is a large understatement, and the two hosts' worst-case rows are not
measuring equal work.

**The idle-freeze invariant still holds**: ambient shows `BeginMainFrame` **n=7 in 3 s**
(~2.3 fps), nowhere near a 60 fps pin, with `anims:0` in both `state(pre)` and `state(post)`.
`scriptPct` is 0.2 ambient / 2.5 worst case (Pi: 6.2) — still GPU/raster-bound, not script-bound.

⚠ **`clock=3486MHz/2100MHz` is not a throttle signal on this part.** `cpuinfo_max_freq`
reports the R2514's *base* clock, which boost legitimately exceeds — so the ratio reads >100%
and means nothing. Use `/proc/pressure/cpu` `avg10` (0.00 here) as the throttle substitute.

### The motion budget derived from these numbers

`DESIGN_SYSTEM.md` §5.4 is the authority; this is where its numbers come from. The design law
changed on the strength of the table above — **"0% GPU at rest" was repealed 2026-08-01** and
replaced by *"never move for a reason the room can't see"* plus a measured ceiling.

| State | Ceiling (gpu-process, % of one core) | Measured | Headroom |
|---|---|---|---|
| Quiescent ambient — no legal cause active | **≤ 8** | 3.1 | ~2.5× |
| Live ambient — a continuous cause running (rain, wind, sun) | **≤ 25** sustained | **5.9** (V3, 2026-08-14) | ~4.2× |
| Peak episode — a moment, must decay | **≤ 35** | 22.5 | ~1.5× |
| **V3 archive — depth 0** (v3Archive default-on) | **≤ 25** sustained (live ambient) | **27.4** ⚠ OVER (2026-08-20, 0 h) | **none — −2.4** |

Plus: never pin a core (`/proc/pressure/cpu` `avg10` ≈ 0), `scriptPct` under ~5% (0.2 quiescent /
2.5 peak — stay GPU/raster-bound), sustained `tempC` under 70 °C (idle 33–34, peak 52.3).

⚠ **The `anims` caveat changes shape but does not go away.** Under the old law, ambient readings
had to be taken at `anims:0` because a Ken Burns settle inflated them 4× (correction 1 above).
Now that continuous motion can be *legitimate*, `anims:0` no longer means "resting" — it means
"quiescent", which is only the first row. **Record `anims`, the view and the `atmo-*` token with
every reading**, and match the row to the state, or the numbers are not comparable to anything.

⚠⚠ **`anims` cannot see V3's substrate, so it no longer separates the first two rows.**
`document.getAnimations().length` counts Web Animations; the substrate is a **rAF loop on a
canvas** and is invisible to it. The 2026-08-14 reading below is `anims:0` with an empty
`atmo-*` token and was still a *live ambient* sample, because `__substrate().animating` was
`true` at 15 fps throughout. **On V3 the discriminator is `__substrate()` — `animating` and
`paused` — not `anims`.** A reading recorded the old way will file a live-ambient sample
under the quiescent row and appear to blow a ceiling it never touched.

✅ **You no longer have to remember this.** As of 2026-08-15 the sweep's `state(pre)`/
`state(post)` lines carry `substrate.animating`, `substrate.paused` and the frame counter on
V3, and `perf-metrics.cjs` reports **`substrateFps`** — a real frame delta across the same
window it already brackets. `anims` is still printed, and only so that a row records that it
was uninformative here. **Read `substrateFps`; `anims: 0` on V3 means nothing at all.**

#### Live ambient, measured 2026-08-14 20:33 (V3, G11)

The row above was closed on a genuinely windy night rather than a forced one — the substrate
was animating on a real cause, which is the state the row was written for.

| pid | role | % of one core |
|---|---|---|
| 31620 | gpu-process | **5.9** |
| 108855 | renderer (the wall) | 5.3 |
| 181903 | renderer (idle background page) | 0.0 |

State, recorded per the rule above: `animating: true`, `paused: false`, **459 frames in
30.6 s = 15.0 fps sustained**, `anims: 0`, `atmo` token empty, panel lit (`data-panel-dark:
"0"`), `tempC` 49.25, `/proc/pressure/cpu` `avg10=0.00`. Both pids sampled over **one shared
30 s window**. `v3EnergySaver` was on (CDP-injected, pre-deploy).

✅ **REPAIRED 2026-08-15 — the instrument is surface-aware, and it now refuses rather than
guesses.** The block below is kept as written because it is the *diagnosis*, and the
consequences it lists are what the repair had to answer one by one. What changed:

- **`scripts/kiosk/surface.cjs` is the new contract.** It declares, per surface, the seams the
  instrument drives. `kiosk-eval.cjs --detect` checks them against the live page and **exits
  non-zero when one is missing**, and `kiosk-sweep.sh` aborts before its first sample rather
  than logging three ambients. A sweep can no longer report a number it did not take.
- **`tests/kiosk-instrument.spec.js` makes the contract durable.** It asserts every declared
  seam exists on the real V3 page, and proves the refusal fires by *removing* one. This is the
  test that would have caught the cutover: both disarmings so far were silent because a
  missing hook is `undefined`, and `undefined` is not an error until something calls it.
  (⚠ It runs against `dist/` — `node server.js` serves the build — so a source change without
  `npm run build` tests the old bundle. The neuter was only real after a rebuild.)
- **fps is measured, not inferred.** `perf-metrics.cjs` now brackets `__substrate().frames`
  across its own window and reports `substrateFps`. That is the number the 15.0 above was
  taken by hand; it is automatic now, in the same file that reports the `animations` count
  which cannot see it.
- **The peak row is redefined rather than abandoned** — see the peak bullet below.
- **`heap-metrics.cjs` has a V3 liveness verdict** (`judgeGround`) — see the archive bullet.

⚠⚠ **The measurement apparatus was dark on V3 — the diagnosis, 2026-08-14.**
Probed live: `__wakeScreensaver`, `__engageScreensaver`, `__forceAtmoEpisode`,
`__switchView`, `__archive` and `__atmosphere` were **all `undefined`** on the wall. They are
incumbent hooks in `modules/screensaver.js` and friends, and `/` has served V3 since the
cutover. Consequences, none of which announce themselves:

- **`kiosk-sweep.sh` — the tool `/kiosk-metrics` says to prefer — cannot produce a worst
  case or a view cycle here.** Its wake, its `rain-heavy` re-fire and its cycle are all
  no-ops, so it would log **ambient three times** and label the second one a peak. This is
  the *same disarmed-tripwire shape* as the 2026-07-30 `kiosk-drive.cjs cycle` bug recorded
  in that script's own header — caused again, by the cutover.
  ✅ **Answered by the seam check above, plus a V3 cycle.** V3 has no views; it has nine
  subjects, each with its own `teardown()`, and `showSubject()` tears the previous one down
  before building the next — so cycling them is the same churn the view cycle was. ⚠ The leak
  signature is **different** and the old one measures nothing: V3 renders zero lotties, so
  wrappers-vs-svgs is meaningless. What the V3 cycle checks instead is a node surviving its own
  teardown, an **MJPEG `<img>` left with a `src`** (showCamera's own comment calls that "not a
  leak, a fire" — the connection stays open and decodes forever), and nodes/listeners
  ratcheting. ⚠ A subject returning `false` is **legitimate** (nothing to show), so it is
  reported and never fatal — but a subject that *never* mounts is an unexercised dispatch row,
  which is precisely the shape of the `show.status` defect. That list is F2's input.
- **The peak-episode row (≤ 35) is not measurable on V3 at all**: there is no atmoFx module
  under `src/v3/`, so `rain-heavy` does not exist on the current wall. The 22.5 in the table
  is an *incumbent* number retained for history. V3's continuous motion is the substrate.
  ✅ **Answered by redefining the peak, not by forcing an effect.** V3's peak is now the
  heaviest state it can *actually* be in — the live MJPEG camera subject at depth 3 over the
  animating substrate and the photographic ground — held for the whole window by
  `kiosk-drive.cjs peak`, which re-asserts depth on a 5 s beat because depth 3 recedes after
  `HOLD_MS` and an expired peak under-reports itself. ⚠⚠ **It REFUSES on a dark panel** and
  tells the reader to discard the row: with `v3EnergySaver` on, a night "peak" measures a
  *paused* substrate and would come in **below** daytime ambient. The old script only warned
  about that in a comment. ⚠ **The peak row does not continue across the cutover — 22.5 and
  the V3 number are different measurements. Do not diff them.**
- **The heap/DOM baselines below describe the incumbent page.** V3 on 2026-08-14 measured
  `domNodes` **42**, `cdpNodes` **268**, `cdpJsEventListeners` **29**, `lottieWrappers` **0**
  — against an incumbent "healthy" band of 926 / 2,315 / 67 / 5. A V3 leak would have to grow
  roughly **20×** before it crossed the old numbers, so those rows are not a gate any more.
- **`heap-metrics.cjs`'s `live` block is permanently not-assessable** (`"the archive probe is
  absent"`), because it reads `window.__archive()`. It refuses to judge rather than passing
  falsely, which is the right design — but nothing is watching Live Photo motion on the wall.
  ⛔ **CORRECTION, 2026-08-15: this is not a flag being off — the ambient archive does not
  exist in V3 at all.** One grep across `src/v3/` returns a single CSS comment. So the wording
  named two causes and the true one was neither, and **there is no Live Photo motion on the
  wall to watch.** ⚠ That also means **F4 in `docs/BACKLOG.md` is not a flag flip**:
  `archiveMotionLoop` has no V3 half to turn on.
  ✅ **Answered with the right question for this surface.** `judgeGround()` judges the thing
  V3 actually does: **the ground IS the screen**, held all day. It faults on a blank wall while
  the server offers assets, on a photograph loaded but never revealed, on a `dayKey` that did
  not turn over at midnight (which finally makes `awakePhotoDissolve`'s old unprovable question
  a one-sample check), and on a cross-fade left at two layers with nothing in flight. It stays
  not-assessable on a dark panel and when Immich itself has nothing to offer — because "I could
  not look" must never read as "I looked and it was fine". Covered in
  `tests/soak-liveness.spec.js`, including the guard that a **diptych is not a leak**.

#### The first repaired sweep — 2026-08-15 06:44 AEST (V3, G11, daylight)

`kiosk-sweep.sh` at `0d2bf07`, one shared window per row, temp 49.3 °C, `avg10=0.00`,
load 0.64, clock 2767 MHz. Panel lit, `monitor: on`, WebGL2 backend, page uptime 572 min.
**Every row below was taken by an instrument that verified its own seams first** — the
detector cleared `{"surface":"v3","missing":[],"absent":[]}` before the first sample.

| row | gpu-process | renderer | `substrateFps` | ceiling | headroom |
|---|---|---|---|---|---|
| **ambient** (lit, substrate animating) | **5.7** | **6.8** | **15.0** | ≤ 25 live | ~3.7× |
| **peak** — camera live, depth 3, held 34 s | **7.2** | **9.0** | **15.1** | ≤ 35 peak | ~4.9× |
| cycle — 10 subjects mounted in sequence | 6.0 | 6.4 | 15.1 | — | — |

🔑 **V3's peak is barely above its ambient — +1.5 gpu / +2.2 renderer.** The substrate is the
cost, and it is already paid at rest; the live MJPEG and a mounted subject add very little on
top. That is a different shape from the incumbent, whose peak was 7× its ambient (22.5 vs 3.1)
because a forced atmoFx episode was a genuinely additional effect. **It also means the ≤ 35
peak ceiling is no longer the binding constraint on this surface** — the ambient row is, and
`v3EnergySaver` already takes it to 0.0 for eight hours a night.

⚠ The ambient `state(pre)`/`state(post)` both read `layers: 2` — which is the SETTLE STUCK
signature and was **not** a fault: a cross-fade was legitimately in flight across the whole
window (06:44 is inside the sunrise rotation). `inFlight` is now carried in the state line for
exactly this reason. Note also `anims: 1` here and `anims: 0` in the peak row — the *reverse*
of the truth, since the peak was the busier state. Read `substrateFps`.

**The cycle is symmetric — measured, not reasoned.** 9/10 subjects mounted, `#subject-mount`
empty afterwards, **0 `<img>` left on a `/live` endpoint**, `domNodes` 42 → 42. Then a *second*
full cycle from a settled page: `cdpJsEventListeners` **153 → 153**, `cdpNodes` **333 → 333**,
`domNodes` **42 → 42**. Nothing ratchets.

⚠ **Open, and not attributable to the sweep: listeners read 153, against the 29 recorded on
2026-08-14.** Those are different page loads — this page booted ~21:15 on 08-14, after the
`v3EnergySaver` deploy reload, and the 29 was taken at 20:33 on the load before it. The second
cycle proves the *subjects* add none of it. Two points on two different loads is not a slope
([[project-listener-climb]]'s lesson), so this needs a fresh-page reading before it means
anything. **Do not file it as a leak, and do not file 29 as the V3 baseline either.**

⛔ **`show.media` declined — it mounted nothing.** Legitimate on its face (nothing was playing
at 06:44), but it is the one subject in the dispatch table with **0% coverage** and it is
F2's first suspect. The cycle now says so on every run instead of leaving the row unexercised.

**Liveness: `assessable: true, faults: []`** — the first time anything has been assessable on
this wall since the cutover. Ground `6a1c0d56…`, `dayKey` "Sat Aug 15 2026" (today), 1 layer,
shown, against a server pool of **102** on-this-day assets.

⚠ **The idle-freeze invariant is retired as a pass/fail.** Ambient `BeginMainFrame` n=7 in 3 s
(~2.3 fps) was the tripwire; a legal continuous effect may now run ambient at 60 fps. The
quiescent row replaces it — that is where an accidental decorative loop still shows up.

**The Pi 4 row is no longer a gate.** `pi4-rollback` stays code-current and may render new motion
at a degraded frame rate; that was accepted on 2026-08-01. Its numbers stay here because a
rollback target's numbers stay operationally relevant, not because new work must fit them.

### Thermal substitute

There is no AMD equivalent of `vcgencmd get_throttled`. `kiosk-sweep.sh` substitutes current
clock vs `cpuinfo_max_freq` plus `/proc/pressure/cpu`. Read `tempC` from
`/api/system/metrics`, which autodetects the sensor on both hosts.

⚠ **`/sys/class/thermal/` does not exist on the G11.** The hwmon autodetect in
`server/routes/system.js` is load-bearing here, not a nicety — without it `tempC` is `null`
and the System tile blanks.

⚠ **Ryzen `Tctl` swings ~10 °C instantly** under trivial load — a `curl` plus a `node`
process is enough. Two readings taken seconds apart look exactly like a mis-latched sensor.
Sample the API and the hwmon file in the same command or you will "find" a bug that is not
there.

---

## Live ambient — the Ambient Archive (G11) · **soak RUNNING from t0 = 2026-08-02 20:38 AEST**

The `DESIGN_SYSTEM.md` §5.4 **live ambient** row (≤ 25% of one core, sustained) was
declared when the calm law was rewritten and then left **unmeasured**, because nothing
had claimed it yet. `features.ambientArchive` is the first surface that does: Mode 0 now
animates continuously, so this is the state the screen genuinely sits in for hours.

**The 0 h numbers below are valid** — taken on a settled page, 12.5 min uptime, two
agreeing 60 s windows. **The 72 h clock, however, had not started when they were taken**,
and this is the part that matters operationally:

> ⚠ **ANY deploy that changes the bundle ends the soak.** The kiosk reloads onto the new
> hash, `uptimeMin` resets and the heap starts from zero. On 2026-08-02 the first attempt
> died at 16 minutes because a *different, unrelated* change (`8281f3c`, a weather fix)
> shipped from another session and the panel reloaded onto it.
>
> **A 72 h soak therefore needs 72 h of no bundle deploys.** That is a scheduling
> commitment, not a technical one, and it is the reason this row stayed unmeasured for as
> long as it did.

**Self-check before trusting any 24 h / 72 h reading:** read `uptimeMin` first. If it is
less than the hours elapsed since t0, the page reloaded and you are measuring a fresh
process, not a soak. `heap-metrics.cjs` prints it on every sample — there is no excuse for
recording a number without it.

### Starting it: the bedtime ritual, and why the time of day changes the protocol

Start **after the last deploy of the day**, in this order — the whole thing is about two
minutes:

1. `ssh pi-dashboard 'sudo systemctl start dashboard-deploy.service'` — settle the bundle.
2. `node scripts/kiosk/kiosk-drive.cjs reload` — it now self-checks the stylesheet against
   `dist/assets` and exits `STALE:` if the reload did not take, so this step cannot lie.
3. Wait ≥ 10 min (see the reload-warmup trap above), then record **t0 + the software
   counters** — `heap-metrics.cjs`, plus `uptimeMin`.

⚠ **Do NOT try to take a GPU number at t0 if it is after 21:00.** The panel is DPMS-off
21:00 → 05:00, so compositing is suspended and the reading is meaningless — near-zero, and
not comparable to anything. Split the deliverable:

| Half of "heap-flat + fps constant" | When to sample |
|---|---|
| **heap / DOM / listeners** | any time, panel on or off — this is the half that actually needs 72 unbroken hours |
| **gpu / renderer / anims** | daylight only, panel on, Mode 0 engaged |

A bedtime t0 has one real advantage over the 09:10 pilot: **24 h and 72 h then fall at the
same clock time as t0**, so the light, the atmosphere token and the DPMS state all match by
construction, and the readings are comparable without argument.

⚠ And note what a 72 h soak actually covers: the panel is dark 8 hours in every 24, so the
archive only animates ~16 h/day. 72 h of wall time is ~48 h of motion. That is still a fair
test of the heap, but do not describe it as 72 h of continuous rendering.

> **STATUS: the 72 h soak RESTARTED. t0 = 2026-08-05 18:27 AEST**, on bundle
> `index-BYa2_WGu.js` / `index-sTy7gxIn.css` (repo at `6c2d9e3`), confirmed by
> `uptimeMin: 1.3` immediately after the kiosk reload. Sample windows fall at
> **24 h = 2026-08-06 18:27** and **72 h = 2026-08-08 18:27**, the same clock time as t0 by
> design. **No bundle deploy may land before then** — docs and script-only pushes are safe
> (proven twice on the previous run: the kiosk rebuilt to identical hashes).
>
> ⚠ **Write the next t0 down HERE the moment you set it.** The run this replaces was never
> recorded, and its t0 had to be reconstructed after the fact from `uptimeMin` — which works,
> but only because nobody reloaded the page in the meantime.
>
> ⚠ **This t0 is after sunset, so it carries no GPU number** (same limitation as the
> 2026-08-02 one) — and it is also *after* the evening sky ramp closed at 17:47, which makes
> it a cleaner heap baseline than one taken inside a ramp. **Still owed: a daylight GPU
> reading taken BETWEEN the two ramps (~07:30–16:19)** — see the sky-ramp section below for
> why every previous reading landed inside one.
>
> **t0 counters, recorded at `uptimeMin` 11.8** (past the ≥10 min warm-up rule), panel On,
> `view: home`, night gate engaged: heap **7.5 MB** · domNodes **1441** · cdpNodes **3308** ·
> listeners **53** · lottie **5/5** · `anims` **4** · tempC **44.25** · liveness
> `assessable: false` ("after sunset — the night gate refuses bursts by design"), which is
> the correct reading for the hour, not a fault.
>
> ⚠⚠ **READ THIS BEFORE COMPARING THE 24 h SAMPLE: Home Assistant was DOWN when this t0 was
> taken.** Port 8123 on the NAS was black-holing the SYN (the host answered ping in 1–3 ms
> throughout). So every HA-driven surface — camera tiles, media panels, presence — never
> constructed, and this baseline is **artificially low**: 1441 domNodes / 3308 cdpNodes /
> 53 listeners against the previous run's t0 of 1945 / 4161 / 70 at a comparable 12.2 min.
> **When HA comes back, those counters will jump for an entirely innocent reason.** Do not
> read that as a leak — it is the same "one-off construction, not a climb" shape already
> documented for listeners. If the 24 h sample is up on all three, check whether HA is
> reachable *before* concluding anything.
>
> **Previous run (ended by choice):** t0 was 2026-08-02 20:38 on `index-D_gktw1m.js`; its
> 24 h sample was taken 2026-08-05 16:59 at `uptimeMin 1431.9` — heap **9.8 MB**, domNodes
> **1683**, cdpNodes **3789**, listeners **97**, lottie **5/5**, `bursts: 836`, faults none.
> Heap, domNodes and cdpNodes all finished *below* their t0 values (10.2 / 1945 / 4161), so
> the health half came back clean: nothing leaks, and the cost on this surface is
> compositing, not memory.
>
> The two readings in the first table are the earlier **pilot** — real measurements, and
> what caught the budget breach — but they belong to a process that no longer exists.

| Metric | pilot 0 h | pilot +3.3 h | 24 h | 72 h | Judgement |
|---|---|---|---|---|---|
| gpu-process (% of one core) | **20.8 / 21.0** | **21.7 / 21.1** | | | §5.4 ceiling **25** sustained |
| renderer | **10.1 / 10.2** | **9.9 / 9.8** | | | |
| `anims` (running, settled) | **4** | **4** | | | echo + ghost + pivot + Ken Burns |
| `usedJSHeapMB` | **10.8** | **12.0** | | | must be **flat**; >30 sustained is suspicious |
| `domNodes` (attached) | **1937** | **2195** | | | must be flat |
| `cdpNodes` | **3971** | **4402** | | | wobble ok; **monotonic climb = leak** |
| `cdpJsEventListeners` | **70** | **77** | | | must be flat |
| `lottieWrappers` / `lottieSvgs` | **0 / 0** | **5 / 5** | | | wrappers ≫ svgs = the zombie bug is back |
| tempC | **44.9** | **44.9** | | | sustained < 70 |
| `/proc/pressure/cpu` avg10 | **0.00** | **0.00** | | | never pin a core |

**+3.3 h read (uptime 199 min, `atmo-clear-day`, panel on, Mode 0):**

- **The rendering cost is flat and in budget.** 21.7 / 21.1 against 20.8 / 21.0 is inside
  window-to-window noise, `anims` still 4, temp identical. The `17da62e` fix holds, and
  the ≤ 25 ceiling has ~4 points of margin.
- **The software counters moved once and need a third point.** heap +1.2 MB, `domNodes`
  +258, `cdpNodes` +431, listeners +7. Most of that is explained rather than alarming:
  `lottieWrappers` went 0 → 5 **with `lottieSvgs` also 0 → 5**, i.e. the panel woke on
  motion at some point in those three hours and built the awake surface for the first
  time since the reload. Wrappers == svgs is the healthy shape; wrappers ≫ svgs is the
  709-zombie disease.
- ⚠ **One delta is not a trend.** If +431 `cdpNodes`/3.3 h were linear it would reach
  ~13 k by 72 h — nowhere near the 230 k disease state, but not flat either. The 24 h
  sample is what separates *"settled after the first wake"* from *"climbing"*: expect it
  to be roughly level with +3.3 h if the former, and ~+3 k if the latter.

`scriptPct` **0.4** · `layoutPct` 0.1 · `stylePct` 0.7 — compositor-bound, not
script-bound, exactly as §5.4 predicts. Conditions: `atmo-clear-day`, daylight, panel on.

### The soak proper — t0 recorded 2026-08-02 20:38 AEST

Ritual as written above: deploy settled (`a8200cb`, docs-only, **hashes unchanged**) →
`kiosk-drive.cjs reload` (self-check passed, loaded stylesheet == disk) → 12.2 min warm-up
→ sample. Conditions at t0: panel **On** (DPMS-off is 21:00, ~20 min out), `view: home`,
uptime **12.2 min**.

| Metric | **t0** (20:38) | 24 h (03/08 20:38) | 72 h (05/08 20:38) | Judgement |
|---|---|---|---|---|
| `usedJSHeapMB` | **10.2** | | | must be **flat**; >30 sustained is suspicious |
| `domNodes` (attached) | **1945** | | | must be flat |
| `cdpNodes` | **4161** | | | wobble ok; **monotonic climb = leak** |
| `cdpJsEventListeners` | **70** | | | must be flat |
| `lottieWrappers` / `lottieSvgs` | **5 / 5** | | | wrappers ≫ svgs = the zombie bug is back |
| tempC | **45.25** | | | sustained < 70 |
| `/proc/pressure/cpu` avg10 | **0.00** | | | never pin a core |
| gpu-process / renderer | *deferred* | *daylight* | *daylight* | §5.4 ceiling **25** sustained |

**Why the GPU row is empty and must stay empty here:** a bedtime t0 cannot produce a
comparable compositing number, so the rendering half is sampled separately in daylight
against the pilot's 20.8 / 21.0 — see the split table above. This is the documented
protocol, not a gap.

### The liveness half — added 2026-08-03, because the soak watched the wrong thing

Every row above answers *is the page healthy*. None of them answers *is the page working*,
and the difference cost a day: on 2026-08-03 Live Photo motion was dead for sixteen hours —
the day's clips were published a few seconds after the pool had stopped asking for them —
while heap, DOM, listeners and lotties all stayed perfectly flat. A human eye caught it.
The soak did not, because the soak was not looking.

`heap-metrics.cjs` now also reads the surface's own probe (`window.__archive()`) and
cross-checks it against what the server says is playable (`/api/immich/daily-set`). That
pairing is the point: the failure was precisely a disagreement between the two — ten clips
on disk, none of them reachable by the page.

| Field | Meaning |
|---|---|
| `live.assessable` / `live.why` | whether a verdict was possible at all, and why not |
| `live.faults[]` | named faults; **empty is only meaningful when `assessable` is true** |
| `live.bursts` | monotonic — **the diff across samples is the assertion** |
| `live.photo` | current memory; differing between samples proves the rotation still turns |
| `live.clips` | `{ total, withClip, pending }` straight from the server |

⚠ **Expect `assessable: false` on both soak samples.** They are taken at 20:38, after
sunset, where the night gate refuses bursts by design — "no motion" is then *correct*, and
a check that returned OK there would be worse than no check. Take the motion reading in
daylight, exactly as the GPU half already has to be. `--gate` makes a fault exit non-zero;
not-assessable never does, deliberately.

⚠ **`bursts` is the field to diff, not to read.** A single sample can land in a legitimately
quiet moment. A 24 h row whose `bursts` equals t0's says nothing played all day.

The verdict function is unit-tested against synthetic states in `tests/soak-liveness.spec.js`
— including the 2026-08-03 case itself. That is not ceremony: it is only ever assessable in
daylight Mode 0, so waiting for the real conditions to discover whether it fires is exactly
how `kiosk-drive.cjs cycle` stayed a silent no-op for weeks while printing success.

⚠ **This t0 is not directly comparable to the pilot's 0 h column, and that is deliberate.**
The pilot reloaded onto a *cold* surface and read `lottieWrappers 0 / 0`; three hours later
the panel had woken once and it read 5 / 5, +258 `domNodes` and +431 `cdpNodes` — growth
that was first-wake construction, not a leak. This reload happened with the panel already
awake, so **t0 already includes the woken surface** (5 / 5 at 12 min). That is why 4161
sits between the pilot's 3971 and 4402. The practical effect is the one worth having: the
one-off first-wake step is *inside* the baseline, so any climb at 24 h / 72 h has nothing
innocent to hide behind.

### Live Photo motion — the burst, measured 2026-08-02 (`features.ambientArchiveMotion`)

A memory carrying an Apple Live Photo plays its ~3.5 s motion part as it arrives, then
settles into the still. Measured on the panel at `8fa8c95`, daylight, panel on, Mode 0,
14 min uptime, with **today's set at 12/12 memories carrying a motion part** — i.e. every
exchange bursts, the worst realistic case rather than a typical one.

| State | gpu-process | renderer | vs baseline |
|---|---|---|---|
| Live ambient, archive only (recorded baseline) | 20.8 / 21.0 | 10.1 / 10.2 | — |
| **Live ambient + motion, natural rotation** | **21.7 / 21.8** | **12.1 / 12.0** | gpu ~0, **renderer +2** |

**The gpu-process figure does not move.** 21.7 / 21.8 sits inside the window-to-window
noise of the existing baseline (which itself read 21.7 / 21.1 at +3.3 h), so the §5.4
≤ 25 ceiling keeps its ~3 points of margin. The cost lands on the **renderer**, at ~+2.

That is the expected shape, and the arithmetic is worth keeping: a 1080p H.264 control
clip costs **+41 points of renderer** on this box, because ⚠ **decode here is in
SOFTWARE — permanently, and not for want of a flag** (see the section below; the
earlier "no flags on the command line" explanation was investigated and disproven).
A 1040-long-edge clip is ~39% of those pixels (~16 points), and a 3.5 s burst in a 30 s
rotation is a ~12% duty cycle: 16 × 0.12 ≈ 2. ✔

⚠ **§5.4's ceilings are all stated for gpu-process, so video cost does not register
against them at all.** That is a gap in the budget, not a free pass — hence the renderer
column above.

### VA-API hardware decode — INVESTIGATED AND CLOSED 2026-08-02. It cannot be had here.

The premise that this box decodes in software only because `dashboard-kiosk.service`
lacks decode flags was **wrong**. Every flag was tested on a throwaway Chromium on the
same display; **the unit file was never edited and needs no edit.** Findings, in order:

1. **The hardware and driver stack are perfect.** `ffmpeg -hwaccel vaapi
   -hwaccel_output_format vaapi` decodes `clear.mp4` at **192 frames, 0 errors**,
   `pix_fmt: vaapi`, via libva 1.22 → `radeonsi_drv_video.so`. Nothing is missing.
2. **`VaapiVideoDecoder` is already default-on in Chromium 151** and *is* constructed for
   every clip. Adding `--enable-features=VaapiVideoDecoder` is a no-op. So is
   `AcceleratedVideoDecodeLinuxGL`, `…ZeroCopyGL`, `UseOutOfProcessVideoDecoding`,
   `--ignore-gpu-blocklist`, `--use-angle=gles`, `--use-gl=egl`, `--use-angle=vulkan`.
   All nine measured **41.7–43.7 renderer points — i.e. software, every time.**
3. **The real failure, in Chromium's own log** (`--vmodule=*vaapi*=3`):

   ```
   vaapi_video_decoder.cc:136        VaapiVideoDecoder():        <- constructed
   video_decoder_pipeline.cc:1270    PickDecoderOutputFormat(): Initializing ImageProcessor
   vaapi_video_decoder.cc:144        ~VaapiVideoDecoder():       <- destroyed → software
   ```

   It dies at **output-format negotiation**, not at driver init.
4. **Why:** `displayType = ANGLE_OPENGL` (ANGLE over GLX) and the GPU process advertises
   **no dma-buf / EGL-image extensions at all**. Decoded VA surfaces cannot be imported
   into the compositor, so the pipeline has nowhere to put a hardware frame. This is a
   property of **X11 + ANGLE-on-GL**, not of the flags, the GPU, or Mesa.

**The only real fix is a Wayland session** (no compositor is installed; the box is
X11 + openbox + lightdm on `XDG_SESSION_TYPE=tty`). That is a whole-display-stack change
to save ~2 renderer points at the Live Photo duty cycle. ⚠ **Not worth it — do not
re-open this without a much larger video feature to justify it.**

⚠ **`powerEfficient` is NOT a valid signal on this box** — it reports the GPU process's
VA-API *enumeration*, not the decoder actually used. It read `true` while the renderer
still paid the full +41.8. **Only a CPU measurement settles this.**

**And the obvious follow-on — VA-API *encode* for the Live Photo transcoder — was
benchmarked and rejected.** `ffmpeg` here does have `h264_vaapi`, and
`server/services/liveMotion.js:155` encodes with `libx264` in software. Measured against a
lossless reference of the same filter chain:

| encode | bytes | SSIM | user CPU |
|---|---|---|---|
| `libx264 -crf 26` (current) | 191,563 | **0.9767** | 3.89 s |
| `h264_vaapi -qp 32` | 227,703 | 0.9746 | 2.61 s |
| `h264_vaapi -qp 34` | 180,074 | 0.9725 | 2.61 s |

The fixed-function encoder is **strictly worse on rate-distortion** than x264 `veryfast`:
quality-matched it wants ~qp30 and **+50% bytes**. It buys 1.3 s of one core per clip —
**~5 s per night at `nice -n 19`, off the render path, panel DPMS-off** — and spends it in
bytes that this panel then decodes **in software**, out of a byte-bounded 48 MB cache.
Wrong trade. `liveMotion.js` is unchanged.

⚠ **Full-hardware transcode is BROKEN here and must never ship.** With
`-hwaccel vaapi -hwaccel_output_format vaapi` + `scale_vaapi`, autorotation silently does
not happen **and the display matrix leaks into the output**: a rotated portrait source
came out **1848×1040 landscape with `rotation=90` still attached**, which the browser would
then rotate again. This is precisely what the `liveMotion.js:143-147` comment protects.

**One real defect found, separate from decode.** The kiosk starts ~5 s after lightdm
(`After=network-online.target` only), and when it wins that race **libva never loads into
the GPU process for the life of the browser** — `powerEfficient` then reads `false` and
`videoDecoding` lists 0 profiles. A plain `systemctl restart dashboard-kiosk.service`
fixes it. It changes **no** decode cost (measured +40.7 before, +41.8 after) and is
therefore cosmetic — it matters only because it corrupts capability probes. Anyone
probing codec support on a long-uptime kiosk should restart it first, or measure CPU.

**Peak, and why the raw number misleads.** Driving an exchange every 5 s for 60 s (~6× the
natural rate — the re-fire technique `/kiosk-metrics` prescribes for atmoFx):

| 6× exchange rate | gpu-process | renderer |
|---|---|---|
| control, no motion | 31.1 | 23.1 |
| with motion | **34.7** | **32.0** |
| **motion's marginal cost** | **+3.6** | **+8.9** |

34.7 against the ≤ 35 peak ceiling looks like almost no margin, and taken alone it would
be alarming. The control says otherwise: **31.1 of it is the archive's own exchange
machinery** — two card images crossfading, two 2900×1800 echo planes swapping, a card
blur and a Ken Burns restart, thirteen times in a minute. Motion contributes about a
tenth of the reading. Scaled to the natural rate (1/6) that is ~+0.6 gpu, which is exactly
what the sustained row measured.

**Take the control whenever a rate is forced.** A re-fire test measures the thing being
re-fired as much as the feature under test, and without the control this would have been
recorded as "motion nearly breaches the peak ceiling" when motion is ~10% of it.

Health at the same sample: `anims` **4** before and after (6 only mid-exchange, i.e. the
in-flight transitions — nothing looping), `bursts` 23 → 27 across two minutes = **exactly
one per 30 s exchange**, `lastQuality` 56 frames **0 dropped / 0 corrupted**, heap 11.3 MB,
`domNodes` 2151, `cdpNodes` 4491, listeners 71, tempC 54.4, `/proc/pressure/cpu` avg10
**0.00**.

### ⚠ The sky ramp — a third way to get it wrong, and it invalidated a whole reading

**Discovered 2026-08-05 while investigating an apparent §5.4 breach. Confirmed cause,
~5.6 gpu points, NOT yet fixed.**

`syncNight()` runs on `NIGHT_CHECK_MS = 60 * 1000` and writes `--sky-warmth` to **three
decimal places** from the sun altitude. `background.css:246` transitions
`background-color` over `var(--atmo-settle, 60s)` on `body.substrate::before` — a **full
1920×1080** pseudo-element. So every minute the value moves, a fresh 60 s full-viewport
paint animation starts *before the previous one has finished*. Duty cycle **100%** for the
whole ramp.

**A 60 s transition restarted every 60 s is not a transition, it is a permanent
animation.** The code comment defends it as having "zero loops", which is true literally
and false in effect — and is why it survived review. It is also a *paint* property, so the
CSS guardrail (which forbids transitioning **layout** properties, §5.5) never applied.

ABA reversal on the live kiosk, injecting `body.substrate::before{transition:none!important}`:

| window | gpu-process | `anims` | `background-color` in `getAnimations()` |
|---|---|---|---|
| A1 shipped | 39.5 | 5 | yes |
| **B killed** | **32.9** | **4** | **no** |
| A2 shipped | 37.4 | 5 | yes |

The entry disappearing from `getAnimations()` is what makes this causal rather than
correlational, and `anims` returning to **4** matches the healthy figure recorded above.

⚠ **It only runs in two narrow windows.** `skyWarmthFor` saturates to 0 above +12° and
below −6° altitude, so on 2026-08-05 in Brisbane the value moved only during
**06:02–07:30 and 16:19–17:47** — 176 min/day, 12.2% of the day, **18.3% of awake time**.
Recompute per season; these move.

⚠ **This is what invalidated the first breach report.** The 20.8/21.0 pilot was taken at
**09:10** (outside any ramp); the 33 that looked like a regression was taken at **16:45**
(inside one). They were never comparable. **State which side of the ramp every GPU reading
was taken on** — the windows are narrow and easy to land in by accident, precisely because
"take it in daylight with the panel on" points straight at the evening one.

**Residual, still unexplained:** even with the ramp cost removed, 32.9 against the pilot's
21.0. Untested suspects are `archiveFitToPrint`'s resizing plane and the motion bursts —
and note the burst's "inside noise" figure below is untrustworthy, because it was measured
while bursts were silently 0 all day (pre-`ce551ac`). **The measurement that settles it is a
daylight reading between the ramps, ~07:30–16:19, which has never been taken.**

**Ruled out by measurement, not reasoning** — do not re-check these: the recipe panel's
scroll rAF (hiding it via `window.__recipePanelHide()` did not lower cost — it kept
climbing 38.7 → 40.0 → 41.5), and every blend-mode layer (`#aurora-sky`, `.aurora-blobs`
with `screen` + `blur(45px)`, `#atmo-fx-veil`) — all three are `display: none` in Mode 0.

⚠ **Find ALL renderer pids.** `pgrep chromium` yields two here; one is idle and reads
**0.0**, which looks like "the renderer is free" and is simply the wrong process.

### How this row was measured, and two ways to get it wrong

- **60 s windows, not 25–30 s.** The archive's animations are `ease-in-out alternate` at
  84–130 s. A 30 s sample lands in a *phase* — fast mid-cycle or nearly stationary at a
  turning point — and the same state read **28.5 and 37.5** minutes apart. Two consecutive
  60 s windows agreeing to 0.2 (20.8 / 21.0) is what "settled" looks like.
- **Never sample within ~10 min of a reload.** At 1.5 min uptime the same state read
  **41.3** — image decodes, the Immich pool fetch and a fresh Ken Burns all landing at
  once. At 12.5 min it read 20.8.
- ⚠ **The panel is DPMS-off 21:00 → 05:00** (`crontab`: `xset dpms force off`). The page
  keeps running but compositing does not, so an overnight reading is not comparable to a
  daytime one. Take the 24 h / 72 h readings in daylight with the panel on.
- ⚠ **`domNodes` 1937 is the archive-era figure**, not comparable to the 926 in the G11
  migration table above — that was awake `home` at 4.1 min uptime, a different surface.
  What the soak asserts is that 1937 stays 1937.

### The first reading breached the budget — what it cost, and what fixed it

The very first 0 h sample was **37.5**, i.e. above the ceiling and worse than the old
*worst-case peak episode* (`rain-heavy`, 22.5). Attributed by show/hide A/B on the live
panel, then fixed in `17da62e`. Every one of the three was the same mistake — **a
full-frame effect sitting over something that animates**:

| Defect | Cost |
|---|---|
| Both echo slots animating; the hidden one drifts a 2900×1800 filtered layer at `opacity: 0` | 3.1 |
| `.archive__grain` `mix-blend-mode: overlay` — a static texture forcing the whole stack beneath to re-blend every frame | 4.3 (with the vignette) |
| `.archive__grade` `mix-blend-mode: multiply` over the card image, which is zooming at 60 fps | 3.0 |

`29.1 → 24.0 → 21.0` over 60 s windows. 24.0 against a 25 ceiling was taken as *no
margin* for a state that runs for hours, which is why the third one shipped too.

**The lesson generalises past this surface:** a blend mode is free on a still surface and
expensive on a moving one, and the archive is the first resting surface this dashboard has
that moves. Any future `mix-blend-mode` on the ambient view should be measured, not assumed.

## Voice compute moved onto the kiosk host — measured 2026-08-16

Kokoro TTS and faster-whisper STT were installed on the G11 to survive the PC sleeping
overnight. **The two legs gave opposite answers**, which is the finding worth keeping:
the CPU verdict for one inference library does not transfer to the other.

### Latency — the deciding numbers

| leg | this box | the PC | the NAS |
|---|---|---|---|
| TTS, short first sentence (~3 s audio) | **3.2 s** | ~1.0-1.75 s | ~18 s |
| TTS, full reply chunk (~6 s audio) | **5.9 s** | — | — |
| STT, 2.67 s utterance | **1.19-1.30 s** | 1.27 s (2.2 s clip) | no AVX, rejected |

**TTS runs at RTF ≈ 1.0 here at every chunk size** — memory-bandwidth bound, not thread
bound. That is why it is the *fallback* and not the primary: with streaming, a reply is
synthesised no faster than it is spoken, so the queue never builds a lead and any hiccup
is an audible gap. The PC runs ≈ 0.3 and always stays ahead.

**STT is a wash with the PC** (CTranslate2 int8 is CPU-optimised in a way kokoro-onnx is
not), so it is a straight switch, not a chain.

⚠ **Thread count is measured, not guessed** — TTS: 2 threads 8.7 s · 4 threads 5.9 s ·
8 threads 6.0 s. Four buys the full speed for half the footprint. **Confining inference
to one core's SMT pair (`AllowedCPUs=6-7`) is what made the 2-thread run slow, and it
bought no render headroom because there was none to buy.**

⚠ **Two measurements were contaminated by the probe text before this table was right.**
`date +%s%N` inside a test phrase puts 19 digits in the sentence and Kokoro *speaks every
one* — it read as a 23 s synthesis and a 20 s end-to-end failover. Always check
`size_download` against the wall time: 24 kHz/16-bit mono is 48,000 bytes per second of
audio, so the WAV tells you how much speech you actually asked for.

### Render budget — both legs, under sustained load

Baseline first, then a pathological back-to-back loop (far worse than any real burst):

| state | gpu-process | renderer | substrateFps | pressure avg10 | tempC |
|---|---|---|---|---|---|
| ambient baseline | 5.9 | 6.7 | 15 | 0.00 | 38.6 |
| sustained TTS synthesis | 6.0 | 7.0 | 15 | 4.24 | 46.5 |
| sustained STT transcription | 5.1 | 5.3 | 15 | 0.01 | 46.4 |

**The wall did not notice either one.** `substrateFrames` was identical (451) across the
TTS burst window. Ceilings are ≤ 8 quiescent / ≤ 25 live / ≤ 35 peak, so this sits inside
even the *quiescent* row while inferring. Bounded by `Nice=10` + `CPUWeight=20` +
`OMP_NUM_THREADS=4` (`deploy/voice-tts.service`, `deploy/voice-stt.service`).

The `some avg10` of 4.24 under continuous synthesis is the one non-zero reading and is
recorded rather than rounded away — it is stall pressure on the *box*, not on the
renderer, whose own CPU held flat. Real bursts are a single 3-6 s chunk.

### End to end

| scenario | before | after |
|---|---|---|
| PC awake (unchanged) | ~1.0 s | 1.03 s measured |
| PC asleep, uncached line | ~24-41 s (6 s dead timeout + NAS) | **8.6 s** (6 s timeout + local) |

⚠ **The 6 s primary timeout is now ~70 % of the sleeping-PC wait** (`tts.js:240`). It was
sized when the alternative was an 18 s NAS and that ratio no longer holds. Not changed
here — a real PC request measured 3.0 s once under load, so 3 s would be too tight — but
it is now the largest remaining term and worth revisiting deliberately.

⚠ A sleeping PC **black-holes the SYN**, it does not refuse it, so the full timeout is
paid. Simulate with a TEST-NET address (`192.0.2.1`), never a dead local port — a refused
connection returns instantly and makes the failover look free.

#### ⚠⚠ V3 archive — depth 0: the owed reading came back OVER BUDGET (2026-08-20, 0 h)

`v3Archive` went default-on in `aab9acc`, which moves V3's depth 0 out of the quiescent row and
into **live ambient** (≤ 25% sustained, DESIGN_SYSTEM.md §5.4). §5.4 predicted it "should cost
less by construction" and said plainly that *"should" is not a measurement*. It is not:

```
gpu-process 1161   27.4 %   (30 s window, settled)   → ceiling 25 %, OVER by 2.4
renderer    1306   24.0 %
/proc/pressure/cpu  some avg10=0.00  full avg10=0.00  → no core pinned
state: depth 0 · anims 5 · panelDark 0 · daylight, 07:0x AEST
```

⚠ **Not a warm-up artifact.** Two independent 30 s windows minutes apart read 27.7 and 27.4 —
stable, not decaying. A single post-reload sample would have been fair to distrust; these are not.

⚠ **`anims: 5`, not the four loops §5.4 describes** (card, two drifting ghosts, engraved year).
Worth resolving before tuning — if the fifth loop is unaccounted for, it is the first place to
look for the 2.4 points.

The invariants that still hold: pressure ≈ 0 (never pins a core), and the rollback is a genuine
return to the ≤ 8% quiescent row — `v3Archive: false`, one line, verified reversible at flip time.

⏳ **Still owed: the 24 h and 72 h rows.** A surface that sits on the wall for hours is exactly
the one whose reading must not be taken once.
