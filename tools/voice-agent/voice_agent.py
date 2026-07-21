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
import subprocess
import time
import urllib.error
import urllib.request
import wave

import numpy as np
import openwakeword
from openwakeword.model import Model

RATE = 16000
FRAME = 1280                       # 80 ms @ 16 kHz — openWakeWord's chunk size
WAKE_MODEL = os.environ.get("WAKE_MODEL", "hey_jarvis")
WAKE_THRESHOLD = float(os.environ.get("WAKE_THRESHOLD", "0.5"))
MIC = os.environ.get("MIC_DEVICE", "plughw:3,0")
STT_URL = os.environ.get("STT_URL", "http://192.168.0.197:8123/transcribe")
DASH_URL = os.environ.get("DASH_URL", "http://localhost:3000/api/voice/transcript")

# Energy-based endpointing (dependency-free): capture until trailing silence.
SILENCE_RMS = int(os.environ.get("SILENCE_RMS", "500"))
MIN_SPEECH_FRAMES = int(os.environ.get("MIN_SPEECH_FRAMES", "3"))
TRAIL_SILENCE_MS = int(os.environ.get("TRAIL_SILENCE_MS", "800"))
MAX_UTTER_MS = int(os.environ.get("MAX_UTTER_MS", "8000"))
COOLDOWN_S = float(os.environ.get("COOLDOWN_S", "1.5"))


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


def capture_utterance(proc):
    frames, speech_frames, trail = [], 0, 0.0
    start = time.time()
    trail_limit = TRAIL_SILENCE_MS / 1000.0
    while True:
        f = read_frame(proc)
        if f is None:
            break
        frames.append(f)
        if rms(f) >= SILENCE_RMS:
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

    proc = arecord_stream()
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
            if score >= WAKE_THRESHOLD:
                log(f"WAKE ({score:.2f}) — capturing…")
                pcm = capture_utterance(proc)
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
