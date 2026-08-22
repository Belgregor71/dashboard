"""PC-side Kokoro TTS service (Stage B2 of project-voice-mic-bridge).

Speaks the exact contract the dashboard already uses (server/routes/tts.js):
POST /v1/audio/speech  {model, input, voice, response_format, speed} -> WAV.
So it's a drop-in for KOKORO_URL — the dashboard points at the PC as primary
(fast: ~1-3 s on a Ryzen 5700X) and falls back to the NAS Kokoro when the PC is
off. Same voice (bf_emma) as the NAS so the house sounds identical everywhere.

Runs kokoro-onnx on CPU (onnxruntime). Model files (kokoro-v1.0.onnx +
voices-v1.0.bin) live in ./models. Loaded once, kept warm.

Run (Windows):  .venv/Scripts/python.exe tts_server.py
Run (Linux):    .venv/bin/python tts_server.py
Config via env: TTS_VOICE (bf_emma), TTS_HOST (0.0.0.0), TTS_PORT (8880),
                KOKORO_MODEL / KOKORO_VOICES (paths under ./models),
                OMP_NUM_THREADS (onnxruntime defaults to ALL cores — on the
                kiosk host this is pinned to 4; see deploy/voice-tts.service).
"""

import io
import json
import os
import sys
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Under pythonw.exe (autostart, no console) route prints to a logfile.
#
# ⚠ UTF-8 IS FORCED FOR THE SAME REASON AS stt_server.py — read the longer note
# there. On Windows both a pipe and a plain-`open` logfile default to cp1252,
# and this file prints the text it was asked to SPEAK. Most of what the house
# says is cp1252-safe (em dash, curly quotes and ° all are), so this is
# prophylactic here rather than a fixed sighting — but the failure it prevents
# is a UnicodeEncodeError inside the request handler, which is a silent turn
# caused entirely by a log line.
if sys.stdout is None:
    _log = open(os.path.join(os.path.dirname(__file__), "tts.log"), "a",
                buffering=1, encoding="utf-8", errors="replace")
    sys.stdout = sys.stderr = _log
else:
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass

import numpy as np
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("KOKORO_MODEL", os.path.join(HERE, "models", "kokoro-v1.0.onnx"))
VOICES = os.environ.get("KOKORO_VOICES", os.path.join(HERE, "models", "voices-v1.0.bin"))
DEFAULT_VOICE = os.environ.get("TTS_VOICE", "bf_emma")
HOST = os.environ.get("TTS_HOST", "0.0.0.0")
PORT = int(os.environ.get("TTS_PORT", "8880"))

print(f"[tts] loading kokoro-onnx ({os.path.basename(MODEL)}) …", flush=True)
_t0 = time.time()
kokoro = Kokoro(MODEL, VOICES)
print(f"[tts] model ready in {time.time() - _t0:.1f}s", flush=True)


def lang_for(voice: str) -> str:
    # Kokoro voice prefixes: b* = British English, everything else US English.
    # For a blend the first named voice decides (our blends share one lang).
    first = voice.split("+", 1)[0].strip()
    return "en-gb" if first.startswith("b") else "en-us"


_blend_cache = {}


def resolve_voice(voice: str):
    # A plain name passes straight through. "a+b(+c…)" is an equal-weight blend
    # of the named voices' style vectors — same "+" syntax Kokoro-FastAPI uses on
    # the NAS fallback, so both upstreams produce the identical blended voice.
    if "+" not in voice:
        return voice
    if voice not in _blend_cache:
        names = [n.strip() for n in voice.split("+") if n.strip()]
        styles = [kokoro.get_voice_style(n) for n in names]
        _blend_cache[voice] = sum(styles) / len(styles)
    return _blend_cache[voice]


def synth_wav(text: str, voice: str, speed: float) -> bytes:
    samples, rate = kokoro.create(text, voice=resolve_voice(voice), speed=speed, lang=lang_for(voice))
    pcm = np.clip(samples, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _wav(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._json(200, {"ok": True, "voice": DEFAULT_VOICE})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/v1/audio/speech":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            self._json(400, {"error": "invalid json"})
            return
        text = (body.get("input") or "").strip()
        if not text:
            self._json(400, {"error": "input is required"})
            return
        voice = body.get("voice") or DEFAULT_VOICE
        speed = body.get("speed")
        speed = float(speed) if isinstance(speed, (int, float)) and speed > 0 else 1.0
        try:
            t0 = time.time()
            wav = synth_wav(text, voice, speed)
            print(f"[tts] {len(text)} chars ({voice}) -> {len(wav)}B "
                  f"in {(time.time() - t0) * 1000:.0f}ms", flush=True)
            self._wav(wav)
        except Exception as err:  # noqa: BLE001 — report, never crash the server
            print("[tts] error:", err, flush=True)
            self._json(500, {"error": str(err)})

    def log_message(self, *_args):
        pass


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[tts] listening on http://{HOST}:{PORT}  (POST /v1/audio/speech, GET /health)",
          flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
