#!/usr/bin/env python3
"""Pi wake+capture+relay agent (Stage C of project-voice-mic-bridge).

Always-on and on-device. Streams the USB mic through openWakeWord; on the wake
word it captures the following utterance (energy-based endpointing), sends the
audio to the PC whisper service for STT, then forwards the transcript to the
dashboard's loopback /api/voice/transcript — which drives the verified Mode-3
voice loop (local -> HA assist -> Claude).

GUARDRAIL (project-voice-mic-bridge): nothing leaves the Pi until the wake word
fires. Audio then goes only to the PC on the home LAN; if the PC is unreachable
we drop the turn (voice goes unavailable), never crash.

Config via env: WAKE_MODEL (hey_jarvis), WAKE_THRESHOLD (0.5), MIC_DEVICE
(plughw:3,0), STT_URL, DASH_URL, SILENCE_RMS, TRAIL_SILENCE_MS, MAX_UTTER_MS.
"""
import glob
import io
import json
import os
import queue
import subprocess
import threading
import time
import urllib.error
import urllib.request
import wave

import numpy as np
import openwakeword
from openwakeword.model import Model

RATE = 16000
FRAME = 1280                       # 80 ms @ 16 kHz — openWakeWord's chunk size
# hey_mycroft, not hey_jarvis: TV dialogue false-woke jarvis 9x in ~3h, scoring
# 0.87-0.97 — the same band as genuine wakes, so no threshold could separate
# them. Over 11h of the same TV, mycroft never scored above 0.3 while genuine
# wakes peak 0.93-1.00. The Pi sets this via a systemd drop-in too; the default
# matches so a lost drop-in doesn't silently reintroduce the false wakes.
WAKE_MODEL = os.environ.get("WAKE_MODEL", "hey_mycroft")
WAKE_THRESHOLD = float(os.environ.get("WAKE_THRESHOLD", "0.6"))
MIC = os.environ.get("MIC_DEVICE", "plughw:3,0")
# Resolved by name, not IP: the PC's DHCP address has drifted twice, and each
# time the wake word kept firing while every turn died on "No route to host" —
# which looks exactly like a dead mic from the glass.
STT_URL = os.environ.get("STT_URL", "http://Mandragon.local:8123/transcribe")
DASH_URL = os.environ.get("DASH_URL", "http://localhost:3000/api/voice/transcript")
# Microphone LEVEL only — never audio. Feeds the dashboard's listening light so
# the rim breathes with the actual room instead of on a timer.
LEVEL_URL = os.environ.get("LEVEL_URL", "http://localhost:3000/api/voice/level")
LEVEL_ENABLED = os.environ.get("LEVEL_ENABLED", "1") == "1"

# Energy-based endpointing (dependency-free): capture until trailing silence.
SILENCE_RMS = int(os.environ.get("SILENCE_RMS", "500"))
MIN_SPEECH_FRAMES = int(os.environ.get("MIN_SPEECH_FRAMES", "3"))
TRAIL_SILENCE_MS = int(os.environ.get("TRAIL_SILENCE_MS", "800"))
MAX_UTTER_MS = int(os.environ.get("MAX_UTTER_MS", "8000"))
COOLDOWN_S = float(os.environ.get("COOLDOWN_S", "1.5"))

# Probe mode: never capture, just log every contiguous run of frames scoring
# above PROBE_FLOOR. Answers whether a TV false-wake is a one-frame spike while
# a spoken wake word holds — i.e. whether a consecutive-frame gate can separate
# them, which the score alone cannot (both land in the 0.87-0.97 band).
PROBE_ONLY = os.environ.get("PROBE_ONLY", "") == "1"
PROBE_FLOOR = float(os.environ.get("PROBE_FLOOR", "0.3"))


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def rms(frame):
    if frame.size == 0:
        return 0
    return int(np.sqrt(np.mean(frame.astype(np.float32) ** 2)))


def arecord_stream():
    cmd = ["arecord", "-q", "-D", MIC, "-f", "S16_LE", "-r", str(RATE),
           "-c", "1", "-t", "raw"]
    return subprocess.Popen(cmd, stdout=subprocess.PIPE)


def read_frame(proc):
    want = FRAME * 2  # int16 -> 2 bytes/sample
    buf = proc.stdout.read(want)
    if not buf or len(buf) < want:
        return None
    return np.frombuffer(buf, dtype=np.int16)


# ── Level relay ──────────────────────────────────────────────────────────────
# The capture loop below is TIMING-CRITICAL: it reads one 80 ms frame at a time
# and ends the utterance after TRAIL_SILENCE_MS of quiet. A blocking POST inside
# that loop would stretch frames, drift the trailing-silence count, and clip
# people mid-sentence — trading a working microphone for a prettier animation.
#
# So levels go out on a daemon thread fed by a depth-1 queue that DROPS when
# full. Dropping is correct: a level frame is only interesting while it is
# current, and a backlog of stale ones is worse than a gap.
_level_q = queue.Queue(maxsize=1)


