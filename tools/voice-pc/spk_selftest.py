"""Offline proof of stt_server.py's speaker lane (HANDOVER-SPEAKER-ID.md §8).

Needs REAL speech from two different people, never synthesised (a TTS voice has
no speaker identity to recognise), and the CAM++ ONNX file:

    python -I spk_selftest.py <model.onnx> <voiceA.wav> <voiceB.wav>

Both WAVs must be 16 kHz mono 16-bit; A needs at least 9 s (four 2 s turns plus
a short clip). Every case starts its own server on a loopback port and stops it.

⚠ THE REJECT BAND IS PROVEN BY INJECTION: voice B is fed against a store that
holds ONLY voice A, and must come back null. A test that only ever sees a
correct match cannot fail (§8).
"""

import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

HERE = Path(__file__).resolve().parent
SERVER = HERE / "stt_server.py"
TMP = Path(tempfile.mkdtemp(prefix="spk-selftest-"))
MODEL, WAV_A, WAV_B = sys.argv[1], sys.argv[2], sys.argv[3]
WHISPER = os.environ.get("STT_MODEL", "base.en")


def read_pcm(path):
    with wave.open(path) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16000, 1, 2), path
        return w.readframes(w.getnframes())


def wav_bytes(pcm):
    p = TMP / "clip.wav"
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm)
    return p.read_bytes()


