"""PC-side whisper STT service (Stage B of project-voice-mic-bridge).

The Pi's on-device wake/capture agent POSTs a finished utterance (raw WAV bytes)
to POST /transcribe; this returns the transcript as JSON. faster-whisper runs on
CPU (CTranslate2, no torch) — sub-second for short commands on a Ryzen 5700X.
The model is loaded once at startup and kept warm.

Guardrail (project-voice-mic-bridge): audio only ever reaches here AFTER an
explicit on-device wake; it stays on the home LAN and never touches the cloud.

Run (Windows):  .venv/Scripts/python.exe stt_server.py
Run (Linux):    .venv/bin/python stt_server.py
Config via env: STT_MODEL (base.en), STT_DEVICE (cpu), STT_COMPUTE (int8),
                STT_HOST (0.0.0.0), STT_PORT (8123), STT_BEAM (5),
                STT_CONDITION_PREV, STT_NO_SPEECH, STT_TEMPERATURE,
                STT_HOTWORDS_FILE, STT_SHADOW_MODEL, STT_SHADOW_COMPUTE,
                STT_SHADOW_THREADS, STT_SHADOW_ENGINE, STT_ENGINE,
                STT_MOONSHINE_MODEL.

⚠ EVERY KNOB ADDED AFTER STT_BEAM IS UNSET BY DEFAULT AND ADDS NOTHING TO THE
DECODE CALL WHEN UNSET. That is deliberate: `decode_kwargs()` starts empty and
each env only ever inserts a key, so the default configuration is byte-identical
to the one measured at 1185 ms for 6400 ms of audio on the G11. Anything else
would mean this file silently re-tuned a transcriber that is already the only
thing standing between the room and a deaf house.

Also runs on the kiosk host itself (deploy/voice-stt.service), where it is the
only transcriber rather than a remote one — same speed, always up.

Offline proof for the knobs and the shadow leg: tools/voice-pc/stt_selftest.py.
"""

import inspect
import io
import json
import os
import queue
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Under pythonw.exe (autostart, no console) sys.stdout/stderr are None — route
# the prints below to a logfile so the service still records what it's doing.
#
# ⚠⚠ AND THEN FORCE UTF-8, WHICH IS NOT COSMETIC. This leg runs on WINDOWS,
# where a pipe and a plain-`open` logfile both default to cp1252.
#
# MEASURED 2026-08-22: a new "→" in a startup banner killed this service before
# it listened, and left NOTHING in the log to say why — because the log was the
# thing that could not be written. cp1252 covers more than it looks like it does
# ("…", "—", "°" and curly quotes are all in it), which is precisely why the gap
# is easy to miss until a character outside it lands.
#
# The exposure is not only banners. The hottest print here is `repr()` of
# whatever the room just said, so a transcript outside cp1252 would raise
# UnicodeEncodeError INSIDE do_POST — a 500 on a turn that transcribed perfectly
# well. Not yet sighted with `base.en` English; prevented rather than fixed.
#
# Same trap tools/voice-agent/capture_selftest.py already records, arriving from
# the other direction: there it turned a PASSING run into a traceback.
if sys.stdout is None:
    _log = open(os.path.join(os.path.dirname(__file__), "stt.log"), "a",
                buffering=1, encoding="utf-8", errors="replace")
    sys.stdout = sys.stderr = _log
else:
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 — a stream that cannot be retuned still works
            pass

from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("STT_MODEL", "base.en")
DEVICE = os.environ.get("STT_DEVICE", "cpu")
COMPUTE = os.environ.get("STT_COMPUTE", "int8")
HOST = os.environ.get("STT_HOST", "0.0.0.0")
PORT = int(os.environ.get("STT_PORT", "8123"))
BEAM = int(os.environ.get("STT_BEAM", "5"))
MAX_BYTES = 20 * 1024 * 1024  # 20 MB — a wake-gated command is a few seconds

