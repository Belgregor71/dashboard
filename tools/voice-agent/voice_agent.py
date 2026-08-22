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

HALF DUPLEX: the mic and the HDMI speakers share a room, so the house used to
hear its own replies and answer them (see the 2026-08-08/09 logs — it
transcribed "It's 18 degrees and clear." straight back at itself). The agent
therefore tracks whether the dashboard is SPEAKING, via an SSE subscription,
and never captures over its own voice. A wake word during playback is not a
question, it is someone taking the floor: we tell the dashboard to shut up,
wait for it to actually go quiet, and only then listen.

Config via env: WAKE_MODEL (hey_jarvis), WAKE_THRESHOLD (0.5), MIC_DEVICE
(plughw:3,0), STT_URL, DASH_URL, SILENCE_RMS, TRAIL_SILENCE_MS, MAX_UTTER_MS,
SPEAKING_URL, BARGE_URL, BARGE_THRESHOLD, BARGE_FRAMES, UNHEARD_URL,
CAPTURE_VAD (rms|speech|smart), SPEECH_ON, LEAD_SILENCE_MS, CAPTURE_TRACE,
SMART_TURN_MODEL_PATH, SMART_TURN_FILTERS, SMART_TURN_THREADS, SMART_TURN_ON,
SMART_AFTER_MS, SMART_EVERY_MS, SMART_TRAIL_MAX_MS.

⚠ Env knobs are `Environment=` lines in voice-agent.service, NOT the .env file,
and THIS FILE IS NOT DEPLOYED BY A GIT PULL — the unit runs
/home/dashboard/voice-agent/voice_agent.py, outside the repo. Copy it and
restart, or the agent you are reading is not the agent that is running.

