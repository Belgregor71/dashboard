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
                STT_HOST (0.0.0.0), STT_PORT (8123), STT_BEAM (5).

Also runs on the kiosk host itself (deploy/voice-stt.service), where it is the
only transcriber rather than a remote one — same speed, always up.
"""

import io
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Under pythonw.exe (autostart, no console) sys.stdout/stderr are None — route
# the prints below to a logfile so the service still records what it's doing.
if sys.stdout is None:
    _log = open(os.path.join(os.path.dirname(__file__), "stt.log"), "a", buffering=1)
    sys.stdout = sys.stderr = _log

from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("STT_MODEL", "base.en")
DEVICE = os.environ.get("STT_DEVICE", "cpu")
COMPUTE = os.environ.get("STT_COMPUTE", "int8")
HOST = os.environ.get("STT_HOST", "0.0.0.0")
PORT = int(os.environ.get("STT_PORT", "8123"))
BEAM = int(os.environ.get("STT_BEAM", "5"))
MAX_BYTES = 20 * 1024 * 1024  # 20 MB — a wake-gated command is a few seconds

print(f"[stt] loading {MODEL_NAME} ({DEVICE}/{COMPUTE}) …", flush=True)
_t0 = time.time()
model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)
print(f"[stt] model ready in {time.time() - _t0:.1f}s", flush=True)


def transcribe(wav_bytes: bytes) -> dict:
    t0 = time.time()
    segments, info = model.transcribe(
        io.BytesIO(wav_bytes),
        language="en",
        beam_size=BEAM,
    )
    text = "".join(seg.text for seg in segments).strip()
    return {
        "text": text,
        "language": info.language,
        "audio_ms": round(info.duration * 1000),
        "took_ms": round((time.time() - t0) * 1000),
    }


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
            self._send(200, {"ok": True, "model": MODEL_NAME, "device": DEVICE})
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

    def log_message(self, *_args):  # silence default per-request stderr noise
        pass


def main():
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