# ── Decode hardening ─────────────────────────────────────────────────────────
# Two failures on the record, and this transcriber passed `language` and
# `beam_size` and nothing else against either of them:
#
#  1. "is it a good day for hanging the washing out" was heard as "It's at a
#     good day for hanging out the washy." (2026-08-16, live). Haiku answered
#     sensibly anyway, which is exactly why a spoken test FEELS fine while the
#     STT is degraded — a satisfied listener is not an accuracy measurement.
#  2. 3.4 s of pure room tone reached whisper and it HALLUCINATED "Okay."
#     (2026-08-20). One step from acting on a word nobody said.
#
# `condition_on_previous_text` is whisper's classic hallucination source and
# `no_speech_threshold` is the direct guard against (2). Both are LEFT AT THE
# LIBRARY DEFAULT unless the env says otherwise — see the docstring.
#
# ⚠ THE HOTWORDS FILE MUST NOT BE COMMITTED. The nouns worth biasing toward are
# household names, suburbs and room names, and this repo has already shipped a
# street address in the public bundle once (project-commute-address-privacy).
# The path is an env var pointing outside the tree; hotwords.example.txt carries
# the shape with every real particular removed.
CONDITION_PREV = os.environ.get("STT_CONDITION_PREV", "")
NO_SPEECH = os.environ.get("STT_NO_SPEECH", "")
TEMPERATURE = os.environ.get("STT_TEMPERATURE", "")
HOTWORDS_FILE = os.environ.get("STT_HOTWORDS_FILE", "")

# The shadow leg (see shadow_worker below). Unset = the whole feature is absent.
SHADOW_MODEL = os.environ.get("STT_SHADOW_MODEL", "")
SHADOW_COMPUTE = os.environ.get("STT_SHADOW_COMPUTE", COMPUTE)
# ⚠⚠ THE SHADOW MUST NOT STARVE THE LIVE TRANSCRIBER, and "it runs off the
# response path" is not enough on its own. MEASURED 2026-08-22 with three
# back-to-back turns: small.en took 5.9-10.5 s and dragged base.en from its
# usual RTF 0.19 out to 2836 ms for a 2 s clip — because BOTH grab every OMP
# thread and CTranslate2 defaults to all of them.
#
# Turns really do arrive back to back: THREAD_MS keeps a conversation open for
# five minutes and follow-ups are the whole point of it. So the shadow is capped
# here rather than left to compete. Two threads leaves two for the live path,
# where base.en still runs comfortably under real time.
SHADOW_THREADS = int(os.environ.get("STT_SHADOW_THREADS", "2"))

# Which ENGINE the shadow runs. Unset (or "whisper") = faster-whisper, the only
# engine this file knew before 2026-09-15, on the byte-identical code path.
# "moonshine" = moonshine-voice (pip `moonshine-voice`), with STT_SHADOW_MODEL
# naming its arch: tiny · base · tiny-streaming · base-streaming ·
# small-streaming · medium-streaming (underscores accepted too).
# docs/research/FIELD-SCAN.md round 1.
#
# ⚠⚠ MOONSHINE IS FORCED SINGLE-THREADED, AND THE REASON IS MEASURED. Its native
# library exposes no thread count, and left alone ONNX Runtime took ~6.5 of the
# G11's 8 cores — ESCAPING `taskset -c 6,7` too (it pins its own pool). With
# MOONSHINE_ORT_SINGLE_THREAD=1 the same files ran on exactly 1.0 core and were
# NO SLOWER (base RTF 0.11-0.16, small_streaming 0.22-0.36, against whisper
# small.en's 0.41-0.73 on 2 threads — two bundled human recordings, SPEED ONLY).
# The multi-thread default was spinning, and spinning on the box that renders the
# wall. STT_SHADOW_THREADS does not apply to this engine; it is always one core.
SHADOW_ENGINE = os.environ.get("STT_SHADOW_ENGINE", "").strip().lower() or "whisper"

# Which ENGINE answers /transcribe. Unset (or "whisper") = faster-whisper on the
# byte-identical code path. "moonshine" = moonshine-voice answers, with
# STT_MOONSHINE_MODEL naming its arch (same names as the shadow's).
#
# MEASURED 2026-09-16 → 2026-10-09 by the shadow, 49 real turns on the G11:
# 35 same / 14 DIFF against base.en, median 602 ms against 1402 ms. The case for
# the swap is the ~800 ms, NOT accuracy — nobody has ground truth for the 14.
#
# ⚠ WHISPER IS STILL LOADED, AND THAT IS THE POINT. STT_MODEL keeps its meaning
# and stays warm as the fallback: a moonshine that cannot load, or that raises on
# a turn, costs a log line and whisper answers. This file is still the only
# thing standing between the room and a deaf house.
#
# ⚠ THE DECODE KNOBS AND THE HOTWORDS DO NOT REACH MOONSHINE — it takes neither.
# They still shape the whisper leg (fallback and shadow), so /health keeps
# reporting them; with moonshine answering, the household nouns are unbiased.
ENGINE = os.environ.get("STT_ENGINE", "").strip().lower() or "whisper"
MOONSHINE_MODEL = os.environ.get("STT_MOONSHINE_MODEL", "small-streaming")

print(f"[stt] loading {MODEL_NAME} ({DEVICE}/{COMPUTE}) …", flush=True)
_t0 = time.time()
model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)
print(f"[stt] model ready in {time.time() - _t0:.1f}s", flush=True)


