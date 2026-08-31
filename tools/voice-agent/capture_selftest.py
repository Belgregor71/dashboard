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
              "AMBIENT_ENABLED", "SMART_TURN_MODEL_PATH", "SMART_TURN_ON",
              "SMART_AFTER_MS", "SMART_EVERY_MS", "SMART_TRAIL_MAX_MS",
              "SMART_TURN_FILTERS", "SMART_TURN_THREADS"):
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


class FakeSession:
    """Stands in for the onnxruntime session in the two cases that unit-test
    _turn_probability directly — its feature call, its probability-vs-logit
    sniffing, its except. Everything else stubs turn_submit/turn_poll instead,
    because the capture loop talks to those and not to the model."""
    def __init__(self, answer):
        self.answer = answer          # callable(features) -> array-like, or raises
        self.calls = 0

    def run(self, _outputs, feed):
        self.calls += 1
        return [self.answer(feed["input_features"])]


def fake_turn(va, answer, delay_frames):
    """Scripted stand-in for the worker thread.

    ⚠ THE REAL ASK IS ASYNCHRONOUS AND THAT IS NOT A DETAIL. Inference measured
    89.5 ms on the G11 against 80 ms frames, so it cannot run inline, so the
    answer always lands SOME FRAMES AFTER the question. `delay_frames` is how
    this harness reproduces that deterministically against a fake clock — a
    stub that answered instantly would test a loop nobody runs.

    `answer` returning None is the worker having no opinion (a raised
    inference), which publishes nothing at all.

    ⚠⚠ AND IT LETS ASKS OVERLAP, WHICH THE FIRST VERSION OF THIS STUB DID NOT.
    That omission is why 19/19 passed against a defect the very first live turn
    hit: the stub refused a second submit while one was in flight, so it quietly
    enforced the rule the code under test was missing. The real turn_submit
    ALWAYS succeeds — `_turn_q` has maxsize=1 but the worker empties it the
    instant it is filled — and the one-in-flight rule belongs to the CALLER.
    A stub kinder than reality is a stub that cannot fail.
    """
    pending, slot, seq = [], {"v": None}, {"n": 0}

    def submit(pcm):
        seq["n"] += 1
        pending.append([delay_frames, answer(pcm), seq["n"]])
        return seq["n"]

    def poll(ask):
        for item in pending:
            item[0] -= 1
        for item in [i for i in pending if i[0] <= 0]:
            pending.remove(item)
            if item[1] is not None:          # None = the worker had no opinion
                slot["v"] = (item[2], item[1])   # newest wins, as the worker does
        got, slot["v"] = slot["v"], None
        if got is None:
            return None
        aid, val = got
        # Consumed either way — the real turn_poll's get_nowait removes the item
        # before it checks the id, and a stub that held onto a mismatched answer
        # would wedge instead of moving on.
        return val if (ask is not None and aid == ask) else None

    va.turn_submit, va.turn_poll = submit, poll
    return pending


def run(va, script, vad=True, turn=None, delay_frames=1):
    clock = Clock()
    va.time = clock
    mic = FakeMic(script, clock, va.RATE, va.FRAME)
    probs = iter([p for _, p in script])
    va._vad = object() if vad else None
    va._speech_probability = lambda f: next(probs, 0.0)
    # `turn=None` is a model that was never loaded — the fallback path, and the
    # one that must never cost the house its microphone.
    va._turn = object() if turn else None
    if turn:
        fake_turn(va, turn, delay_frames)
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


@case("the DEFAULT is speech endpointing — the flip itself, pinned")
def _():
    va = load()                       # no env at all
    assert va.CAPTURE_VAD == "speech", f"default reverted to {va.CAPTURE_VAD!r}"
    pcm, took = run(va, secs(20, ROOM, 0.03))
    assert pcm is None and took < 1700, f"silent wake still cost {took}ms"


@case("measured: the real traces from the wall would endpoint correctly")
def _():
    """The two captures of 2026-08-20, replayed frame for frame at their
    recorded speech probabilities. This is the only case here whose numbers came
    out of the room rather than out of my head."""
    va = load()
    # "show me the weather for the next seven days." — speech, then 4.8s of
    # trailing silence that RMS counted as voiced.
    spoken = ([(900, 0.48), (688, 0.37), (697, 0.31), (545, 0.27), (547, 0.24),
               (487, 0.20), (593, 0.18), (595, 0.16), (562, 0.14), (568, 0.15),
               (798, 0.38), (1532, 0.77)]
              + [(2500, 0.97)] * 12 + [(1200, 0.60)] * 2 + [(600, 0.05)] * 60)
    pcm, took = run(va, spoken)
    assert pcm is not None, "THE HOUSE WENT DEAF on a real recorded command"
    assert took < 5000, f"still running long on a real command: {took}ms"
    # the silent one: 42 frames, nothing above 0.16
    silent = [(518, 0.03)] * 20 + [(584, 0.16)] + [(520, 0.04)] * 21
    pcm, took = run(va, silent)
    assert pcm is None, "room tone captured again — whisper would invent a word"
    assert took < 1700, f"silent wake still cost {took}ms"


