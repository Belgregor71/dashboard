#!/usr/bin/env python3
"""Offline proof for capture_utterance's endpointing. No microphone, no models.

⚠ THIS LOOP HAS NO OTHER TEST AND THE COST OF BREAKING IT IS A DEAF HOUSE, so
it is worth the stubs. The suite proper is Playwright and cannot reach Python.

Two things make it possible to test at all:
  * a FAKE CLOCK advanced by the audio itself — 80 ms per frame handed over, so
    MAX_UTTER_MS and LEAD_SILENCE_MS mean what they mean in the room. With real
    time and instant synthetic frames the loop reads thousands of frames before
    a single millisecond passes, and every duration assertion is vacuous.
  * a SCRIPTED speech probability, so the silero half is exercised without
    silero — the thing under test is the endpointing rule, not the model.

Run: python tools/voice-agent/capture_selftest.py
"""
import sys, types, importlib.util, os

# The case names carry the same warning glyphs the rest of this repo uses, and
# a Windows console defaults to cp1252 — which turns a PASSING run into a
# UnicodeEncodeError traceback at the print, not at the assert.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# openwakeword is not installed off the kiosk; the module imports it at top
# level and never uses it in this function.
for name in ("openwakeword", "openwakeword.model", "openwakeword.vad"):
    mod = types.ModuleType(name)
    if name == "openwakeword.model":
        mod.Model = object
    if name == "openwakeword.vad":
        mod.VAD = object
    sys.modules.setdefault(name, mod)

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def load(**env):
    """A fresh module per case — the knobs are read at import time."""
    for k in ("CAPTURE_VAD", "SPEECH_ON", "LEAD_SILENCE_MS", "MAX_UTTER_MS",
              "SILENCE_RMS", "TRAIL_SILENCE_MS", "CAPTURE_TRACE", "LEVEL_ENABLED",
              "AMBIENT_ENABLED"):
        os.environ.pop(k, None)
    os.environ["LEVEL_ENABLED"] = "0"      # no HTTP from a self-test
    os.environ["AMBIENT_ENABLED"] = "0"
    os.environ["CAPTURE_TRACE"] = "0"
    os.environ.update({k: str(v) for k, v in env.items()})
    spec = importlib.util.spec_from_file_location(
        f"va_{len(sys.modules)}", os.path.join(HERE, "voice_agent.py"))
    va = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(va)
    return va


class Clock:
    """Wall time that only moves when audio is delivered."""
    def __init__(self): self.t = 1_000_000.0
    def time(self): return self.t
    def monotonic(self): return self.t
    def sleep(self, s): self.t += s
    def strftime(self, *a): return "00:00:00"


class FakeMic:
    """Hands over one scripted frame at a time and ages the clock as it goes."""
    def __init__(self, script, clock, rate, frame):
        self.script, self.clock, self.rate, self.frame = list(script), clock, rate, frame
        self.i, self.buf = 0, b""

    def read(self, n):
        while len(self.buf) < n:
            if self.i >= len(self.script):
                return b""                      # EOF, the genuine end of stream
            level, _ = self.script[self.i]
            self.i += 1
            self.buf += np.full(self.frame, level, dtype=np.int16).tobytes()
            self.clock.t += self.frame / self.rate
        out, self.buf = self.buf[:n], self.buf[n:]
        return out


def run(va, script, vad=True):
    clock = Clock()
    va.time = clock
    mic = FakeMic(script, clock, va.RATE, va.FRAME)
    probs = iter([p for _, p in script])
    va._vad = object() if vad else None
    va._speech_probability = lambda f: next(probs, 0.0)
    proc = types.SimpleNamespace(stdout=mic)
    t0 = clock.t
    pcm = va.capture_utterance(proc)
    return pcm, int((clock.t - t0) * 1000)


FRAMES_PER_S = 12.5
def secs(n, level, prob): return [(level, prob)] * int(n * FRAMES_PER_S)

# This kitchen, measured: floor -36.5 dB is RMS ~518, just OVER SILENCE_RMS 500.
ROOM, SPEECH, QUIET = 518, 3000, 200

