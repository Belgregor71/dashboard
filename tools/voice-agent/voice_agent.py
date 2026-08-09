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
SPEAKING_URL, BARGE_URL, BARGE_THRESHOLD, BARGE_FRAMES.
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
    want = FRAME * 2  # int16 -> 2 bytes/sample
    buf = b""
    while len(buf) < want:
        chunk = proc.stdout.read(want - len(buf))
        if not chunk:
            return None
        buf += chunk
    return np.frombuffer(buf, dtype=np.int16)


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
# The value sent is the PEAK rms of the second, not the mean. A mean over 12
# frames buries a short sentence in the surrounding room tone, which is exactly
# the event we are trying to see; the floor the server compares against is a
# percentile over minutes, so it is unaffected by using peaks.
_ambient_q = queue.Queue(maxsize=1)
_ambient_peak = 0
_ambient_last = 0.0


def _ambient_worker():
    while True:
        rms_value = _ambient_q.get()
        try:
            _post(AMBIENT_URL, json.dumps({"rms": rms_value}).encode(),
                  "application/json", 2)
        except (urllib.error.URLError, OSError, ValueError):
            pass  # the dashboard may be restarting; the mic must not care


def ambient_tick(frame):
    """Called for EVERY frame of the wake loop. Cheap by construction."""
    global _ambient_peak, _ambient_last
    if not AMBIENT_ENABLED:
        return
    value = rms(frame)
    if value > _ambient_peak:
        _ambient_peak = value
    now = time.time()
    if now - _ambient_last < AMBIENT_PERIOD_S:
        return
    _ambient_last = now
    try:
        _ambient_q.put_nowait(_ambient_peak)
    except queue.Full:
        pass
    _ambient_peak = 0


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

    if AMBIENT_ENABLED:
        threading.Thread(target=_ambient_worker, daemon=True).start()
        log(f"ambient relay on → {AMBIENT_URL} every {AMBIENT_PERIOD_S}s")

    if HALF_DUPLEX:
        threading.Thread(target=_speaking_watcher, daemon=True).start()
        log(f"half duplex on → {SPEAKING_URL} (barge-in ≥{BARGE_THRESHOLD} × {BARGE_FRAMES} frames)")

    proc = arecord_stream()
    run = []
    held = 0          # consecutive above-barge-threshold frames while speaking
    try:
        while True:
            frame = read_frame(proc)
            if frame is None:
                log("mic stream ended; restarting arecord")
                time.sleep(1)
                proc = arecord_stream()
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

            if _speaking.is_set():
                # HALF DUPLEX. The mic can hear the HDMI speakers, so anything
                # captured here would be the house's own reply — which is
                # exactly what it spent 2026-08-08 answering. A wake word during
                # playback therefore does ONE thing: take the floor back.
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
                rearm(oww, proc, "no speech")
                continue
            text = transcribe(to_wav(pcm))
            if not text:
                log("empty transcript")
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
