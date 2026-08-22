#!/usr/bin/env python3
"""Offline proof for stt_server.py's decode knobs and the shadow leg.

⚠ THIS PROVES PLUMBING, NOT ACCURACY. The audio is a synthesised tone, and this
repo's standing rule is that synthetic audio must never be used to judge
transcription quality — the one previous attempt fed Kokoro-generated speech,
got a perfect transcript, and concluded the STT was fine while the room was
being misheard (project-voice-compute-on-g11). Accuracy is measured by
STT_SHADOW_MODEL against real turns, in the journal, not here.

What it asserts:
  * flag-off adds NO decode keys and returns the original response shape, so the
    rollback path is a property something checks rather than a claim
  * the knobs land, /health reports them, and the hotword COUNT is reported
    where the contents must never be
  * the shadow leg logs a comparison, off the response path
  * an unreadable hotwords file costs a log line, not the transcriber

⚠ NOT part of `npm test` — the suite is Playwright and cannot reach Python, and
this needs the venv plus a cached faster-whisper model. Run it by hand after
touching stt_server.py:

    tools/voice-pc/.venv/Scripts/python.exe tools/voice-pc/stt_selftest.py     (Windows)
    tools/voice-pc/.venv/bin/python tools/voice-pc/stt_selftest.py             (Linux)

It spawns real servers on ports 8197-8199 and takes ~40 s.
"""
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

# The case names carry the glyphs the rest of this repo uses, and a Windows
# console defaults to cp1252 — which turns a PASSING run into a
# UnicodeEncodeError traceback at the print, not at the assert. Same guard
# capture_selftest.py opens with, and the same trap this file's first run found
# living inside stt_server.py itself.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
SERVER = HERE / "stt_server.py"
TMP = Path(tempfile.mkdtemp(prefix="stt-selftest-"))

# 1.2 s at 16 kHz: a 440 Hz burst inside silence. Enough for whisper to run its
# whole pipeline; what it makes of it is not the subject.
wav_path = TMP / "probe.wav"
with wave.open(str(wav_path), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    w.writeframes(b"".join(
        struct.pack("<h", int(6000 * math.sin(2 * math.pi * 440 * i / 16000))
                    if 4000 < i < 12000 else 0)
        for i in range(int(16000 * 1.2))))
AUDIO = wav_path.read_bytes()

hot = TMP / "hotwords.txt"
hot.write_text("# comment ignored\n\nMycroft\nliving room\n", encoding="utf-8")


def run(port, env_extra, label):
    """Start a server, ask it one question, stop it. Returns (health, body, log)."""
    env = {**os.environ, "STT_HOST": "127.0.0.1", "STT_PORT": str(port), **env_extra}
    # ⚠ NO PYTHONIOENCODING HERE, DELIBERATELY. Setting it would paper over
    # exactly the cp1252 crash this harness caught on its first run — the child
    # must survive its own banner on a pipe with no help from the parent.
    for stale in ("STT_CONDITION_PREV", "STT_NO_SPEECH", "STT_TEMPERATURE",
                  "STT_HOTWORDS_FILE", "STT_SHADOW_MODEL", "STT_SHADOW_COMPUTE"):
        if stale not in env_extra:
            env.pop(stale, None)   # a knob left in the ambient env would fake a pass
    proc = subprocess.Popen([sys.executable, str(SERVER)], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace")
    base = f"http://127.0.0.1:{port}"
    health = None
    for _ in range(120):
        try:
            with urllib.request.urlopen(base + "/health", timeout=2) as r:
                health = json.loads(r.read())
            break
        except Exception:
            if proc.poll() is not None:
                print(proc.stdout.read())
                raise SystemExit(f"[{label}] server exited before it listened")
            time.sleep(0.5)
    assert health, f"[{label}] /health never answered"

    req = urllib.request.Request(base + "/transcribe", data=AUDIO,
                                 headers={"Content-Type": "audio/wav"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.loads(r.read())

    time.sleep(6)          # the shadow runs AFTER the response; give it the floor
    proc.terminate()
    log = proc.stdout.read()
    proc.wait(timeout=10)
    return health, body, log


SHAPE = ["audio_ms", "language", "text", "took_ms"]

print("=" * 72)
print("CASE 1 — flag-off: every knob added after STT_BEAM left unset")
h, b, log = run(8197, {}, "off")
assert h["decode"] == [], f"flag-off inserted decode keys: {h['decode']}"
assert h["hotwords"] == 0 and h["shadow"] is None, h
assert sorted(b) == SHAPE, sorted(b)
assert "shadow" not in log, "the shadow ran with STT_SHADOW_MODEL unset"
print("  ✅ decode [], response shape unchanged, no shadow")

print("=" * 72)
print("CASE 2 — hardening + shadow on")
h, b, log = run(8198, {
    "STT_CONDITION_PREV": "0",
    "STT_NO_SPEECH": "0.6",
    "STT_TEMPERATURE": "0",
    "STT_HOTWORDS_FILE": str(hot),
    # The same model on both legs, so "they agreed" is a DETERMINISTIC pass
    # rather than a coin flip on what two different models make of a tone.
    "STT_SHADOW_MODEL": os.environ.get("STT_MODEL", "base.en"),
}, "on")
assert h["decode"] == ["condition_on_previous_text", "hotwords",
                       "no_speech_threshold", "temperature"], h["decode"]
assert h["hotwords"] == 3, h["hotwords"]           # Mycroft + living + room
assert "Mycroft" not in json.dumps(h), "/health leaked the hotword CONTENTS"
assert sorted(b) == SHAPE, sorted(b)
lines = [ln for ln in log.splitlines() if "shadow same" in ln or "shadow DIFF" in ln]
assert lines, "the shadow never logged a comparison:\n" + log
assert "shadow same" in lines[0], f"one model disagreed with itself: {lines[0]}"
print(f"  ✅ 4 decode keys · hotword count only · {lines[0].strip()}")

print("=" * 72)
print("CASE 3 — an unreadable hotwords file must not be fatal")
h, b, log = run(8199, {"STT_HOTWORDS_FILE": str(TMP / "nope.txt")}, "missing")
assert h["ok"] is True and h["hotwords"] == 0, h
assert "unreadable" in log, log
assert sorted(b) == SHAPE, sorted(b)
print("  ✅ logged and carried on, still transcribing")

print("=" * 72)
print("ALL CASES PASSED")