def load_hotwords() -> str:
    """The domain vocabulary, or "" — a missing file must never be fatal.

    One phrase per line, blank lines and `#` comments ignored. Returned as a
    single space-joined string because that is what both delivery mechanisms
    below want.
    """
    if not HOTWORDS_FILE:
        return ""
    try:
        with open(HOTWORDS_FILE, encoding="utf-8") as fh:
            words = [ln.strip() for ln in fh
                     if ln.strip() and not ln.lstrip().startswith("#")]
    except OSError as err:
        print(f"[stt] hotwords file unreadable, continuing without: {err}", flush=True)
        return ""
    return " ".join(words)


HOTWORDS = load_hotwords()

# faster-whisper grew `hotwords` in 1.0.3. Older builds raise TypeError on the
# keyword, which would turn a vocabulary hint into a 500 on every single turn —
# i.e. a deaf house, bought for a nicety. Ask the installed signature instead of
# pinning a version, and fall back to `initial_prompt`, which every version has
# and which biases the same way (less strongly).
_SUPPORTS_HOTWORDS = "hotwords" in inspect.signature(WhisperModel.transcribe).parameters


def decode_kwargs() -> dict:
    """Extra arguments for model.transcribe(). EMPTY unless an env var is set.

    ⚠ Every branch here is `if the env var is set`, never `if it is falsy` —
    "0" and "" mean different things and collapsing them is how a knob silently
    inverts. An unset knob adds no key at all, so the call is byte-identical to
    the pre-2026-08-22 one.
    """
    kwargs = {}
    if CONDITION_PREV != "":
        kwargs["condition_on_previous_text"] = CONDITION_PREV == "1"
    if NO_SPEECH != "":
        kwargs["no_speech_threshold"] = float(NO_SPEECH)
    if TEMPERATURE != "":
        kwargs["temperature"] = float(TEMPERATURE)
    if HOTWORDS:
        kwargs["hotwords" if _SUPPORTS_HOTWORDS else "initial_prompt"] = HOTWORDS
    return kwargs


DECODE = decode_kwargs()


def run_model(engine, wav_bytes: bytes) -> dict:
    """One transcription on one model. Shared by the live and shadow legs so the
    two can never drift into comparing different decode settings."""
    t0 = time.time()
    segments, info = engine.transcribe(
        io.BytesIO(wav_bytes),
        language="en",
        beam_size=BEAM,
        **DECODE,
    )
    text = "".join(seg.text for seg in segments).strip()
    return {
        "text": text,
        "language": info.language,
        "audio_ms": round(info.duration * 1000),
        "took_ms": round((time.time() - t0) * 1000),
    }


# The moonshine engine when STT_ENGINE asked for it AND it loaded (main() below).
live = None
LIVE_LABEL = f"moonshine:{MOONSHINE_MODEL}"


def transcribe(wav_bytes: bytes) -> tuple:
    """(result, label of the engine that answered). The label never enters the
    response — the shape the agent reads is the same whoever answered."""
    if live is not None:
        try:
            return live.run(wav_bytes), LIVE_LABEL
        except Exception as err:  # noqa: BLE001 — the fallback exists for exactly this
            print(f"[stt] {LIVE_LABEL} failed, {MODEL_NAME} answered this turn: {err}",
                  flush=True)
    return run_model(model, wav_bytes), MODEL_NAME


# ── The shadow leg ───────────────────────────────────────────────────────────
# ⚠⚠ THIS HOUSE HAS NEVER MEASURED ITS OWN TRANSCRIPTION ACCURACY, and the one
# time it tried, the probe fed Kokoro-synthesised speech and got a perfect
# transcript while the room was being misheard. "Do not benchmark STT with
# synthetic audio again" (project-voice-compute-on-g11) is the standing rule,
# and it leaves exactly one legitimate corpus: real turns, as they happen.
#
# Which collides with the retention promise. Audio reaching this port has passed
# the on-device wake gate and it is never written to disk; keeping a corpus would
# mean keeping recordings of the kitchen.
#
# So the corpus is never stored — it is CONSUMED IN FLIGHT. A second model
# transcribes the same bytes that are already in memory, off the response path,
# and only the two TRANSCRIPTS survive into the journal. That answers "is the
# model the limit, or the decode settings?" against genuine room speech, at the
# cost of nothing but CPU the box has already been measured to have spare.
#
# ⚠ IT MUST NOT SLOW THE LIVE TURN. Depth-1 queue that DROPS when full, same
# discipline as the level and ambient relays in voice_agent.py: a comparison is
# only interesting while it is current, and a backlog of stale ones is worse
# than a gap. The response is already sent before anything below runs.
_shadow_q: "queue.Queue" = queue.Queue(maxsize=1)
shadow = None
SHADOW_LABEL = SHADOW_MODEL if SHADOW_ENGINE == "whisper" else f"{SHADOW_ENGINE}:{SHADOW_MODEL}"