SEC = 16000 * 2
A, B = read_pcm(WAV_A), read_pcm(WAV_B)
assert len(A) >= 9 * SEC, "voice A needs at least 9 s"
A_TURNS = [wav_bytes(A[i * 2 * SEC:(i + 1) * 2 * SEC]) for i in range(4)]
A_SHORT = wav_bytes(A[8 * SEC:8 * SEC + SEC // 2])          # 0.5 s of A
B_TURN = wav_bytes(B[: min(len(B), 3 * SEC)])


class Server:
    def __init__(self, port, env_extra, label):
        env = {**os.environ, "STT_HOST": "127.0.0.1", "STT_PORT": str(port),
               "STT_MODEL": WHISPER, **env_extra}
        for k in [k for k in env if k.startswith("STT_SPEAKER_") and k not in env_extra]:
            env.pop(k)
        for k in ("STT_ENGINE", "STT_SHADOW_MODEL", "STT_SHADOW_ENGINE"):
            env.pop(k, None)
        self.label, self.base = label, f"http://127.0.0.1:{port}"
        self.proc = subprocess.Popen([sys.executable, str(SERVER)], env=env,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     text=True, encoding="utf-8", errors="replace")
        for _ in range(120):
            try:
                self.health()
                return
            except Exception:  # noqa: BLE001
                if self.proc.poll() is not None:
                    raise SystemExit(f"[{label}] server exited:\n{self.proc.stdout.read()}")
                time.sleep(0.5)
        self.stop()
        raise SystemExit(f"[{label}] /health never answered")

    def call(self, method, path, data=None, ctype="application/json"):
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": ctype})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def health(self):
        return self.call("GET", "/health")[1]

    def say(self, wav):
        code, body = self.call("POST", "/transcribe", wav, "audio/wav")
        assert code == 200, (code, body)
        return body

    def stop(self):
        self.proc.terminate()
        try:
            out = self.proc.communicate(timeout=10)[0]
        except subprocess.TimeoutExpired:
            self.proc.kill()
            out = self.proc.communicate()[0]
        return out


def case(title):
    print("=" * 72)
    print(title)


store = TMP / "speakers.json"
ON = {"STT_SPEAKER_MODEL": MODEL, "STT_SPEAKER_STORE": str(store)}
BASE_SHAPE = ["audio_ms", "language", "text", "took_ms"]

case("S1 — model set, store unset: the lane refuses to load, the transcriber answers")
s = Server(8189, {"STT_SPEAKER_MODEL": MODEL}, "no-store")
try:
    h, b = s.health(), s.say(A_TURNS[0])
finally:
    log = s.stop()
assert h["speakers"] is None, h
assert sorted(b) == BASE_SHAPE, sorted(b)
assert "speaker id unavailable" in log and "STT_SPEAKER_STORE" in log, log
print("  ✅ logged, unchanged shape, no lane")

s = Server(8188, ON, "on")
try:
    case("S2 — lane on, nobody enrolled: speaker null, scores logged empty")
    h = s.health()
    assert h["speakers"] == 0, h
    b = s.say(A_TURNS[0])
    assert sorted(b) == sorted(BASE_SHAPE + ["speaker", "speaker_score"]), sorted(b)
    assert b["speaker"] is None and b["speaker_score"] is None, b
    print("  ✅ {speaker: null, speaker_score: null}")

    case("S3 — bad enrol requests are refused")
    for bad in ({"name": "", "turns": 3}, {"name": "x/../y", "turns": 3},
                {"name": "Alpha", "turns": 1}, {"name": "Alpha", "turns": "5"}):
        code, _ = s.call("POST", "/speaker/enrol", json.dumps(bad).encode())
        assert code == 400, (bad, code)
    print("  ✅ 4 malformed requests → 400")

    case("S4 — enrol voice A over three turns; embeddings only, mode 600, count not names")
    code, body = s.call("POST", "/speaker/enrol", json.dumps({"name": "Alpha", "turns": 3}).encode())
    assert code == 200 and body == {"armed": True, "left": 3}, (code, body)
    s.say(A_SHORT)                               # too short: must NOT count toward enrolment
    assert s.call("GET", "/speaker/enrol")[1]["left"] == 3, "a 0.5 s clip was enrolled"
    for w in A_TURNS[:3]:
        s.say(w)
    assert s.call("GET", "/speaker/enrol")[1] == {"armed": False, "left": 0}
    raw = store.read_bytes()
    assert b"RIFF" not in raw and b"data" not in raw.replace(b'"', b""), "audio in the store"
    stored = json.loads(raw)["voices"]
    assert list(stored) == ["Alpha"] and stored["Alpha"]["n"] == 3, stored
    assert len(stored["Alpha"]["centroid"]) == 512, len(stored["Alpha"]["centroid"])
    if os.name == "posix":
        mode = stat.S_IMODE(store.stat().st_mode)
        assert mode == 0o600, oct(mode)
    h = s.health()
    assert h["speakers"] == 1 and "Alpha" not in json.dumps(h), h
    print(f"  ✅ stored 1 voice, 512 floats, {'mode 600, ' if os.name == 'posix' else ''}/health says 1, no name")

    case("S5 — a fourth turn of A, never enrolled, is recognised")
    b = s.say(A_TURNS[3])
    assert b["speaker"] == "Alpha", b
    print(f"  ✅ speaker Alpha at {b['speaker_score']}")

    case("S6 — INJECTION: voice B against a store holding only A must be null")
    b = s.say(B_TURN)
    assert b["speaker"] is None, f"voice B was named {b['speaker']} at {b['speaker_score']}"
    assert b["speaker_score"] is not None and b["speaker_score"] < 0.6, b
    print(f"  ✅ null (best {b['speaker_score']})")

    case("S7 — too little voice to be sure: a 0.5 s clip of A is null")
    b = s.say(A_SHORT)
    assert b["speaker"] is None and b["speaker_score"] is None, b
    print("  ✅ null under STT_SPEAKER_MIN_MS")

    case("S8 — forget A; A is a stranger again")
    code, body = s.call("DELETE", "/speaker/Alpha")
    assert code == 200 and body == {"forgotten": True}, body
    assert s.call("DELETE", "/speaker/Alpha")[1] == {"forgotten": False}
    assert s.health()["speakers"] == 0
    assert json.loads(store.read_bytes())["voices"] == {}
    b = s.say(A_TURNS[3])
    assert b["speaker"] is None, b
    print("  ✅ forgotten, store empty, A now null")
finally:
    log = s.stop()

assert "[stt] speaker" in log and "scores=" in log, log
print("=" * 72)
print("ALL SPEAKER CASES PASSED")