Offline proof for the capture loop: tools/voice-agent/capture_selftest.py.
"""
import glob
import io
import json
import os
import queue
import select
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
# Ambient loudness — also never audio. A SECOND, much slower relay, and the
# separation is deliberate: LEVEL_URL is the listening rim (~12.5 Hz, only
# during a capture, decays on the client), while this runs 1 Hz forever so the
# server can tell a person from the Sonos. Sharing one endpoint would make the
# rim glow whenever the kitchen was noisy and never stop.
AMBIENT_URL = os.environ.get("AMBIENT_URL", "http://localhost:3000/api/voice/ambient")
AMBIENT_ENABLED = os.environ.get("AMBIENT_ENABLED", "1") == "1"
AMBIENT_PERIOD_S = float(os.environ.get("AMBIENT_PERIOD_S", "1.0"))

# ── Half duplex ──────────────────────────────────────────────────────────────
# The agent-flavoured SSE stream carries one thing: whether the dashboard is
# playing a reply. Its own endpoint rather than the kiosk's stream because that
# one also fans out ~12.5 level frames a second, and the agent has no use for
# the echo of its own telemetry.
SPEAKING_URL = os.environ.get("SPEAKING_URL", "http://localhost:3000/api/voice/stream?agent=1")
BARGE_URL = os.environ.get("BARGE_URL", "http://localhost:3000/api/voice/barge-in")
UNHEARD_URL = os.environ.get("UNHEARD_URL", "http://localhost:3000/api/voice/unheard")
HALF_DUPLEX = os.environ.get("HALF_DUPLEX", "1") == "1"
# Barging in is destructive — it cuts the house off mid-sentence — so the bar is
# higher than a normal wake and the score has to HOLD. A single frame spiking
# over the line is what TV dialogue does; a spoken wake word holds for several.
# The same discriminator the PROBE_ONLY mode below was built to measure, used
# where it actually earns its keep instead of on the general wake path.
BARGE_THRESHOLD = float(os.environ.get("BARGE_THRESHOLD", "0.7"))
BARGE_FRAMES = int(os.environ.get("BARGE_FRAMES", "2"))
# How long to wait for playback to stop after asking, and how long to let the
# audio device settle once it has. Without the settle the tail of the cut-off
# reply is the first thing in the capture.
BARGE_WAIT_MS = int(os.environ.get("BARGE_WAIT_MS", "4000"))
BARGE_SETTLE_MS = int(os.environ.get("BARGE_SETTLE_MS", "250"))

# Energy-based endpointing (dependency-free): capture until trailing silence.
SILENCE_RMS = int(os.environ.get("SILENCE_RMS", "500"))
MIN_SPEECH_FRAMES = int(os.environ.get("MIN_SPEECH_FRAMES", "3"))
TRAIL_SILENCE_MS = int(os.environ.get("TRAIL_SILENCE_MS", "800"))
MAX_UTTER_MS = int(os.environ.get("MAX_UTTER_MS", "8000"))
COOLDOWN_S = float(os.environ.get("COOLDOWN_S", "1.5"))

# ── Endpointing on SPEECH rather than LOUDNESS (V2) ──────────────────────────
# ⚠ MEASURED, 2026-08-20: failure is systematically SLOWER than success here.
# A command that is heard finishes in 3-10 s; every `empty transcript` in five
# days of journal took 10-13 s. Two separate reasons, and both are below:
#
#  1. The discriminator does not discriminate. `/api/voice/ambient` reads this
#     kitchen's floor at -36.5 dB ≈ RMS 518, against SILENCE_RMS 500 — so
#     ordinary room tone counts as speech, `trail` is reset every frame and the
#     capture runs to MAX_UTTER_MS. It is MARGINAL rather than always over
#     (short commands do end in 3 s), which is exactly why RE-TUNING THE
#     THRESHOLD IS A COIN FLIP AND NOT A FIX. soundPresence already measured
#     this in this room and moved to silero for it; see _speech_probability.
#
#  2. Even a perfect discriminator would not fix a SILENT wake. The trailing-
#     silence break below is unreachable until `speech_frames` reaches
#     MIN_SPEECH_FRAMES, so when nobody speaks at all `trail` never starts and
#     the loop runs the full 8 s no matter what. That is what LEAD_SILENCE_MS
#     is for: give up early when nothing has arrived YET.
#
# ── SPEECH_ON = 0.5, AND IT IS MEASURED, NOT GUESSED ─────────────────────────
# Two captures through this mic, in this room, at this gain, 2026-08-20:
#
#   spoken "show me the weather for the next seven days."
#     101 frames · speech max 1.00 · 25 frames >= 0.50
#     ⚠ RMS called 81 of those 101 frames voiced — INCLUDING 4.8 s of trailing
#       silence after the sentence ended — which is why it ran to the 8 s cap.
#   silent (wake, then nothing)
#     42 frames · speech max 0.16 · 95th pct 0.10 · ZERO frames >= 0.20
#     ⚠ RMS found 4 frames over 500, enough to clear MIN_SPEECH_FRAMES, so 3.4 s
#       of room tone went to whisper — WHICH HALLUCINATED "Okay." A latency bug
#       that was also one step from acting on a word nobody said.
#
# So the two distributions do not overlap anywhere near here: 0.50 sits 0.34
# above the loudest frame silence ever produced, and 25 frames clear it where
# only MIN_SPEECH_FRAMES (3) are needed. Simulated against those exact traces,
# the spoken turn ends on `trail` at 4.0 s (was 8.1 s) and the silent one on
# `lead` at 1.5 s (was 3.4 s, plus an STT round trip that invented a word).
#
# Re-tune from the per-capture trace below, never from a guess — that is the
# mistake SILENCE_RMS already made in this room.
CAPTURE_VAD = os.environ.get("CAPTURE_VAD", "speech").strip().lower()
SPEECH_ON = float(os.environ.get("SPEECH_ON", "0.5"))
LEAD_SILENCE_MS = int(os.environ.get("LEAD_SILENCE_MS", "1500"))

# ── CAPTURE_VAD=smart — endpointing on whether the SENTENCE is finished ──────
# ⚠ THE RULE ABOVE CANNOT TELL A PAUSE FROM AN ENDING, AND NO THRESHOLD FIXES
# THAT. Both of these produce identical silence after identical speech:
#
#     "what's on today —"        (thinking, about to keep going)
#     "what's on today."         (finished)
#
# So `trail` clips the first at 800 ms and taxes the second 800 ms, and the
# whole V2 note above is the record of discovering that re-tuning a threshold
# here is a coin flip. It is a coin flip because the statistic is the wrong one:
# loudness could not see what a speech model can (that is why silero is here),
# and silero cannot see what a TURN model can.
#
# Smart Turn v3 (pipecat-ai/smart-turn, Apache-2.0) is trained on exactly this
# question and takes the AUDIO, not a transcript — the cues are semantic AND
# prosodic, and half of them are gone by the time whisper has been asked. The
# CPU export is an 8 MB int8 ONNX file at ~12 ms, and `onnxruntime` is already a
# hard dependency of the installed openwakeword. It is a file, not a stack.
#
# ⚠⚠ SILERO IS NOT REPLACED. It stays the cheap per-frame gate that answers "is
# someone talking"; this answers the different and dearer question "are they
# FINISHED", and only needs asking once the cheap gate has gone quiet. Feeding
# the turn model every frame would be 12 ms against 80 ms of audio for an answer
# that is meaningless mid-word.
#
# ⚠ FAILS TO `speech`, NEVER TO DEAF. No model file, a bad load, a bad inference
# — every one of them degrades to the rule above, the same way _init_vad()
# degrades to loudness. A deaf mic is the one failure this agent must not choose.
# The weights are NOT in this repo and must not be — an 8 MB binary in a tree
# that deploys by `git pull` to a wall is not a dependency, it is a habit. Fetch
# the v3 CPU export from pipecat-ai/smart-turn onto the G11 beside the agent
# (/home/dashboard/voice-agent/) and point this at it. Unset = the mode is off
# and the loop is exactly the one measured on 2026-08-20.
SMART_TURN_MODEL_PATH = os.environ.get("SMART_TURN_MODEL_PATH", "")
# How complete the sentence has to sound. 0.5 is the model's own operating
# point; it is NOT tuned for this kitchen yet, and the trace line below is what
# it should be tuned from — the same way SPEECH_ON was.
SMART_TURN_ON = float(os.environ.get("SMART_TURN_ON", "0.5"))
# Don't ask until the room has actually gone quiet for a beat. Asking during
# speech wastes the inference; asking after one silent frame asks about a comma.
SMART_AFTER_MS = int(os.environ.get("SMART_AFTER_MS", "240"))
# And don't ask on every frame after that. 160 ms = every other frame.
SMART_EVERY_MS = int(os.environ.get("SMART_EVERY_MS", "160"))
# ⚠ THIS IS THE KNOB THAT MAKES THE FEATURE TWO-SIDED, and the one that can cost
# something. With it at TRAIL_SILENCE_MS the model can only ever end a turn
# EARLIER than today — strictly safe, and strictly half the value, because the
# mid-sentence pause is still clipped at 800 ms. Above it, a turn the model says
# is unfinished is given longer. MAX_UTTER_MS still caps everything, so the
# worst case is the 8 s that already exists.
SMART_TRAIL_MAX_MS = int(os.environ.get("SMART_TRAIL_MAX_MS", "2000"))
# Rollback with no deploy: a drop-in beside the two already on the G11 —
#   /etc/systemd/system/voice-agent.service.d/capture-vad.conf
#   [Service]
#   Environment=CAPTURE_VAD=rms
# One summary line per capture, always. The barge-in note below records what it
# costs to have a loop that "logs when it acts and says nothing when it does
# not": an owner report that could be neither confirmed nor denied.
CAPTURE_TRACE = os.environ.get("CAPTURE_TRACE", "1") == "1"

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
    # bufsize=0 so stdout is a raw FileIO holding no bytes of its own. drain()
    # below reads the pipe directly through the fd, and it can only be trusted
    # to have emptied it if Python is not also sitting on a buffer of its own.
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=0)


def read_frame(proc):
    """One 80 ms frame, assembled across short reads.

    Unbuffered reads return whatever the pipe has, which is often less than a
    full frame. The old version treated that as end-of-stream and restarted
    arecord — so this loop is not just bufsize bookkeeping, it removes a
    spurious restart. Only a genuine EOF (empty read) ends the stream.
    """
    global _last_frame_at
    want = FRAME * 2  # int16 -> 2 bytes/sample
    buf = b""
    while len(buf) < want:
        chunk = proc.stdout.read(want - len(buf))
        if not chunk:
            return None
        buf += chunk
        # Liveness is stamped per CHUNK, not per frame: a stream dribbling
        # half-frames is still a stream, and the watchdog below must not shoot
        # it. Both callers of read_frame go through here, so the wake loop and
        # capture_utterance keep one clock between them.
        _last_frame_at = time.monotonic()
    return np.frombuffer(buf, dtype=np.int16)


# ── The capture watchdog ─────────────────────────────────────────────────────
# ⚠⚠ THE HOUSE WENT DEAF ON 2026-08-15 AND NOTHING NOTICED BUT THE OWNER.
# arecord stopped delivering while the service stayed `active`, NRestarts=0, the
# device still held (`Subdevices: 0/1`), the mixer still 77% unmuted, and the
# journal completely silent. `/api/voice/ambient` was the only thing that knew:
# `lastDb` pinned at -4.6 across reads three seconds apart, where a healthy
# kitchen floor is about -31. openWakeWord cannot score a wake on that, so every
# "hey mycroft" simply vanished. A restart fixed it in seconds — the cost was
# entirely in the fifteen minutes before a person thought to ask.
#
# The gap: the ONLY recovery path was EOF. `read_frame` returns None, the loop
# logs "mic stream ended" and rebuilds the stream. A pipe that stops WITHOUT
# closing never reaches that line — `proc.stdout.read()` simply blocks forever
# and the whole loop freezes, ambient relay included.
#
# So this thread does not invent a second recovery. It kills arecord, which
# turns a silent stall into the EOF the existing path already handles well.
#
# ⚠ THE THRESHOLD IS NOT "how long is too long to wait for audio". It is "how
# long may the main loop legitimately go WITHOUT CALLING read_frame", and that
# is bounded by the STT round trip — `transcribe()` allows 30 s. Anything at or
# under that shoots the microphone in the middle of a slow but working turn.
# 45 s leaves headroom above it and still recovers ~20x faster than a person.
FRAME_STALL_S = float(os.environ.get("FRAME_STALL_S", "45"))

_last_frame_at = time.monotonic()
_capture = {"proc": None}


def start_capture():
    """Open the mic and hand the watchdog the process to shoot if it stalls."""
    global _last_frame_at
    proc = arecord_stream()
    _capture["proc"] = proc
    _last_frame_at = time.monotonic()   # a fresh stream starts with a clean clock
    return proc


def _capture_watchdog():
    # ⚠ `global` is load-bearing, not tidiness: this function both READS and
    # ASSIGNS _last_frame_at, and without it Python makes the name local for
    # the whole body — so the read below would raise UnboundLocalError on the
    # very first pass and the watchdog would die silently in its own thread,
    # leaving exactly the unsupervised capture it exists to supervise.
    global _last_frame_at
    while True:
        time.sleep(3)
        idle = time.monotonic() - _last_frame_at
        if idle < FRAME_STALL_S:
            continue
        proc = _capture.get("proc")
        log(f"⚠ mic delivered nothing for {idle:.0f}s — killing arecord so the "
            f"reader sees EOF and restarts it")
        # Stamped BEFORE the kill: read_frame is blocked and cannot stamp it
        # itself, and without this the next pass would fire again while the
        # main loop is still rebuilding the stream.
        _last_frame_at = time.monotonic()
        try:
            if proc:
                proc.kill()
                # ⚠ REAPED, not merely killed. Measured on the first live test:
                # without this the dead arecord sat as a `Z` for over a minute.
                # CPython does eventually reap through Popen housekeeping, but
                # "eventually" is not a property to rely on in a process that
                # runs for weeks and restarts its child every time the mic
                # hiccups. wait() makes the reap part of the restart.
                proc.wait(timeout=2)
        except Exception as e:                      # never take the agent down
            log("watchdog could not kill arecord:", e)


def drain(proc):
    """Throw away everything arecord buffered while we were not reading it.

    STT is a 2-9 second round trip and arecord does not pause for it — the
    `overrun!!!` lines in the journal are that pipe backing up. Whatever is
    sitting in it is seconds stale by the time the loop resumes, and reading it
    as though it were live is how one capture on 2026-08-09 transcribed the
    user's own wake word followed by the dashboard's reply to it.

    Returns seconds discarded, for the log.
    """
    fd = proc.stdout.fileno()
    dropped = 0
    while True:
        ready, _, _ = select.select([fd], [], [], 0)
        if not ready:
            break
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        dropped += len(chunk)
    return dropped / 2 / RATE


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


# ── Ambient relay ────────────────────────────────────────────────────────────
# Same drop-on-full discipline as the level relay, and for the same reason: the
# wake loop is timing-critical and a blocking POST in it trades a working
# microphone for a presence cue.
#
# The value sent is the PEAK of the second, not the mean. A mean over 12 frames
# buries a short sentence in the surrounding room tone, which is exactly the
# event we are trying to see.
#
# ── WHY A SPEECH PROBABILITY AND NOT JUST LOUDNESS ───────────────────────────
# Loudness was tried first and MEASURED AGAINST THIS KITCHEN on 2026-08-09. It
# does not work here, and no threshold fixes it: a real conversation sat 2.2 dB
# above the adaptive floor at the median and 7.7 dB at its loudest, while the
# EMPTY room reached 6.5 dB on its own. The distributions overlap. Room tone is
# ~-30 dBFS because capture gain is +22.5 dB, and the mic ("MUSIC-BOOST")
# compresses, so a 6x louder stimulus moved the reading about 2 dB — speech has
# nowhere left to excurse to.
#
# The wake word works fine at 0.70 in that same room, which is the clue: it
# classifies SPECTRALLY. A level meter cannot see what a speech model can. So we
# report silero's speech probability, which is already bundled inside the
# installed openWakeWord — no new dependency, no new listener, still one float.
# Measured cost: 0.61 ms/frame (0.76% of one core) against the wake model's
# 4.23 ms already being spent. It rounds to nothing.
#
# rms is still sent alongside it, deliberately: it costs nothing, it keeps the
# two statistics comparable on identical audio, and the loudness numbers remain
# the diagnostic baseline that justified the switch.
_ambient_q = queue.Queue(maxsize=1)
_ambient_peak = 0
_ambient_speech_peak = 0.0
_ambient_last = 0.0

# 1280-sample frames, so 640 gives exactly 2 onnx passes and is the even divisor
# nearest silero's canonical 512. 320 also divides evenly and costs 68% more for
# no measured benefit.
VAD_FRAME_SIZE = int(os.environ.get("VAD_FRAME_SIZE", "640"))
VAD_ENABLED = os.environ.get("VAD_ENABLED", "1") == "1"
_vad = None


def _init_vad():
    """Load silero from openWakeWord's own bundle. Failure must never be fatal:
    a missing VAD costs presence, and a crashed agent costs the wake word."""
    global _vad
    # ⚠ NOT `and AMBIENT_ENABLED` any more. The capture loop can now endpoint on
    # this, so tying it to the presence relay would mean switching off a cosmetic
    # feature silently changed how the microphone decides you stopped talking.
    if not (VAD_ENABLED and (AMBIENT_ENABLED or CAPTURE_VAD == "speech")):
        return
    try:
        import numpy as _np  # noqa: F401  (already a hard dep of openwakeword)
        from openwakeword.vad import VAD
        _vad = VAD()
        log(f"vad on → silero speech probability, frame_size {VAD_FRAME_SIZE}")
    except Exception as exc:  # pragma: no cover - environment-dependent
        _vad = None
        log(f"vad unavailable, falling back to loudness only: {exc}")


def _speech_probability(frame):
    """⚠ Fed EVERY frame, including while the house is speaking, and that is
    deliberate. Silero is RECURRENT (h/c LSTM state); skipping frames to save
    work hands it discontinuous audio, and this project has already been bitten
    once by assuming a model's internal buffers can be cheaply reset —
    openWakeWord's reset() left a 2.4 s ring and a (120,96) feature buffer
    intact, and the house answered its own voice for it. Keep the stream
    continuous and let the SERVER drop the samples it must not count."""
    if _vad is None:
        return 0.0
    try:
        import numpy as np
        return float(_vad.predict(np.frombuffer(frame, dtype="<i2"),
                                  frame_size=VAD_FRAME_SIZE))
    except Exception:
        return 0.0


# ── The turn model ───────────────────────────────────────────────────────────
# ⚠⚠ THE INPUT IS NOT AUDIO. Smart Turn v3's backbone is a Whisper Tiny encoder,
# so the ONNX takes `input_features` of shape (1, 80, 800) — an 80-bin log-mel
# spectrogram over the last 8 s at hop 160 — and returns ONE sigmoid probability
# in a tensor confusingly named `logits`. Introspected from the real file on the
# G11, 2026-08-22; the published docs said (1, 80, 3000), which is Whisper's 30 s
# default and is not what this export wants.
#
# The reference implementation gets its features from transformers'
# WhisperFeatureExtractor. That is NOT a dependency this process can afford — it
# is the one whose failure means a deaf house, and transformers pulls
# huggingface_hub, tokenizers and safetensors behind it for what is, at bottom,
# an STFT and a matrix multiply. So the mel is computed here in numpy, which is
# already a hard dependency, against a filterbank exported ONCE from the
# reference extractor and shipped beside the model.
#
# ⚠ THAT SUBSTITUTION IS VERIFIED, NOT ASSUMED. tools/voice-agent/st_verify.py
# reproduces WhisperFeatureExtractor to a worst case of 8.3e-07 across four
# signals, and the model's own output to 5e-07. A silently-wrong filterbank
# would give a model that runs and returns plausible nonsense, which is worse
# than one that does not load — so it was checked numerically before trusting.
SMART_TURN_FILTERS = os.environ.get(
    "SMART_TURN_FILTERS",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "mel_filters_80.npy"))
# MEASURED on the G11, 2026-08-22, and the vendor's "12 ms on CPU" does not hold
# here: 194 ms at 1 thread, 117 at 2, 89.5 at 4, 114 at 8. Four is the floor and
# eight is worse — the identical shape kokoro and CTranslate2 both showed on this
# box. onnxruntime otherwise defaults to ALL cores, which is the real hazard.
SMART_TURN_THREADS = int(os.environ.get("SMART_TURN_THREADS", "4"))

N_FFT, HOP_LENGTH = 400, 160            # Whisper tiny's frontend
MEL_SAMPLES = 8 * RATE                  # the 8 s window the export is fixed to
MEL_FRAMES = MEL_SAMPLES // HOP_LENGTH  # 800

_turn = None
_turn_filters = None
_turn_logged = False      # see the except in _turn_probability


def _init_turn():
    if CAPTURE_VAD != "smart":
        return
    if not SMART_TURN_MODEL_PATH:
        log("⚠ CAPTURE_VAD=smart but SMART_TURN_MODEL_PATH is unset — "
            "endpointing stays on silero")
        return
    global _turn, _turn_filters
    try:
        import onnxruntime as ort
        _turn_filters = np.load(SMART_TURN_FILTERS)
        if _turn_filters.shape != (N_FFT // 2 + 1, 80):
            raise ValueError(f"mel filterbank is {_turn_filters.shape}, expected "
                             f"{(N_FFT // 2 + 1, 80)}")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = SMART_TURN_THREADS
        opts.inter_op_num_threads = 1
        session = ort.InferenceSession(SMART_TURN_MODEL_PATH, sess_options=opts,
                                       providers=["CPUExecutionProvider"])
        shape = session.get_inputs()[0].shape
        # The batch axis is symbolic; the two that carry meaning are not. A model
        # whose mel geometry differs from the one computed below would return
        # confident nonsense rather than fail, so it is refused here instead.
        if list(shape[1:]) != [80, MEL_FRAMES]:
            raise ValueError(f"model wants {shape}, this binding produces "
                             f"(1, 80, {MEL_FRAMES})")
        _turn = session
        threading.Thread(target=_turn_worker, daemon=True).start()
        log(f"turn model on → {os.path.basename(SMART_TURN_MODEL_PATH)} "
            f"{shape} × {SMART_TURN_THREADS} threads (complete ≥ {SMART_TURN_ON})")
    except Exception as exc:  # pragma: no cover - environment-dependent
        _turn = None
        log(f"turn model unavailable, endpointing stays on silero: {exc}")


# Periodic Hann, matching transformers' window_function(400, "hann").
_HANN = np.hanning(N_FFT + 1)[:-1].astype(np.float32)


def _turn_features(pcm):
    """int16 audio → (1, 80, 800) log-mel, the reference pipeline exactly.

    The ORDER is load-bearing and was read off the reference rather than guessed:
    keep the LAST 8 s, normalise to zero mean / unit variance over the REAL
    samples only, right-pad the remainder with silence, then the spectrogram.
    Normalising after padding would fold the padding into the statistics and
    shift every value in the window.
    """
    audio = pcm[-MEL_SAMPLES:].astype(np.float32) / 32768.0
    audio = (audio - audio.mean()) / np.sqrt(audio.var() + 1e-7)
    if len(audio) < MEL_SAMPLES:
        audio = np.concatenate([audio, np.zeros(MEL_SAMPLES - len(audio), np.float32)])
    pad = N_FFT // 2
    padded = np.pad(audio, (pad, pad), mode="reflect")
    frames = 1 + (len(padded) - N_FFT) // HOP_LENGTH
    idx = np.arange(N_FFT)[None, :] + HOP_LENGTH * np.arange(frames)[:, None]
    power = np.abs(np.fft.rfft(padded[idx] * _HANN, n=N_FFT, axis=1)) ** 2
    mel = np.log10(np.maximum(1e-10, power @ _turn_filters)).T[:, :-1]
    mel = np.maximum(mel, mel.max() - 8.0)
    return ((mel + 4.0) / 4.0).astype(np.float32)[None, :, :]


def _turn_probability(pcm):
    """P(the speaker has finished), or None when the model has no opinion.

    None is a real answer and every caller treats it as KEEP WAITING — an
    inference that raised must never be read as a completed sentence, because
    that direction cuts people off, which is the defect this exists to fix.
    """
    if _turn is None or _turn_filters is None:
        return None
    try:
        out = _turn.run(None, {"input_features": _turn_features(pcm)})[0]
        value = float(np.asarray(out).ravel()[0])
        # Already a sigmoid despite the tensor being named `logits` — measured,
        # four signals came back in 0.79-0.99. The squash below is the guard for
        # an export that is not, so a future model cannot be read on a scale it
        # was never on.
        return value if 0.0 <= value <= 1.0 else float(1.0 / (1.0 + np.exp(-value)))
    except Exception as exc:  # pragma: no cover - environment-dependent
        # ⚠ ONCE PER PROCESS, not once per call. A binding that does not fit the
        # export would otherwise write an identical line on every ask, for weeks,
        # burying the wake and capture lines this journal exists to carry. The
        # trace line's `asks=0` is what reports it is still happening.
        global _turn_logged
        if not _turn_logged:
            _turn_logged = True
            log(f"⚠ turn inference failed — endpointing falls back to silence "
                f"for the rest of this run: {exc}")
        return None


# ── Asking without stopping to listen ────────────────────────────────────────
# ⚠⚠ THE INFERENCE IS LONGER THAN A FRAME, SO IT CANNOT BE INLINE. Measured on
# the G11: 89.5 ms at four threads, against the 80 ms of audio this loop has to
# collect on time. A blocking call would stretch every frame it landed in, drift
# the trailing-silence count it exists to improve, and back arecord's pipe up —
# the `overrun!!!` that drain() above is the cleanup for.
#
# So the ask goes to a worker and the loop keeps reading frames. The answer
# lands a frame or two later, which costs almost nothing: the decision arrives
# at about SMART_AFTER_MS + 100 ms ≈ 340 ms, against the 800 ms it replaces.
#
# Same discipline as the level and ambient relays — depth-1 queue, drop when
# full — and for the same stated reason. `gen` is what keeps a late answer from
# a finished capture out of the next one: a reply whose generation does not
# match the capture that asked for it is discarded rather than acted on.
_turn_q = queue.Queue(maxsize=1)
_turn_result = queue.Queue(maxsize=1)
_turn_seq = 0


def _turn_worker():
    while True:
        ask, pcm = _turn_q.get()
        p = _turn_probability(pcm)
        if p is None:
            continue          # no opinion; the capture keeps waiting on its own
        try:
            _turn_result.put_nowait((ask, p))
        except queue.Full:
            pass              # nobody collected the last one; move on


def turn_submit(pcm):
    """Non-blocking. Returns an ask id, or None when one is already in flight."""
    global _turn_seq
    _turn_seq += 1
    try:
        _turn_q.put_nowait((_turn_seq, pcm))
        return _turn_seq
    except queue.Full:
        return None


def turn_poll(ask):
    """The answer to THAT ask, or None. Never blocks, and never guesses.

    ⚠ THE ID CHECK IS NOT BOOKKEEPING. An answer is a claim about audio ending
    at the moment it was asked, and two things can make it stale before it
    lands: the capture ended, or — the one that would actually bite — the person
    started talking again. An answer from before they resumed says "that was the
    end" about a sentence that has since continued, and acting on it is the
    clipping bug arriving through the back door. The caller drops its id the
    instant a voiced frame appears, so a late reply matches nothing and is
    discarded here.
    """
    try:
        answered, p = _turn_result.get_nowait()
    except queue.Empty:
        return None
    return p if ask is not None and answered == ask else None


def _ambient_worker():
    while True:
        payload = _ambient_q.get()
        try:
            _post(AMBIENT_URL, json.dumps(payload).encode(),
                  "application/json", 2)
        except (urllib.error.URLError, OSError, ValueError):
            pass  # the dashboard may be restarting; the mic must not care


def ambient_tick(frame):
    """Called for EVERY frame of the wake loop. Cheap by construction."""
    global _ambient_peak, _ambient_speech_peak, _ambient_last
    if not AMBIENT_ENABLED:
        return
    value = rms(frame)
    if value > _ambient_peak:
        _ambient_peak = value
    speech = _speech_probability(frame)
    if speech > _ambient_speech_peak:
        _ambient_speech_peak = speech
    now = time.time()
    if now - _ambient_last < AMBIENT_PERIOD_S:
        return
    _ambient_last = now
    try:
        _ambient_q.put_nowait({"rms": _ambient_peak,
                               "speech": round(_ambient_speech_peak, 3)})
    except queue.Full:
        pass
    _ambient_peak = 0
    _ambient_speech_peak = 0.0


def capture_utterance(proc):
    """Capture until the person stops talking — or until it is clear they never
    started.

    ⚠ SILERO IS FED EVERY FRAME HERE, and that is a fix rather than a cost. This
    loop has always had its own reader and has never called ambient_tick(), so
    the VAD saw NOTHING for the whole of every capture — precisely the
    discontinuity its own docstring warns about, on the recurrent state, at the
    only moment anyone is actually speaking. Scoring here makes the stream
    continuous again. Measured cost is 0.61 ms/frame against 80 ms of audio.
    """
    frames, speech_frames, trail = [], 0, 0.0
    start = time.time()
    trail_limit = TRAIL_SILENCE_MS / 1000.0
    lead_limit = LEAD_SILENCE_MS / 1000.0
    # ⚠ FAIL BACK TO LOUDNESS IF SILERO IS NOT LOADED. A missing VAD scores every
    # frame 0.0, which under speech endpointing means "nobody ever spoke" — the
    # house would go deaf rather than degrade. A dead mic is the one failure this
    # agent must never choose.
    use_speech = CAPTURE_VAD in ("speech", "smart") and _vad is not None
    # ⚠ `and use_speech`, not just `_turn is not None`. Smart Turn is only ever
    # ASKED once the cheap gate says the room has gone quiet, so without silero
    # there is no trailing window to ask about and the mode has to collapse all
    # the way back to loudness rather than half-way.
    use_smart = CAPTURE_VAD == "smart" and _turn is not None and use_speech
    smart_after = SMART_AFTER_MS / 1000.0
    smart_every = SMART_EVERY_MS / 1000.0
    smart_trail_max = max(SMART_TRAIL_MAX_MS, TRAIL_SILENCE_MS) / 1000.0
    turn_p, turn_asks, last_ask, ask = None, 0, 0.0, None
    peak_speech, peak_rms, trace = 0.0, 0, []
    ended = "eof"

    while True:
        f = read_frame(proc)
        if f is None:
            break
        frames.append(f)
        level = rms(f)
        send_level(level)          # non-blocking; drops rather than delays
        # Scored whenever the VAD exists, not only when it decides, so the trace
        # can be read against a capture the OLD rule made — which is the whole
        # point of shipping this before the threshold is chosen.
        speech = _speech_probability(f) if _vad is not None else 0.0
        if speech > peak_speech:
            peak_speech = speech
        if level > peak_rms:
            peak_rms = level
        if CAPTURE_TRACE and len(trace) < 150:
            trace.append(f"{int(level)}:{speech:.2f}")

        voiced = speech >= SPEECH_ON if use_speech else level >= SILENCE_RMS
        if voiced:
            speech_frames += 1
            trail = 0.0
            # They are talking again, so any answer still in flight is about an
            # ending that did not happen. Dropping the id is what makes it
            # unclaimable — see turn_poll.
            ask = None
        elif speech_frames >= MIN_SPEECH_FRAMES:
            trail += FRAME / RATE
            if use_smart:
                now = time.time()
                if trail >= smart_after and (now - last_ask) >= smart_every:
                    # np.concatenate copies, which is what makes handing this to
                    # another thread safe while the loop keeps appending.
                    fresh = turn_submit(np.concatenate(frames))
                    if fresh is not None:
                        ask, last_ask = fresh, now
                        turn_asks += 1
                # Polled every frame, not only after an ask: the answer arrives
                # a frame or two later and this is where it is collected.
                p = turn_poll(ask)
                # None means no answer yet, or no opinion. Either way it is KEEP
                # WAITING, never "finished" — a failed or missing inference that
                # ended the turn would cut people off, which is the exact defect
                # this branch exists to remove.
                if p is not None:
                    turn_p = p
                    ask = None
                    if p >= SMART_TURN_ON:
                        ended = "smart"
                        break
                # The hard bound on being told to wait. Reached when the model
                # keeps saying "not finished" — or when it never answers at all,
                # which is what makes this the fallback as well as the ceiling.
                if trail >= smart_trail_max:
                    ended = "trail"
                    break
            elif trail >= trail_limit:
                ended = "trail"
                break
        elif use_speech and (time.time() - start) >= lead_limit:
            # Nothing has arrived YET. This is the branch the old loop did not
            # have, and the reason a silent wake cost the full 8 s: `trail` is
            # gated behind speech_frames, so with nobody talking it never starts.
            ended = "lead"
            break

        if (time.time() - start) * 1000 >= MAX_UTTER_MS:
            ended = "cap"
            break

    took = int((time.time() - start) * 1000)
    heard = speech_frames >= MIN_SPEECH_FRAMES
    if CAPTURE_TRACE:
        # ⚠ `turn=` IS THE WHOLE POINT OF SHIPPING THIS BEFORE THE THRESHOLD IS
        # CHOSEN, exactly as the speech column was. `asks` beside it is the
        # discriminator that a probability alone cannot give: `turn=0.31 asks=0`
        # means the model was never consulted (a binding that does not fit the
        # export, or silence that never reached SMART_AFTER_MS), which reads
        # identically to a model that is working and unconvinced.
        smart = ""
        if use_smart:
            seen = f"{turn_p:.2f}" if turn_p is not None else "-"
            smart = f" turn={seen} asks={turn_asks}"
        log(f"capture {took}ms ended={ended} "
            f"by={'smart' if use_smart else 'speech' if use_speech else 'rms'} "
            f"frames={len(frames)} voiced={speech_frames} kept={heard} "
            f"peak_rms={peak_rms} peak_speech={peak_speech:.2f}{smart}")
        log(f"  trace rms:speech {' '.join(trace)}")
    if not heard:
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
    """Text, "" when the STT heard nothing, or None when it could not be asked.

    The caller only needs truthiness to decide the turn is over — but the two
    falsy answers are different facts about the house and the wall reports them
    with different reasons, so they must not collapse into one empty string."""
    try:
        return (_post(STT_URL, wav, "audio/wav", 30).get("text") or "").strip()
    except (urllib.error.URLError, OSError, ValueError) as e:
        log("STT unreachable — dropping turn:", e)
        return None


def forward(text):
    try:
        _post(DASH_URL, json.dumps({"text": text}).encode(), "application/json", 5)
    except (urllib.error.URLError, OSError, ValueError) as e:
        log("dashboard forward failed:", e)


def report_unheard(reason):
    """Tell the wall the wake went nowhere.

    The dashboard cannot work this out for itself. Everything that can swallow a
    turn — the VAD hearing no speech, whisper returning nothing, whisper being
    unreachable, a barge-in that never got the floor — happens on THIS side of
    the transcript POST, so from the page's side the wake and the silence that
    followed it are literally indistinguishable from an idle room. Without this
    the house has exactly one failure it can show, and every other kind of miss
    looks like a broken screen.

    Blocking, like forward() and for the same reason: it runs only on the slow
    path after a turn is already over, never in the 80 ms capture loop. Fire and
    forget beyond that — a dashboard that is down must never cost the mic its
    rearm.
    """
    try:
        _post(UNHEARD_URL, json.dumps({"reason": reason}).encode(),
              "application/json", 2)
    except (urllib.error.URLError, OSError, ValueError) as e:
        log("unheard report failed:", e)


# ── Is the house speaking? ───────────────────────────────────────────────────
# One long-lived SSE connection on a daemon thread, not a poll: the capture loop
# needs this answer every 80 ms and cannot afford a request to find it out. The
# flag defaults to CLEAR on every failure path — a dashboard that is down, a
# stream that drops, a flag that is off all mean "not speaking", which is the
# agent's pre-existing behaviour. Half duplex degrades to full duplex; it never
# degrades to a deaf microphone.
_speaking = threading.Event()


def _speaking_watcher():
    while True:
        try:
            req = urllib.request.Request(SPEAKING_URL, headers={"Accept": "text/event-stream"})
            with urllib.request.urlopen(req, timeout=None) as stream:
                log("half duplex: subscribed to the dashboard's speaking state")
                event = None
                for raw in stream:
                    line = raw.decode("utf-8", "replace").strip()
                    if line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:") and event == "voice_speaking":
                        try:
                            on = json.loads(line[5:].strip()).get("speaking") is True
                        except ValueError:
                            on = False
                        _speaking.set() if on else _speaking.clear()
                    elif not line:
                        event = None
        except (urllib.error.URLError, OSError, ValueError) as e:
            log("speaking stream lost:", e)
        # The dashboard restarts on every deploy. Never hold a stale "it is
        # talking" across the gap or the mic goes silent until the next reply.
        _speaking.clear()
        time.sleep(3)


def barge_in():
    """Ask the dashboard to stop talking. Fire and forget by design — if the
    request fails we still fall through to the wait below, which times out and
    abandons the turn rather than capturing over a voice we could not stop."""
    try:
        _post(BARGE_URL, b"{}", "application/json", 2)
    except (urllib.error.URLError, OSError, ValueError) as e:
        log("barge-in request failed:", e)


def wait_for_quiet(timeout_ms):
    """Block until playback actually stops. Returns False on timeout."""
    deadline = time.time() + timeout_ms / 1000.0
    while _speaking.is_set():
        if time.time() >= deadline:
            return False
        time.sleep(0.02)
    return True


# ── Detector flush ───────────────────────────────────────────────────────────
# Model.reset() is NOT a reset. Measured against the installed openwakeword on
# 2026-08-09:
#
#     feature_buffer survives reset(): True (120, 96)
#     melspec survives reset():        True
#     raw audio survives reset():      True (38400,) = 2.4 s
#     prediction_buffer cleared:       True
#
# It empties the prediction deque and nothing else; there is no
# AudioFeatures.reset() to call. Because predict() is never called during a
# capture, the classification window stays FROZEN on the wake word that started
# it — so the first predict() after the turn re-scores the same audio and fires
# again. That is the whole signature in the logs: genuine wakes score 0.67-0.93,
# every self-retrigger scored 0.99-1.00, because it was the model's own peak
# handed back to it.
#
# The pristine buffers are snapshotted once at startup rather than rebuilt,
# because feature_buffer is initialised by embedding ten seconds of silence —
# cheap once, absurd per turn. Zeroing is not equivalent: the embedding of
# silence is not a zero vector, and a zeroed window scores unpredictably.
_pristine = {}


def snapshot_detector(oww):
    pre = getattr(oww, "preprocessor", None)
    if pre is None:
        return
    _pristine["melspectrogram_buffer"] = np.array(pre.melspectrogram_buffer, copy=True)
    _pristine["feature_buffer"] = np.array(pre.feature_buffer, copy=True)


def reset(oww):
    """Return the detector to its cold-start state, for real."""
    fn = getattr(oww, "reset", None)
    if callable(fn):
        fn()
    pre = getattr(oww, "preprocessor", None)
    if pre is None or not _pristine:
        return
    # Guarded field by field: an openwakeword upgrade that renames a buffer
    # must degrade to the old (buggy) behaviour, never crash the microphone.
    try:
        if hasattr(pre, "raw_data_buffer"):
            pre.raw_data_buffer.clear()
        if hasattr(pre, "melspectrogram_buffer"):
            pre.melspectrogram_buffer = np.array(_pristine["melspectrogram_buffer"], copy=True)
        if hasattr(pre, "feature_buffer"):
            pre.feature_buffer = np.array(_pristine["feature_buffer"], copy=True)
        if hasattr(pre, "accumulated_samples"):
            pre.accumulated_samples = 0
    except (AttributeError, KeyError, TypeError) as e:
        log("detector flush degraded:", e)


def rearm(oww, proc, why):
    """Drop stale audio, then cold-start the detector. Order matters: draining
    after the flush would leave the discarded seconds already inside it."""
    seconds = drain(proc)
    reset(oww)
    if seconds >= 0.1:
        log(f"rearm ({why}) — dropped {seconds:.1f}s of stale audio")


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
    # Snapshot BEFORE any room audio has been through the model — this is the
    # only moment its buffers are genuinely pristine, and every later flush
    # restores from here.
    snapshot_detector(oww)
    reset(oww)
    log(f"listening on {MIC} for '{WAKE_MODEL}' [{wake_key}] (threshold {WAKE_THRESHOLD})")

    if PROBE_ONLY:
        log(f"PROBE mode — logging runs above {PROBE_FLOOR}, capturing nothing")

    if LEVEL_ENABLED:
        # daemon=True so a stuck POST can never keep the agent alive on shutdown
        threading.Thread(target=_level_worker, daemon=True).start()
        log(f"level relay on → {LEVEL_URL}")

    # ⚠ MOVED OUT OF THE `if AMBIENT_ENABLED` BLOCK, which is a fix rather than
    # tidying. _init_vad's own guard already reads
    # `VAD_ENABLED and (AMBIENT_ENABLED or CAPTURE_VAD == "speech")` — it was
    # written to be armable for ENDPOINTING with the presence relay off, for the
    # reason its comment gives: switching off a cosmetic feature must not
    # silently change how the microphone decides you stopped talking. But its
    # only call site was inside the relay's own block, so that second arm was
    # unreachable. Dormant (AMBIENT_ENABLED defaults to 1) and now closed —
    # third time in this repo that a guard has been stricter than the call site
    # that feeds it.
    _init_vad()
    # Endpointing, not telemetry, so it sits beside the VAD and not beside the
    # relay. Loaded ONCE at startup, never per capture: this process runs for
    # weeks and its failure mode is a house that cannot hear.
    _init_turn()

    if AMBIENT_ENABLED:
        threading.Thread(target=_ambient_worker, daemon=True).start()
        log(f"ambient relay on → {AMBIENT_URL} every {AMBIENT_PERIOD_S}s")

    if HALF_DUPLEX:
        threading.Thread(target=_speaking_watcher, daemon=True).start()
        log(f"half duplex on → {SPEAKING_URL} (barge-in ≥{BARGE_THRESHOLD} × {BARGE_FRAMES} frames)")

    proc = start_capture()
    threading.Thread(target=_capture_watchdog, daemon=True).start()
    log(f"capture watchdog on → restart the mic after {FRAME_STALL_S:.0f}s of silence on the pipe")
    run = []
    held = 0          # consecutive above-barge-threshold frames while speaking
    barge_peak = 0.0  # best wake score heard during the reply now playing
    was_speaking = False
    try:
        while True:
            frame = read_frame(proc)
            if frame is None:
                log("mic stream ended; restarting arecord")
                time.sleep(1)
                proc = start_capture()
                reset(oww)
                continue
            # Before the wake check, and unconditionally: presence is a fact
            # about the room, not about whether anyone said the wake word.
            ambient_tick(frame)
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

            # The falling edge of a reply. One line per reply, and only when
            # something wake-shaped was actually heard during it (PROBE_FLOOR,
            # the same floor the probe mode uses), so a quiet room through a
            # long briefing costs nothing at all. This is the whole diagnostic:
            # "it kept talking when I said the wake word" becomes a number.
            speaking_now = _speaking.is_set()
            if was_speaking and not speaking_now:
                if barge_peak >= PROBE_FLOOR:
                    log(f"reply ended — wake peaked {barge_peak:.2f} while speaking, "
                        f"needed {BARGE_THRESHOLD:.2f} x {BARGE_FRAMES} frames")
                barge_peak = 0.0
            was_speaking = speaking_now

            if speaking_now:
                # HALF DUPLEX. The mic can hear the HDMI speakers, so anything
                # captured here would be the house's own reply — which is
                # exactly what it spent 2026-08-08 answering. A wake word during
                # playback therefore does ONE thing: take the floor back.
                #
                # ⚠⚠ THIS BRANCH WAS SILENT ABOUT ITS OWN FAILURES until
                # 2026-08-15, and that is why the owner's report — "it kept
                # talking even when I said the wake word" — could not be
                # confirmed OR denied from this journal. It logs when it acts
                # and says nothing when it does not, so a wake word that peaked
                # at 0.65 through the speakers left no trace whatsoever. One
                # barge-in has fired in this agent's whole life (0.99, Aug 09)
                # against 43 ordinary wakes.
                #
                # The bar here is also HIGHER than the ordinary one — 0.70 for
                # two consecutive frames versus 0.60 for one — in the acoustic
                # condition that makes the score WORSE, because the model is
                # listening through our own voice. That asymmetry is backwards:
                # the moment a person most needs to be heard is the moment the
                # house is talking over them. Do not re-tune it from a guess.
                # The line below is what turns the next spoken attempt into a
                # number, and the number is what the threshold should come from.
                barge_peak = max(barge_peak, score)
                held = held + 1 if score >= BARGE_THRESHOLD else 0
                if held < BARGE_FRAMES:
                    continue
                held = 0
                log(f"WAKE ({score:.2f}) while speaking — taking the floor")
                barge_in()
                if not wait_for_quiet(BARGE_WAIT_MS):
                    # It would not stop. Capturing anyway just feeds it its own
                    # voice again, which is the bug, so abandon the turn.
                    log("playback did not stop — abandoning the turn")
                    report_unheard("barge-in-timeout")
                    rearm(oww, proc, "barge-in timeout")
                    continue
                time.sleep(BARGE_SETTLE_MS / 1000.0)
                rearm(oww, proc, "barge-in")
            elif score >= WAKE_THRESHOLD:
                held = 0
                log(f"WAKE ({score:.2f}) — capturing…")
            else:
                held = 0
                continue

            pcm = capture_utterance(proc)
            # The turn is over: drop the rim now rather than leaving the
            # client's decay to guess. Cheap, and it makes "I have stopped
            # listening" a fact the room can see instead of an inference.
            send_level(0)
            if pcm is None:
                log("no speech after wake")
                report_unheard("no-speech")
                rearm(oww, proc, "no speech")
                continue
            text = transcribe(to_wav(pcm))
            if not text:
                log("empty transcript")
                # Log line deliberately unchanged — it is what the journal
                # recipe greps for. The distinction rides the reason instead.
                report_unheard("stt-unreachable" if text is None else "empty-transcript")
                rearm(oww, proc, "empty transcript")
                continue
            log("heard:", repr(text))
            forward(text)
            time.sleep(COOLDOWN_S)
            # Rearm AFTER the cooldown, not before: the seconds spent in STT and
            # in the sleep are precisely the seconds arecord was filling the
            # pipe behind our back, and the detector is still holding the wake
            # word that opened this turn.
            rearm(oww, proc, "turn complete")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