class MoonshineEngine:
    """moonshine-voice behind one `run(wav_bytes)` — the shadow worker calls it,
    and so does the live path when STT_ENGINE=moonshine.

    Imported lazily: the live venv does not carry the package unless an env
    switched to it, and a missing import must cost a log line (main() below
    catches it), never the transcriber.
    """

    def __init__(self, arch_name: str):
        # The handler is threaded and the shadow has its own thread; nothing
        # says the native transcriber may be entered twice.
        self._lock = threading.Lock()
        # Before the native library is loaded — it reads the env at session setup.
        os.environ["MOONSHINE_ORT_SINGLE_THREAD"] = "1"
        import moonshine_voice as mv  # noqa: PLC0415 — lazy on purpose, see docstring
        from moonshine_voice.transcriber import Transcriber  # noqa: PLC0415

        # The library spells them with hyphens ("small-streaming"); a systemd
        # line written with underscores should not be a silent load failure.
        arch = mv.string_to_model_arch(arch_name.strip().lower().replace("_", "-") or "base")
        path, arch = mv.get_model_for_language("en", arch, on_progress=lambda *_: None)
        self._tr = Transcriber(model_path=path, model_arch=arch)

    def run(self, wav_bytes: bytes) -> dict:
        import wave  # noqa: PLC0415
        import numpy as np  # noqa: PLC0415 — faster-whisper already depends on it

        t0 = time.time()
        with wave.open(io.BytesIO(wav_bytes)) as w:
            sr, ch, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
            raw = w.readframes(n)
        if width != 2:
            raise ValueError(f"moonshine shadow expects 16-bit PCM, got {width * 8}-bit")
        audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        if ch > 1:
            audio = audio.reshape(-1, ch).mean(axis=1)
        with self._lock:
            out = self._tr.transcribe_without_streaming(audio.tolist(), sample_rate=sr)
        text = " ".join(line.text.strip() for line in out.lines if line.text).strip()
        return {
            "text": text,
            "language": "en",
            "audio_ms": round(len(audio) * 1000 / sr) if sr else 0,
            "took_ms": round((time.time() - t0) * 1000),
        }


def run_shadow(wav_bytes: bytes) -> dict:
    """The shadow's transcription, same {text, audio_ms, took_ms} shape as the
    live leg. Whisper goes through run_model() so the two legs still share one
    decode configuration."""
    if isinstance(shadow, MoonshineEngine):
        return shadow.run(wav_bytes)
    return run_model(shadow, wav_bytes)

_PUNCT = re.compile(r"[^\w\s']+")


def _norm(text: str) -> str:
    """Compare on words, not on how whisper felt about commas that day."""
    return " ".join(_PUNCT.sub(" ", text.lower()).split())


def _shadow_worker():
    while True:
        wav, answer, label = _shadow_q.get()
        try:
            alt = run_shadow(wav)
        except Exception as err:  # noqa: BLE001 — a shadow must never be fatal
            print(f"[stt] shadow failed: {err}", flush=True)
            continue
        agree = _norm(alt["text"]) == _norm(answer["text"])
        # One line either way, so the AGREEMENT RATE is countable from the
        # journal rather than inferred from the absence of disagreements.
        print(f"[stt] shadow {'same' if agree else 'DIFF'} "
              f"{label} {answer['took_ms']}ms / "
              f"{SHADOW_LABEL} {alt['took_ms']}ms", flush=True)
        if not agree:
            print(f"[stt]   live   {answer['text']!r}", flush=True)
            print(f"[stt]   shadow {alt['text']!r}", flush=True)


