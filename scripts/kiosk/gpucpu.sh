#!/bin/bash
# Averaged CPU% of a pid over N seconds, via /proc/[pid]/stat vs /proc/stat.
# Use this instead of `top -bn1` for the Chromium gpu-process: single-shot top
# samples a bursting compositor process and gives wildly noisy numbers (0-110%
# swings). This delta-over-a-window method is stable — 25-30s windows are
# trustworthy, short ones are not.
# Usage: gpucpu.sh <pid> [seconds=5]
#   find the gpu pid: for p in $(pgrep chromium); do \
#     tr '\0' ' ' </proc/$p/cmdline | grep -q type=gpu-process && echo $p; done
PID=$1; SECS=${2:-5}
read_pid(){ awk '{print $14+$15}' /proc/$1/stat; }   # utime+stime (ticks)
read_tot(){ awk '/^cpu /{s=0;for(i=2;i<=NF;i++)s+=$i;print s}' /proc/stat; }
NCPU=$(nproc)
p1=$(read_pid $PID); t1=$(read_tot)
sleep $SECS
p2=$(read_pid $PID); t2=$(read_tot)
dp=$((p2-p1)); dt=$((t2-t1))
# process % of a single core = dp/dt * total_cores * 100
echo "scale=1; $dp/$dt*$NCPU*100" | bc