# ── CAPTURE_VAD=smart ────────────────────────────────────────────────────────
# The rule under test is the ENDPOINTING, not the model — the same split the
# speech cases above use, where silero is scripted rather than loaded. What a
# real Smart Turn export makes of real room speech is a question for the wall
# and the `turn=` column in the trace; what these fix is that the loop reacts to
# its answer correctly, including when the answer is late, stale, or absent.

DONE = lambda _pcm: 0.9              # "that sentence is finished"
MORE = lambda _pcm: 0.1              # "they are still going"
MUTE = lambda _pcm: None             # no opinion — a raised inference


@case("smart mode: a finished sentence ends sooner than 800ms of silence")
def _():
    va = load(CAPTURE_VAD="smart", SMART_AFTER_MS=240)
    pcm, took = run(va, secs(2, SPEECH, 0.92) + secs(3, ROOM, 0.03), turn=DONE)
    assert pcm is not None, "THE HOUSE WENT DEAF: a spoken command was dropped"
    # speech mode takes ~2.8s on this exact script (the case above pins it).
    # Ending on the model should cost ~2.0 + 0.24 + one frame of answer latency.
    assert took < 2600, f"smart mode did not end early: {took}ms"
    assert took > 2100, f"ended DURING speech, which is the clipping bug: {took}ms"


@case("⚠ smart mode: a mid-sentence pause is not cut off — the whole point")
def _():
    """1.2s of silence in the middle, which is LONGER than TRAIL_SILENCE_MS.
    Speech mode ends there by construction and throws the second half away."""
    script = (secs(1, SPEECH, 0.92) + secs(1.2, ROOM, 0.03)
              + secs(1.5, SPEECH, 0.92) + secs(3, ROOM, 0.03))

    va = load(CAPTURE_VAD="speech")
    _, cut = run(va, script)
    assert cut < 2400, f"premise gone — speech mode no longer cuts here ({cut}ms)"

    # "still going" until 3 s of audio has accumulated: through the pause, and
    # not after the second burst. pcm is raw int16 here, so len() is samples.
    va = load(CAPTURE_VAD="smart", SMART_AFTER_MS=240, SMART_TRAIL_MAX_MS=2000)
    pcm, took = run(va, script,
                    turn=lambda pcm: 0.9 if len(pcm) > va.RATE * 3 else 0.1)
    assert pcm is not None, "the turn was dropped entirely"
    assert took > 3000, f"cut off mid-sentence anyway at {took}ms (speech: {cut}ms)"
    assert took < 4200, f"kept listening long past the end: {took}ms"


@case("⚠⚠ smart mode with no model falls back to speech — never to a deaf house")
def _():
    va = load(CAPTURE_VAD="smart")     # SMART_TURN_MODEL_PATH unset
    pcm, took = run(va, secs(2, SPEECH, 0.92) + secs(3, ROOM, 0.03), turn=None)
    assert pcm is not None, "THE HOUSE WENT DEAF when the turn model was absent"
    # Byte-for-byte the speech-mode expectation from the case above.
    assert 2700 <= took <= 3100, f"did not degrade to the speech rule: {took}ms"


@case("⚠⚠ a model with no opinion means keep waiting, never 'finished'")
def _():
    """A raised inference publishes nothing, so the loop simply never hears
    back. The direction matters more than the fallback: read as 'finished' it
    would cut people off, which is the defect smart mode is here to remove."""
    va = load(CAPTURE_VAD="smart", SMART_AFTER_MS=240, SMART_TRAIL_MAX_MS=2000)
    pcm, took = run(va, secs(1, SPEECH, 0.92) + secs(4, ROOM, 0.03), turn=MUTE)
    assert pcm is not None, "a silent model cost the whole turn"
    assert took > 2600, f"a model that never answered ended the turn early: {took}ms"
    assert took < 3400, f"a model that never answered never ended it: {took}ms"


@case("⚠⚠ an answer that arrives AFTER they start talking again is discarded")
def _():
    """The bug the ask id exists for. The model is asked during a pause, says
    'finished', and the reply lands a few frames later — by which time the
    person has resumed. Acting on it is the clipping bug through the back door.

    delay_frames=4 puts the answer squarely inside the second burst."""
    script = (secs(1, SPEECH, 0.92) + secs(0.4, ROOM, 0.03)
              + secs(1.5, SPEECH, 0.92) + secs(3, ROOM, 0.03))
    va = load(CAPTURE_VAD="smart", SMART_AFTER_MS=240, SMART_TRAIL_MAX_MS=2000)
    pcm, took = run(va, script, turn=DONE, delay_frames=4)
    assert pcm is not None, "the turn was dropped entirely"
    # Ending on the stale answer would land around 1.7s, mid second burst.
    assert took > 2900, f"acted on a stale 'finished' at {took}ms — id check failed"