def send_shadow(wav_bytes: bytes, answer: dict, label: str) -> None:
    # A turn the fallback answered, when the fallback IS the shadow, is one
    # model against itself — it would count as agreement and mean nothing.
    if shadow is None or (shadow is model and label == MODEL_NAME):
        return
    try:
        _shadow_q.put_nowait((wav_bytes, answer, label))
    except queue.Full:
        pass  # a comparison is already running; this turn is not worth queueing


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            # The decode keys and the shadow are reported because a knob that
            # cannot be read back from outside is a knob nobody can prove is on
            # — and every one of these lives in a systemd Environment= line on a
            # box reached over ssh. `hotwords` is reported as a COUNT, never as
            # its contents: this endpoint answers to anything that can reach the
            # port, and the contents are household nouns.
            self._send(200, {
                "ok": True,
                # The engine that ANSWERS, not the one that was asked for: a
                # moonshine that failed to load reports whisper here.
                "engine": "moonshine" if live is not None else "whisper",
                "model": MOONSHINE_MODEL if live is not None else MODEL_NAME,
                "fallback": MODEL_NAME if live is not None else None,
                "device": DEVICE,
                "decode": sorted(DECODE),
                "hotwords": len(HOTWORDS.split()) if HOTWORDS else 0,
                "shadow": SHADOW_MODEL or None,
                # Which engine ACTUALLY loaded, not which was asked for: a
                # moonshine shadow whose import failed reports null here.
                "shadow_engine": (SHADOW_ENGINE if shadow is not None else None),
            })
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/transcribe":
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self._send(400, {"error": "empty body"})
            return
        if length > MAX_BYTES:
            self._send(413, {"error": "audio too large"})
            return
        wav = self.rfile.read(length)
        try:
            result, label = transcribe(wav)
        except Exception as err:  # noqa: BLE001 — report, never crash the server
            self._send(500, {"error": str(err)})
            return
        print(f"[stt] {result['audio_ms']}ms audio -> {result['took_ms']}ms "
              f"-> {result['text']!r}", flush=True)
        self._send(200, result)
        # AFTER the response. The turn is over as far as the room is concerned;
        # everything the shadow costs is spent on a clock nobody is watching.
        send_shadow(wav, result, label)

    def log_message(self, *_args):  # silence default per-request stderr noise
        pass


def main():
    global shadow, live
    if ENGINE == "moonshine":
        # Loaded HERE for the same reason as the shadow: whisper is already
        # warm above, so a moonshine that cannot load leaves a working house.
        try:
            print(f"[stt] loading live {LIVE_LABEL} (1 core) …", flush=True)
            live = MoonshineEngine(MOONSHINE_MODEL)
            print(f"[stt] {LIVE_LABEL} answers; {MODEL_NAME} is the fallback", flush=True)
        except Exception as err:  # noqa: BLE001
            live = None
            print(f"[stt] live {LIVE_LABEL} unavailable, {MODEL_NAME} answers: {err}",
                  flush=True)
    elif ENGINE != "whisper":
        print(f"[stt] unknown STT_ENGINE {ENGINE!r}, {MODEL_NAME} answers", flush=True)
    if DECODE:
        print(f"[stt] decode overrides: {sorted(DECODE)}", flush=True)
    if HOTWORDS:
        print(f"[stt] hotword bias on → {len(HOTWORDS.split())} words via "
              f"{'hotwords' if _SUPPORTS_HOTWORDS else 'initial_prompt'}", flush=True)
    if SHADOW_MODEL:
        # Loaded HERE rather than at import: a shadow model that cannot be
        # downloaded must cost the house a log line, not its only transcriber.
        try:
            if SHADOW_ENGINE == "moonshine":
                print(f"[stt] loading shadow {SHADOW_LABEL} (1 core) …", flush=True)
                shadow = MoonshineEngine(SHADOW_MODEL)
                cores = "1 core"
            elif SHADOW_ENGINE == "whisper" and live is not None and SHADOW_MODEL == MODEL_NAME:
                # The roles swapped: the fallback is already this model and is
                # idle while moonshine answers, so it shadows without a second copy.
                shadow = model
                cores = "the fallback's threads"
            elif SHADOW_ENGINE == "whisper":
                print(f"[stt] loading shadow {SHADOW_MODEL} ({DEVICE}/{SHADOW_COMPUTE}) …",
                      flush=True)
                shadow = WhisperModel(SHADOW_MODEL, device=DEVICE,
                                      compute_type=SHADOW_COMPUTE,
                                      cpu_threads=SHADOW_THREADS)
                cores = f"{SHADOW_THREADS} threads"
            else:
                raise ValueError(f"unknown STT_SHADOW_ENGINE {SHADOW_ENGINE!r}")
            # daemon=True so a shadow mid-transcription can never hold the
            # service open through a restart.
            threading.Thread(target=_shadow_worker, daemon=True).start()
            print(f"[stt] shadow on → comparing every turn against {SHADOW_LABEL} "
                  f"on {cores}", flush=True)
        except Exception as err:  # noqa: BLE001
            shadow = None
            print(f"[stt] shadow unavailable, continuing without: {err}", flush=True)

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[stt] listening on http://{HOST}:{PORT}  (POST /transcribe, GET /health)",
          flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
