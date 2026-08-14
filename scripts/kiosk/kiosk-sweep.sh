#!/bin/bash
# One-command rendering-cost sweep for the live kiosk. Run ON the kiosk host —
# CDP is bound to 127.0.0.1:9222, so this cannot be driven remotely.
#
#   bash scripts/kiosk/kiosk-sweep.sh
#
# Appends one block per run to $KIOSK_SWEEP_LOG (default ~/kiosk-sweep.log).
# This is the measurement the /kiosk-metrics skill describes by hand; prefer
# this, because it samples every pid over ONE shared window and restores the
# panel afterwards, which the manual steps are easy to get wrong.
#
# Three samples, deliberately different:
#   AMBIENT   — observes whatever the panel is naturally doing. Does NOT wake it,
#               does NOT force anything. The honest steady-state number.
#   PEAK      — the heaviest state the surface can actually be in, held for the
#               whole window. On the incumbent that is a re-fired rain-heavy
#               atmoFx episode; on V3 it is the live MJPEG camera subject at
#               depth 3 (there is no atmoFx in V3 — see below).
#   CYCLE     — forces through every view (incumbent) or every subject (V3).
#
# ── 2026-08-15: SURFACE AWARENESS, and why this script needed it ─────────────
# Since the V3 cutover, `/` serves a page with none of the hooks below. Probed
# live on the wall: __wakeScreensaver, __engageScreensaver, __forceAtmoEpisode,
# __switchView, __archive and __atmosphere were ALL undefined. This script went
# on sampling regardless — so its wake was a no-op, its rain-heavy re-fire was a
# no-op, and its view cycle was a no-op. **It would log ambient three times and
# label the second one a peak.**
#
# That is the second time a probe here has been silently disarmed (see the
# 2026-07-30 note in kiosk-drive.cjs's own header). Both times the cause was the
# same: nothing checked that the seam existed before driving it. So the first
# thing this script now does is ask the page which surface it is and whether the
# seams are present, and it REFUSES to sample if they are not — because a number
# nobody can trust is worse than no number, once it is sitting in the log next to
# the real ones.
#
# ⚠ The peak row is NOT continuous across the cutover. `rain-heavy` does not
# exist on V3, so the 22.5% on record is an incumbent number and the V3 peak
# starts a new row. Do not diff them.
#
# Promoted into the repo 2026-07-31 (it previously lived only at
# /home/dashboard/kiosk-sweep.sh, so it was undocumented, unversioned, and lost
# on any host move). Made portable in the same pass — the notes marked [PORT]
# below are what had to change for the x86 mini PC.
set -u

# [PORT] Was hardcoded to /home/dashboard/dashboard. Derive from this script's
# own location so the repo can live anywhere and any host can run it.
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$SCRIPT_DIR/../.." && pwd)
CPU="$SCRIPT_DIR/gpucpu.sh"
LOG="${KIOSK_SWEEP_LOG:-$HOME/kiosk-sweep.log}"
PORT="${PORT:-3000}"
EVAL="node $SCRIPT_DIR/kiosk-eval.cjs"

exec >>"$LOG" 2>&1
cd "$REPO" || exit 1