@case("⚠⚠ SEEN LIVE: inference SLOWER than the re-ask interval must still converge")
def _():
    """The defect the first live turn hit, and the reason this stub had to be
    rewritten to allow overlapping asks.

    `_turn_q` has maxsize=1, but the worker empties it the moment it is filled,
    so turn_submit succeeds again while the previous inference is still running.
    Every new ask advanced the id and every answer landed stale:
    `turn=- asks=9`, and the capture then sat out the full SMART_TRAIL_MAX_MS —
    5115 ms against a ~2270 ms baseline, i.e. WORSE than the rule it replaced.

    ⚠ delay_frames MUST EXCEED THE ASK INTERVAL or there is no overlap and the
    case proves nothing. At 3 the answer lands exactly as the next ask falls due
    and the defective build passes; 5 (~400 ms, which is what the G11 actually
    shows under load) gives 8 overlapping asks and 0 successful polls. Verified
    by injection: 2559 ms with the gate, 3999 ms without."""
    va = load(CAPTURE_VAD="smart", SMART_AFTER_MS=240, SMART_EVERY_MS=160,
              SMART_TRAIL_MAX_MS=2000)
    pcm, took = run(va, secs(2, SPEECH, 0.92) + secs(3, ROOM, 0.03),
                    turn=DONE, delay_frames=5)
    assert pcm is not None, "the turn was dropped entirely"
    # It must end ON THE MODEL, not by timing out at 2.0s of trailing silence.
    assert took < 2800, (f"never collected an answer: {took}ms — the asks are "
                         f"outrunning them again")


@case("smart mode still respects MAX_UTTER_MS when the model never agrees")
def _():
    va = load(CAPTURE_VAD="smart", SMART_TRAIL_MAX_MS=60_000, MAX_UTTER_MS=8000)
    pcm, took = run(va, secs(1, SPEECH, 0.92) + secs(30, ROOM, 0.03), turn=MORE)
    assert pcm is not None
    assert 7900 <= took <= 8200, f"the 8s cap stopped bounding the loop: {took}ms"


