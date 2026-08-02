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
| Live ambient — a continuous cause running (rain, wind, sun) | **≤ 25** sustained | *new state, unmeasured* | — |
| Peak episode — a moment, must decay | **≤ 35** | 22.5 | ~1.5× |

Plus: never pin a core (`/proc/pressure/cpu` `avg10` ≈ 0), `scriptPct` under ~5% (0.2 quiescent /
2.5 peak — stay GPU/raster-bound), sustained `tempC` under 70 °C (idle 33–34, peak 52.3).

⚠ **The `anims` caveat changes shape but does not go away.** Under the old law, ambient readings
had to be taken at `anims:0` because a Ken Burns settle inflated them 4× (correction 1 above).
Now that continuous motion can be *legitimate*, `anims:0` no longer means "resting" — it means
"quiescent", which is only the first row. **Record `anims`, the view and the `atmo-*` token with
every reading**, and match the row to the state, or the numbers are not comparable to anything.

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

## Live ambient — the Ambient Archive (G11), soak 0 h · 2026-08-02 08:54 AEST

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

> **STATUS: the 72 h soak has NOT started.** The two readings below are a **pilot** taken
> on 2026-08-02 — real measurements, and they are what caught the budget breach — but the
> clock is not running. 2026-08-02 was a heavy deploy day and a soak across it would have
> been reset repeatedly for nothing. **Owner's call: start it at bedtime**, after the last
> deploy of the day. Until someone writes a t0 in here, treat the 24 h / 72 h columns as
> unstarted rather than pending.

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