# [PORT] Was `vcgencmd measure_temp`, which is Broadcom-only and hard-fails on
# x86. /api/system/metrics autodetects the sensor on both hosts (server/routes/
# system.js), so the dashboard is now its own thermometer.
cpu_temp() {
  node -e "
    fetch('http://localhost:${PORT}/api/system/metrics')
      .then(r => r.json())
      .then(j => console.log(j.tempC == null ? 'temp=n/a' : 'temp=' + j.tempC.toFixed(1) + \"'C\"))
      .catch(() => console.log('temp=unreachable'));
  " 2>/dev/null || echo "temp=n/a"
}

# [PORT] Was `vcgencmd get_throttled`. There is no AMD equivalent, so on a
# non-Pi host report the nearest useful signals instead: current clock against
# the advertised max, and kernel CPU pressure.
throttle_state() {
  if command -v vcgencmd >/dev/null 2>&1; then
    vcgencmd get_throttled
  else
    local cur max pressure
    cur=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo "")
    max=$(cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq 2>/dev/null || echo "")
    pressure=$(awk '/^some/{print $2}' /proc/pressure/cpu 2>/dev/null || echo "")
    if [ -n "$cur" ] && [ -n "$max" ]; then
      printf 'clock=%dMHz/%dMHz %s' "$((cur / 1000))" "$((max / 1000))" "${pressure:-}"
    else
      printf 'throttle=n/a %s' "${pressure:-}"
    fi
  fi
}

echo "===== sweep $(date -Is) ====="
echo "$(cpu_temp) $(throttle_state) load=$(cut -d' ' -f1-3 /proc/loadavg) nproc=$(nproc)"

# Map every chromium process to its --type=, so we never guess which renderer is
# the page. pids change whenever chromium restarts, so resolve them every run.
#
# [PORT] Was `pgrep chromium`, which assumes the binary is named "chromium" —
# it is `chromium-browser` on older Debian and `chrome` elsewhere. Match on the
# CDP-relevant thing instead: any process in the browser's own process tree.
CHROME_PIDS=$(pgrep -f 'type=(gpu-process|renderer|utility|zygote)' 2>/dev/null || true)
BROWSER_PID=$(pgrep -f 'remote-debugging-port=9222' 2>/dev/null | head -1 || true)
PIDS=""; LABELS=""
for p in $BROWSER_PID $CHROME_PIDS; do
  [ -r "/proc/$p/cmdline" ] || continue
  t=$(tr '\0' ' ' < "/proc/$p/cmdline" | grep -o 'type=[a-z-]*' | head -1)
  [ -z "$t" ] && t="browser"
  case ",$PIDS," in *",$p,"*) continue ;; esac   # de-dupe
  PIDS="${PIDS:+$PIDS,}$p"; LABELS="$LABELS $p=$t"
done
if [ -z "$PIDS" ]; then
  echo "ERROR: found no kiosk chromium processes — is dashboard-kiosk.service up?"
  echo "===== end $(date -Is) ====="
  exit 1
fi
echo "processes:$LABELS"

# ── The seam check. Nothing below runs if this fails. ────────────────────────
# kiosk-eval.cjs --detect exits non-zero when a required hook is missing and
# prints the refusal on stderr (which is this log). The whole repair is that the
# sweep can no longer proceed past this point on a surface it cannot drive.
DETECT=$(node "$SCRIPT_DIR/kiosk-eval.cjs" --detect)
if [ $? -ne 0 ]; then
  echo "ABORTED: the measurement instrument cannot drive this page. No samples taken."
  echo "===== end $(date -Is) ====="
  exit 1
fi
echo "surface: $DETECT"
SURFACE=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).surface)' "$DETECT")

sample() {
  local label=$1 secs=$2
  echo "--- $label"
  # State is captured BEFORE and AFTER the window, because the ambient number is
  # worthless without it. Measured 2026-07-31, same photo, same atmo-cloudy,
  # minutes apart: anims=2 -> 35.0% gpu, anims=1 -> 11.3%, anims=0 -> 8.6-9.3%.
  # A 4x spread, driven entirely by whether the window caught a photo-change Ken
  # Burns settle — and since rotation is ~30s against a 25s window, it usually
  # does. Compare hosts at anims=0 (true rest) or you are comparing luck.
  #
  # 🔑 ON V3 THAT RULE DOES NOT APPLY AND FOLLOWING IT MISFILES THE ROW. `anims`
  # counts Web Animations; V3's substrate is a rAF loop on a canvas, so the
  # live-ambient sample that closed the baseline read anims=0 while drawing 15.0
  # fps. Read `substrate.animating` / `substrate.paused` in the state line, and
  # `substrateFps` in the perf line — the latter is a real frame delta across
  # this same window. anims=0 on V3 means nothing at all.
  echo "state(pre):  $($EVAL --state)"
  # all pids over ONE shared window, concurrent with the perf probe.
  # [PORT] Invoked via `bash` rather than directly: gpucpu.sh was committed 100644
  # once, and `git checkout -- .` in the deploy stripped its +x, so every CPU
  # sample died with "Permission denied" while the sweep still exited 0. The mode
  # is fixed in git now; this makes that whole failure class impossible anyway.
  bash "$CPU" "$PIDS" "$secs" > "/tmp/sweep-cpu.$$" &
  local cpujob=$!
  node scripts/kiosk/perf-metrics.cjs "$label" $((secs - 4))
  wait $cpujob
  echo "state(post): $($EVAL --state)"
  echo "cpu (% of one core):"; sed 's/^/  /' "/tmp/sweep-cpu.$$"; rm -f "/tmp/sweep-cpu.$$"
}