@case("the mel frontend is the shape the export demands: (1, 80, 800)")
def _():
    va = load(CAPTURE_VAD="smart")
    va._turn_filters = np.zeros((va.N_FFT // 2 + 1, 80), np.float32) + 1e-3
    for samples in (16000, 128000, 400000):     # short, exact, over-long
        f = va._turn_features(np.zeros(samples, np.int16))
        assert f.shape == (1, 80, va.MEL_FRAMES), f"{samples} -> {f.shape}"
        assert f.dtype == np.float32, f.dtype


@case("⚠ the output is a sigmoid despite the tensor being named 'logits'")
def _():
    """Measured on the real export: four signals came back in 0.79-0.99. An
    in-range value must pass through untouched; anything else is squashed, so a
    future export cannot be read on a scale it was never on."""
    va = load(CAPTURE_VAD="smart")
    va._turn_filters = np.zeros((va.N_FFT // 2 + 1, 80), np.float32) + 1e-3
    audio = np.zeros(128000, np.int16)
    va._turn = FakeSession(lambda _f: np.array([[0.83]], np.float32))
    assert abs(va._turn_probability(audio) - 0.83) < 1e-6, "a probability was squashed"
    va._turn = FakeSession(lambda _f: np.array([[4.0]], np.float32))
    assert abs(va._turn_probability(audio) - 0.982) < 1e-3, "a logit was not squashed"


@case("⚠⚠ an inference that RAISES returns None, and says so exactly once")
def _():
    va = load(CAPTURE_VAD="smart")
    va._turn_filters = np.zeros((va.N_FFT // 2 + 1, 80), np.float32) + 1e-3
    def boom(_f):
        raise RuntimeError("the export did not fit the binding")
    va._turn = FakeSession(boom)
    said = []
    va.log = lambda *a: said.append(" ".join(str(x) for x in a))
    audio = np.zeros(128000, np.int16)
    assert all(va._turn_probability(audio) is None for _ in range(5)), \
        "a raised inference was read as an answer"
    assert len(said) == 1, f"logged {len(said)} times, not once — the journal floods"


# ── The capture watchdog ─────────────────────────────────────────────────────
# ⚠⚠⚠ THE HOUSE HAS NOW GONE DEAF TWICE, and the second time walked straight
# past the watchdog built for the first. 2026-08-15: arecord stopped delivering.
# 2026-08-30: arecord kept delivering a SATURATED signal, pinned at -4.6 dBFS
# with a 0.4 dB spread across five minutes, and the house was deaf for 34 hours
# with the service `active`, NRestarts=0 and the journal silent.
#
# The first watchdog watched for the ABSENCE of frames, so the second fault was
# invisible to it by construction. These cases exist so a third variety has to
# get past a test rather than past a comment.


def _clocks(va, *, frames_ago, quiet_ago):
    """Put the two clocks a chosen age behind a fixed 'now'."""
    now = 5_000_000.0
    va._last_frame_at = now - frames_ago
    va._last_quiet_at = now - quiet_ago
    return now


@case("a healthy mic trips nothing")
def _():
    va = load()
    now = _clocks(va, frames_ago=0.5, quiet_ago=0.5)
    assert va._stall_reason(now) is None, "shot a working microphone"


@case("⚠ 2026-08-15 — frames STOP arriving")
def _():
    va = load()
    now = _clocks(va, frames_ago=va.FRAME_STALL_S + 1, quiet_ago=va.FRAME_STALL_S + 1)
    why = va._stall_reason(now)
    assert why and "delivered nothing" in why, f"missed a dead pipe: {why!r}"


@case("⚠⚠⚠ 2026-08-30 — frames KEEP arriving, pinned near clipping")
def _():
    va = load()
    # The exact shape of the fault: the pipe is perfectly healthy, so the idle
    # clock is fresh. Only the quiet clock is stale. The old watchdog saw a
    # fresh idle clock and went back to sleep for 34 hours.
    now = _clocks(va, frames_ago=0.1, quiet_ago=va.PINNED_STALL_S + 1)
    why = va._stall_reason(now)
    assert why is not None, "THE 2026-08-30 DEAFNESS IS STILL INVISIBLE"
    assert "pinned" in why and "saturated" in why, f"wrong diagnosis: {why!r}"


@case("⚠ a LOUD but living room is not shot — the false positive that would matter")
def _():
    va = load()
    # 89 s of unbroken clipping is still under the bar; the room gets the
    # benefit of the doubt right up to the threshold.
    now = _clocks(va, frames_ago=0.1, quiet_ago=va.PINNED_STALL_S - 1)
    assert va._stall_reason(now) is None, "shot a room that was merely loud"


@case("the pinned clock is stamped only by a QUIET frame")
def _():
    va = load()
    clock = Clock()
    va.time = clock
    rate, frame = va.RATE, va.FRAME

    # A frame quiet enough to be a real room stamps the clock.
    va._last_quiet_at = 0.0
    proc = types.SimpleNamespace(stdout=FakeMic([(200, 0.0)], clock, rate, frame))
    va.read_frame(proc)
    assert va._last_quiet_at > 0.0, "a quiet frame did not stamp the clock"

    # A pinned frame must NOT — that is the whole detector.
    va._last_quiet_at = 0.0
    loud = int(va.PINNED_RMS) + 5000
    proc = types.SimpleNamespace(stdout=FakeMic([(loud, 0.0)], clock, rate, frame))
    va.read_frame(proc)
    assert va._last_quiet_at == 0.0,         "a saturated frame stamped the quiet clock — the detector is blind"


@case("⚠⚠ LOUD MUSIC with gaps survives eleven minutes — the false positive that would matter")
def _():
    va = load()
    clock = Clock()
    va.time = clock
    rate, frame = va.RATE, va.FRAME

    # The real risk is not speech — speech peaks at rms 2400-5600 here, well
    # under PINNED_RMS, so it can never trip this. It is sustained CLIPPING with
    # occasional gaps: the kitchen media loud enough to saturate. So the fixture
    # holds 80 s above the threshold, drops one quiet frame, and repeats — which
    # walks the clock to within 10 s of firing, eight times over.
    loud = int(va.PINNED_RMS) + 8000
    burst = int(80 / (frame / rate))
    script = []
    for _cycle in range(8):
        script += [(loud, 0.0)] * burst
        script += [(300, 0.0)]
    proc = types.SimpleNamespace(stdout=FakeMic(script, clock, rate, frame))
    va._last_frame_at = va._last_quiet_at = clock.monotonic()

    worst = 0.0
    while va.read_frame(proc) is not None:
        worst = max(worst, clock.monotonic() - va._last_quiet_at)
        assert va._stall_reason(clock.monotonic()) is None,             f"shot a loud room after {worst:.0f}s without a quiet frame"

    # ⚠ The guard on the fixture itself: if the gap arrived so often that the
    # clock never aged, this case would pass while testing nothing at all.
    assert worst > 60, f"the fixture never stressed the detector (worst {worst:.0f}s)"


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
