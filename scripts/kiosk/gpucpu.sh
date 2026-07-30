#!/bin/bash
# Averaged CPU% of one or more pids over N seconds, via /proc/[pid]/stat vs /proc/stat.
# Use this instead of `top -bn1` for the Chromium gpu-process: single-shot top
# samples a bursting compositor process and gives wildly noisy numbers (0-110%
# swings). This delta-over-a-window method is stable — 25-30s windows are
# trustworthy, short ones are not.
#
# Usage: gpucpu.sh <pid>[,<pid>...] [seconds=5]
#   gpucpu.sh 1234        -> bare number (percent of ONE core)
#   gpucpu.sh 1234,5678 25 -> "1234 12.3" / "5678 4.5", both over the SAME window
#   find the gpu pid: for p in $(pgrep chromium); do \
#     tr '\0' ' ' </proc/$p/cmdline | grep -q type=gpu-process && echo $p; done
#
# Comma-separated pids share one sampling window — that matters, because two
# sequential 25s runs sample different work and are not comparable.
#
# ⚠ 2026-07-30 bugfix: this used `bc "scale=1; dp/dt*NCPU*100"`, but bc applies
# scale to the DIVISION, truncating to one decimal before the multiply. On a
# 4-core box the only values it could emit were 0/40/80/120, and anything under
# ~25% of a core reported as literally 0. That artifact is where the "any motion
# → 80% of a core, effectively binary" model came from. Always multiply first.
set -u
IFS=',' read -ra PIDS <<< "${1:?usage: gpucpu.sh <pid>[,<pid>...] [seconds]}"
SECS=${2:-5}

read_pid() { awk '{print $14+$15}' "/proc/$1/stat" 2>/dev/null; }  # utime+stime (ticks)
read_tot() { awk '/^cpu /{s=0;for(i=2;i<=NF;i++)s+=$i;print s}' /proc/stat; }

declare -A P1
for pid in "${PIDS[@]}"; do
  v=$(read_pid "$pid")
  [ -z "$v" ] && { echo "gpucpu.sh: no such pid: $pid" >&2; exit 1; }
  P1[$pid]=$v
done
t1=$(read_tot)
sleep "$SECS"
t2=$(read_tot)

NCPU=$(nproc)
dt=$((t2 - t1))
[ "$dt" -le 0 ] && { echo "gpucpu.sh: zero jiffies elapsed — window too short" >&2; exit 1; }

for pid in "${PIDS[@]}"; do
  p2=$(read_pid "$pid")
  if [ -z "$p2" ]; then
    echo "gpucpu.sh: pid $pid exited during the window" >&2
    continue
  fi
  # percent of a SINGLE core = dp/dt * ncpu * 100, multiplied before dividing
  pct=$(awk -v dp=$((p2 - ${P1[$pid]})) -v dt="$dt" -v n="$NCPU" \
          'BEGIN { printf "%.1f", dp * n * 100 / dt }')
  if [ "${#PIDS[@]}" -eq 1 ]; then echo "$pct"; else echo "$pid $pct"; fi
done