trace() {
  echo "trace:"
  node scripts/kiosk/gpu-trace.cjs 3 | grep -E '"(totalEvents|frameishEvents)"|BeginMainFrame|SwapBuffers' -A2
}

# --- 1. ambient: touch nothing --------------------------------------------------
#
# [PORT] The label was hardcoded "ambient-daylight" regardless of the actual
# hour, so a night run logged itself as daylight and the two were
# indistinguishable except by timestamp. The `state:` line above already records
# the atmo token, and the block is timestamped — so just call it what it is.
sample ambient 30
trace

# --- 2. peak: the heaviest state this surface can actually be in -----------------
WAS_SS="unknown"
PEAK_OK=0
if [ "$SURFACE" = "v3" ]; then
  # V3's peak is a REAL composite, not a forced effect: the live MJPEG camera
  # subject at depth 3 over the animating substrate and the photographic ground.
  # There is no atmoFx in V3 and no rain-heavy to force — verified, no such
  # module exists under src/v3/ — so the old peak row simply does not continue
  # here. Driving it lives in kiosk-drive.cjs so the hold, the re-assert and the
  # refusal conditions are all in one place with the checks that police them.
  #
  # ⚠ It REFUSES on a dark panel rather than sampling. With v3EnergySaver on, a
  # night "peak" would measure a PAUSED substrate and come in BELOW daytime
  # ambient — the exact inversion that makes a log untrustworthy.
  node scripts/kiosk/kiosk-drive.cjs peak 34 &
  peakjob=$!
  sample peak-camera-live 30
  wait $peakjob || PEAK_OK=1
  node scripts/kiosk/kiosk-drive.cjs restore
  if [ "$PEAK_OK" -ne 0 ]; then
    echo "!! DISCARD THE PEAK ROW ABOVE — the peak state did not hold for the window (see the error above)."
  fi
else
  WAS_SS=$($EVAL 'document.body.className.includes("screensaver-active")')
  $EVAL 'window.__wakeScreensaver(); 1' >/dev/null
  # NOTE: inside the DISPLAY_OFF window (default 21:00-05:00) the wake is refused
  # and the screensaver re-engages immediately, so a night run measures ambient
  # twice rather than a true worst case. Check the `screensaver` field below.
  #
  # atmoFx episodes are finite ("moments not loops") — a single forced episode
  # expires mid-window and the average under-reports the peak by ~2.5x. Re-fire it
  # for the whole sample so this is a genuine SUSTAINED worst case.
  ( end=$((SECONDS + 34))
    while [ $SECONDS -lt $end ]; do
      $EVAL 'window.__forceAtmoEpisode("rain-heavy")' >/dev/null 2>&1
      sleep 5
    done ) &
  refire=$!
  sample worstcase-rain-heavy 30
  kill "$refire" 2>/dev/null; wait "$refire" 2>/dev/null
fi
trace

# --- 3. cycle: every view (incumbent) or every subject (V3) -----------------------
# The churn that exercises every teardown path in sequence. kiosk-drive.cjs picks
# the right one for the surface and exits non-zero if a transition did not land,
# so a silently gated cycle can never read as success again.
bash "$CPU" "$PIDS" 26 > "/tmp/sweep-cycle.$$" &
cyclejob=$!
node scripts/kiosk/kiosk-drive.cjs cycle
node scripts/kiosk/perf-metrics.cjs cycle 12
wait $cyclejob
echo "--- cycle cpu (% of one core):"; sed 's/^/  /' "/tmp/sweep-cycle.$$"; rm -f "/tmp/sweep-cycle.$$"

# --- restore ---------------------------------------------------------------------
echo "heap: $(node scripts/kiosk/heap-metrics.cjs post-sweep)"
if [ "$SURFACE" = "v3" ]; then
  # Belt and braces: the cycle ends cleared, but a failed step can leave a
  # subject mounted, and the sweep must never be the reason the wall is showing
  # the driveway at midnight.
  node scripts/kiosk/kiosk-drive.cjs restore
elif [ "$WAS_SS" = "true" ]; then
  $EVAL 'window.__engageScreensaver(); 1' >/dev/null
  echo "restored: screensaver re-engaged (it was active before the sweep)"
else
  echo "restored: panel left awake (it was awake before the sweep)"
fi
echo "===== end $(date -Is) ====="
