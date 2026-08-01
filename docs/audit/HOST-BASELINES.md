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
