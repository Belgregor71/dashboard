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
#   WORSTCASE — wakes the panel and forces a rain-heavy atmoFx episode, the
#               heaviest effect the dashboard has. Restores state after.
#   VIEW-CYCLE— forces through all six registered views.
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

STATE_EXPR='JSON.stringify({view:document.body.dataset.view||null,screensaver:document.body.className.includes("screensaver-active"),anims:document.getAnimations().filter(a=>a.playState==="running").length,atmo:[...document.body.classList].find(c=>c.startsWith("atmo-"))||null,fx:(window.__atmoFx&&window.__atmoFx().running)||null})'

sample() {
  local label=$1 secs=$2
  echo "--- $label"
  # State is captured BEFORE and AFTER the window, because the ambient number is
  # worthless without it. Measured 2026-07-31, same photo, same atmo-cloudy,
  # minutes apart: anims=2 -> 35.0% gpu, anims=1 -> 11.3%, anims=0 -> 8.6-9.3%.
  # A 4x spread, driven entirely by whether the window caught a photo-change Ken
  # Burns settle — and since rotation is ~30s against a 25s window, it usually
  # does. Compare hosts at anims=0 (true rest) or you are comparing luck.
  echo "state(pre):  $($EVAL "$STATE_EXPR")"
  # all pids over ONE shared window, concurrent with the perf probe.
  # [PORT] Invoked via `bash` rather than directly: gpucpu.sh was committed 100644
  # once, and `git checkout -- .` in the deploy stripped its +x, so every CPU
  # sample died with "Permission denied" while the sweep still exited 0. The mode
  # is fixed in git now; this makes that whole failure class impossible anyway.
  bash "$CPU" "$PIDS" "$secs" > "/tmp/sweep-cpu.$$" &
  local cpujob=$!
  node scripts/kiosk/perf-metrics.cjs "$label" $((secs - 4))
  wait $cpujob
  echo "state(post): $($EVAL "$STATE_EXPR")"
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

# --- 2. worst case: wake + heaviest effect ---------------------------------------
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
trace

# --- 3. view cycle ---------------------------------------------------------------
bash "$CPU" "$PIDS" 26 > "/tmp/sweep-cycle.$$" &
cyclejob=$!
node scripts/kiosk/kiosk-drive.cjs cycle
node scripts/kiosk/perf-metrics.cjs view-cycle 12
wait $cyclejob
echo "--- view-cycle cpu (% of one core):"; sed 's/^/  /' "/tmp/sweep-cycle.$$"; rm -f "/tmp/sweep-cycle.$$"

# --- restore ---------------------------------------------------------------------
echo "heap: $(node scripts/kiosk/heap-metrics.cjs post-sweep)"
if [ "$WAS_SS" = "true" ]; then
  $EVAL 'window.__engageScreensaver(); 1' >/dev/null
  echo "restored: screensaver re-engaged (it was active before the sweep)"
else
  echo "restored: panel left awake (it was awake before the sweep)"
fi
echo "===== end $(date -Is) ====="