def _level_worker():
    while True:
        rms_value = _level_q.get()
        try:
            _post(LEVEL_URL, json.dumps({"rms": rms_value}).encode(),
                  "application/json", 2)
        except (urllib.error.URLError, OSError, ValueError):
            pass  # the dashboard may be restarting; the mic must not care


def send_level(rms_value):
    if not LEVEL_ENABLED:
        return
    try:
        _level_q.put_nowait(rms_value)
    except queue.Full:
        pass  # a newer frame is already in flight; this one is stale anyway


def capture_utterance(proc):
    frames, speech_frames, trail = [], 0, 0.0
    start = time.time()
    trail_limit = TRAIL_SILENCE_MS / 1000.0
    while True:
        f = read_frame(proc)
        if f is None:
            break
        frames.append(f)
        level = rms(f)
        send_level(level)          # non-blocking; drops rather than delays
        if level >= SILENCE_RMS:
            speech_frames += 1
            trail = 0.0
        elif speech_frames >= MIN_SPEECH_FRAMES:
            trail += FRAME / RATE
            if trail >= trail_limit:
                break
        if (time.time() - start) * 1000 >= MAX_UTTER_MS:
            break
    if speech_frames < MIN_SPEECH_FRAMES:
        return None
    return np.concatenate(frames)


def to_wav(pcm):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    return b.getvalue()


def _post(url, data, ctype, timeout):
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": ctype}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def transcribe(wav):
    try:
        return (_post(STT_URL, wav, "audio/wav", 30).get("text") or "").strip()
    except (urllib.error.URLError, OSError, ValueError) as e:
        log("STT unreachable — dropping turn:", e)
        return ""


def forward(text):
    try:
        _post(DASH_URL, json.dumps({"text": text}).encode(), "application/json", 5)
    except (urllib.error.URLError, OSError, ValueError) as e:
        log("dashboard forward failed:", e)


def reset(oww):
    fn = getattr(oww, "reset", None)
    if callable(fn):
        fn()


def resolve_model_path():
    override = os.environ.get("WAKE_MODEL_PATH")
    if override:
        return override
    resdir = os.path.join(os.path.dirname(openwakeword.__file__), "resources", "models")
    hits = sorted(glob.glob(os.path.join(resdir, f"{WAKE_MODEL}_*.onnx")))
    if not hits:
        raise FileNotFoundError(
            f"no bundled model for '{WAKE_MODEL}' in {resdir} "
            f"(have: {sorted(os.listdir(resdir))})")
    return hits[0]


def main():
    model_path = resolve_model_path()
    oww = Model(wakeword_model_paths=[model_path])
    # The predict() key is the model-file stem (e.g. 'hey_jarvis_v0.1'), not the
    # friendly name — discover it from a warm-up frame so the threshold check is
    # keyed correctly regardless of the version suffix.
    wake_key = next(iter(oww.predict(np.zeros(FRAME, dtype=np.int16)).keys()))
    reset(oww)
    log(f"listening on {MIC} for '{WAKE_MODEL}' [{wake_key}] (threshold {WAKE_THRESHOLD})")

    if PROBE_ONLY:
        log(f"PROBE mode — logging runs above {PROBE_FLOOR}, capturing nothing")

    if LEVEL_ENABLED:
        # daemon=True so a stuck POST can never keep the agent alive on shutdown
        threading.Thread(target=_level_worker, daemon=True).start()
        log(f"level relay on → {LEVEL_URL}")

    proc = arecord_stream()
    run = []
    try:
        while True:
            frame = read_frame(proc)
            if frame is None:
                log("mic stream ended; restarting arecord")
                time.sleep(1)
                proc = arecord_stream()
                reset(oww)
                continue
            score = oww.predict(frame).get(wake_key, 0.0)
            if PROBE_ONLY:
                if score >= PROBE_FLOOR:
                    run.append(score)
                elif run:
                    over = sum(1 for s in run if s >= WAKE_THRESHOLD)
                    log(f"PROBE frames={len(run)} over={over} peak={max(run):.2f} "
                        f"trace={[round(s, 2) for s in run]}")
                    run = []
                continue
            if score >= WAKE_THRESHOLD:
                log(f"WAKE ({score:.2f}) — capturing…")
                pcm = capture_utterance(proc)
                # The turn is over: drop the rim now rather than leaving the
                # client's decay to guess. Cheap, and it makes "I have stopped
                # listening" a fact the room can see instead of an inference.
                send_level(0)
                reset(oww)
                if pcm is None:
                    log("no speech after wake")
                    continue
                text = transcribe(to_wav(pcm))
                if not text:
                    log("empty transcript")
                    continue
                log("heard:", repr(text))
                forward(text)
                time.sleep(COOLDOWN_S)
                reset(oww)
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
