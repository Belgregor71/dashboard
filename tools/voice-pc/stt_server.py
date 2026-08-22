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
                STT_HOTWORDS_FILE, STT_SHADOW_MODEL, STT_SHADOW_COMPUTE.

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


def transcribe(wav_bytes: bytes) -> dict:
    return run_model(model, wav_bytes)


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

_PUNCT = re.compile(r"[^\w\s']+")


def _norm(text: str) -> str:
    """Compare on words, not on how whisper felt about commas that day."""
    return " ".join(_PUNCT.sub(" ", text.lower()).split())


def _shadow_worker():
    while True:
        wav, live = _shadow_q.get()
        try:
            alt = run_model(shadow, wav)
        except Exception as err:  # noqa: BLE001 — a shadow must never be fatal
            print(f"[stt] shadow failed: {err}", flush=True)
            continue
        agree = _norm(alt["text"]) == _norm(live["text"])
        # One line either way, so the AGREEMENT RATE is countable from the
        # journal rather than inferred from the absence of disagreements.
        print(f"[stt] shadow {'same' if agree else 'DIFF'} "
              f"{MODEL_NAME} {live['took_ms']}ms / "
              f"{SHADOW_MODEL} {alt['took_ms']}ms", flush=True)
        if not agree:
            print(f"[stt]   live   {live['text']!r}", flush=True)
            print(f"[stt]   shadow {alt['text']!r}", flush=True)


def send_shadow(wav_bytes: bytes, live: dict) -> None:
    if shadow is None:
        return
    try:
        _shadow_q.put_nowait((wav_bytes, live))
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
                "model": MODEL_NAME,
                "device": DEVICE,
                "decode": sorted(DECODE),
                "hotwords": len(HOTWORDS.split()) if HOTWORDS else 0,
                "shadow": SHADOW_MODEL or None,
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
            result = transcribe(wav)
        except Exception as err:  # noqa: BLE001 — report, never crash the server
            self._send(500, {"error": str(err)})
            return
        print(f"[stt] {result['audio_ms']}ms audio -> {result['took_ms']}ms "
              f"-> {result['text']!r}", flush=True)
        self._send(200, result)
        # AFTER the response. The turn is over as far as the room is concerned;
        # everything the shadow costs is spent on a clock nobody is watching.
        send_shadow(wav, result)

    def log_message(self, *_args):  # silence default per-request stderr noise
        pass


def main():
    global shadow
    if DECODE:
        print(f"[stt] decode overrides: {sorted(DECODE)}", flush=True)
    if HOTWORDS:
        print(f"[stt] hotword bias on → {len(HOTWORDS.split())} words via "
              f"{'hotwords' if _SUPPORTS_HOTWORDS else 'initial_prompt'}", flush=True)
    if SHADOW_MODEL:
        # Loaded HERE rather than at import: a shadow model that cannot be
        # downloaded must cost the house a log line, not its only transcriber.
        try:
            print(f"[stt] loading shadow {SHADOW_MODEL} ({DEVICE}/{SHADOW_COMPUTE}) …",
                  flush=True)
            shadow = WhisperModel(SHADOW_MODEL, device=DEVICE,
                                  compute_type=SHADOW_COMPUTE)
            # daemon=True so a shadow mid-transcription can never hold the
            # service open through a restart.
            threading.Thread(target=_shadow_worker, daemon=True).start()
            print(f"[stt] shadow on → comparing every turn against {SHADOW_MODEL}",
                  flush=True)
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