CASES = []
def case(name):
    def deco(fn): CASES.append((name, fn)); return fn
    return deco


@case("rms mode is untouched: room tone still runs to the 8s cap")
def _(): # the defect V2 exists to fix, pinned so the default cannot drift
    va = load(CAPTURE_VAD="rms")
    pcm, took = run(va, secs(20, ROOM, 0.02))
    assert pcm is not None, "room tone was not mistaken for speech — premise gone"
    assert 7900 <= took <= 8200, f"expected the 8s cap, got {took}ms"


@case("rms mode still ends early on real silence")
def _():
    va = load(CAPTURE_VAD="rms")
    pcm, took = run(va, secs(1, SPEECH, 0.9) + secs(3, QUIET, 0.02))
    assert pcm is not None, "a spoken command was thrown away"
    assert took < 2200, f"trailing-silence break did not fire: {took}ms"


@case("speech mode: a silent wake gives up in about a second and a half")
def _():
    va = load(CAPTURE_VAD="speech", SPEECH_ON=0.5, LEAD_SILENCE_MS=1500)
    pcm, took = run(va, secs(20, ROOM, 0.02))
    assert pcm is None, "room tone was captured as an utterance"
    assert 1400 <= took <= 1700, f"lead deadline did not fire: {took}ms"


@case("speech mode: a real command is still heard, and ends on its own silence")
def _():
    va = load(CAPTURE_VAD="speech", SPEECH_ON=0.5, LEAD_SILENCE_MS=1500)
    pcm, took = run(va, secs(2, SPEECH, 0.92) + secs(3, ROOM, 0.03))
    assert pcm is not None, "THE HOUSE WENT DEAF: a spoken command was dropped"
    assert 2700 <= took <= 3100, f"expected ~2.8s, got {took}ms"


@case("speech mode: a slow starter is not cut off by the lead deadline")
def _(): # someone says the wake word, pauses to think, THEN speaks
    va = load(CAPTURE_VAD="speech", SPEECH_ON=0.5, LEAD_SILENCE_MS=1500)
    pcm, took = run(va, secs(1.2, ROOM, 0.04) + secs(2, SPEECH, 0.9) + secs(2, ROOM, 0.03))
    assert pcm is not None, "a pause for thought was treated as silence"


@case("speech mode: a long command is not truncated mid-sentence")
def _():
    va = load(CAPTURE_VAD="speech", SPEECH_ON=0.5, LEAD_SILENCE_MS=1500)
    pcm, took = run(va, secs(6, SPEECH, 0.88) + secs(2, ROOM, 0.03))
    assert pcm is not None and took > 6000, f"cut off at {took}ms"


@case("⚠ a missing silero falls back to loudness — never to a deaf house")
def _():
    va = load(CAPTURE_VAD="speech", SPEECH_ON=0.5, LEAD_SILENCE_MS=1500)
    # vad=False is the load having failed. Under speech rules every frame would
    # score 0.0, so a real command would be discarded as "nobody ever spoke".
    pcm, took = run(va, secs(1, SPEECH, 0.9) + secs(3, QUIET, 0.02), vad=False)
    assert pcm is not None, "THE HOUSE WENT DEAF when the VAD failed to load"


@case("speech mode ignores loudness: a quiet talker is still heard")
def _(): # the mirror of the room-tone case — RMS under the old floor, real speech
    va = load(CAPTURE_VAD="speech", SPEECH_ON=0.5, LEAD_SILENCE_MS=1500)
    pcm, _ = run(va, secs(2, 380, 0.85) + secs(2, ROOM, 0.03))
    assert pcm is not None, "a softly spoken command was discarded"


if __name__ == "__main__":
    bad = 0
    for name, fn in CASES:
        try:
            fn()
            print(f"  ok   {name}")
        except AssertionError as e:
            bad += 1
            print(f"  FAIL {name}\n         {e}")
    print(f"\n{len(CASES) - bad}/{len(CASES)} passed")
    sys.exit(1 if bad else 0)
