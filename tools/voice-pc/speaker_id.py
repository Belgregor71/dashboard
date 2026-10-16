"""Speaker identification for stt_server.py — "is this Greg, Brett, or neither".

docs/design/HANDOVER-SPEAKER-ID.md is the design. The parts that matter here:

- Two enrolled voices, a reject band, and a strong preference for UNKNOWN. `identify()`
  names someone only when the best match clears an absolute floor AND beats the
  runner-up by a margin; everything else is None, and None reproduces today's
  converse prompt byte for byte.
- Voiceprints are biometrics. The store holds EMBEDDINGS ONLY (never audio), lives
  outside the tree (STT_SPEAKER_STORE, mode 600), and `summary()` reports a count,
  never names — the same rule stt_server.py applies to the hotword list.

The model is wespeaker's VoxCeleb CAM++ (LM) ONNX export as republished by
sherpa-onnx (`wespeaker_en_voxceleb_CAM++_LM.onnx`, 29 MB). Introspected on the G11
2026-10-16: input `feats` [B, T, 80], output `embs` [B, 512], metadata
normalize_samples=0. 90 ms per 3 s utterance on ONE thread.

⚠ The frontend is Kaldi fbank in numpy, matching wespeaker's TRAINING pipeline
(wespeaker/dataset/processor.py): waveform scaled to int16 range, 25 ms / 10 ms
frames, Hamming window, 80 mel bins, no energy, then per-utterance mean
subtraction (apply_cmvn, norm_var=False). A model fed the wrong frontend returns
confident nonsense rather than failing, so the window and the CMN are parameters
and spk_verify.py proves the machinery against sherpa-onnx's implementation.
"""

from __future__ import annotations

import io
import json
import math
import os
import time
import wave

import numpy as np

SAMPLE_RATE = 16000
FRAME_LEN = 400      # 25 ms
FRAME_SHIFT = 160    # 10 ms
N_FFT = 512          # next power of two above FRAME_LEN
N_MELS = 80
LOW_FREQ = 20.0
PREEMPH = 0.97
_EPS = float(np.finfo(np.float32).eps)


def _mel(f):
    return 1127.0 * np.log(1.0 + np.asarray(f, dtype=np.float64) / 700.0)


def _mel_banks() -> np.ndarray:
    """Kaldi's triangular mel filterbank over the first N_FFT/2 bins (Kaldi
    leaves the Nyquist bin out). Shape (N_MELS, N_FFT // 2)."""
    n_bins = N_FFT // 2
    mel_lo, mel_hi = _mel(LOW_FREQ), _mel(SAMPLE_RATE / 2)
    delta = (mel_hi - mel_lo) / (N_MELS + 1)
    bin_mel = _mel(np.arange(n_bins) * SAMPLE_RATE / N_FFT)
    banks = np.zeros((N_MELS, n_bins), dtype=np.float64)
    for m in range(N_MELS):
        left, center, right = mel_lo + m * delta, mel_lo + (m + 1) * delta, mel_lo + (m + 2) * delta
        up = (bin_mel - left) / (center - left)
        down = (right - bin_mel) / (right - center)
        w = np.where(bin_mel <= center, up, down)
        banks[m] = np.where((bin_mel > left) & (bin_mel < right), w, 0.0)
    return banks


_BANKS = _mel_banks()


def _window(kind: str) -> np.ndarray:
    n = np.arange(FRAME_LEN)
    if kind == "hamming":
        return 0.54 - 0.46 * np.cos(2 * math.pi * n / (FRAME_LEN - 1))
    if kind == "povey":
        return (0.5 - 0.5 * np.cos(2 * math.pi * n / (FRAME_LEN - 1))) ** 0.85
    raise ValueError(f"unknown window {kind!r}")


def fbank(samples: np.ndarray, window: str = "hamming", cmn: bool = True) -> np.ndarray:
    """Kaldi fbank, dither 0, snip_edges. `samples` are int16-scale floats.
    Returns (frames, 80) float32; (0, 80) when the clip is under one frame."""
    x = np.asarray(samples, dtype=np.float64)
    if x.size < FRAME_LEN:
        return np.zeros((0, N_MELS), dtype=np.float32)
    n_frames = 1 + (x.size - FRAME_LEN) // FRAME_SHIFT
    idx = np.arange(FRAME_LEN)[None, :] + FRAME_SHIFT * np.arange(n_frames)[:, None]
    frames = x[idx]
    frames = frames - frames.mean(axis=1, keepdims=True)          # remove DC
    prev = np.concatenate([frames[:, :1], frames[:, :-1]], axis=1)
    frames = frames - PREEMPH * prev                              # Kaldi pre-emphasis
    frames = frames * _window(window)
    spec = np.fft.rfft(frames, n=N_FFT, axis=1)
    power = (spec.real ** 2 + spec.imag ** 2)[:, : N_FFT // 2]
    feats = np.log(np.maximum(power @ _BANKS.T, _EPS))
    if cmn:
        feats = feats - feats.mean(axis=0, keepdims=True)
    return feats.astype(np.float32)


def wav_to_samples(wav_bytes: bytes) -> np.ndarray | None:
    """16 kHz mono 16-bit PCM WAV → int16-scale float array. None for anything
    else: this lane is optional, and the transcript must not depend on it."""
    try:
        with wave.open(io.BytesIO(wav_bytes)) as w:
            if w.getframerate() != SAMPLE_RATE or w.getsampwidth() != 2 or w.getnchannels() != 1:
                return None
            pcm = w.readframes(w.getnframes())
    except (wave.Error, EOFError):
        return None
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32)


class Embedder:
    def __init__(self, model_path: str, window: str = "hamming", cmn: bool = True):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        # One thread, deliberately: the same guardrail as MOONSHINE_ORT_SINGLE_THREAD.
        # The box that runs this also renders the wall.
        opts.intra_op_num_threads = 1
        opts.inter_op_num_threads = 1
        self._s = ort.InferenceSession(model_path, opts, providers=["CPUExecutionProvider"])
        inp = self._s.get_inputs()[0]
        out = self._s.get_outputs()[0]
        # Refuse a model whose geometry disagrees with this frontend, as _init_turn
        # does in voice_agent.py: a mismatched model answers, wrongly, rather than failing.
        if len(inp.shape) != 3 or inp.shape[2] != N_MELS or len(out.shape) != 2:
            raise ValueError(f"speaker model geometry {inp.shape} -> {out.shape} is not [B,T,80] -> [B,D]")
        self._in = inp.name
        self.dim = out.shape[1]
        self.window, self.cmn = window, cmn

    def embed(self, samples: np.ndarray) -> np.ndarray | None:
        feats = fbank(samples, self.window, self.cmn)
        if feats.shape[0] == 0:
            return None
        e = self._s.run(None, {self._in: feats[None, :, :]})[0][0].astype(np.float64)
        n = np.linalg.norm(e)
        return e / n if n > 0 else None


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


class Store:
    """Enrolled voices: {name: {"centroid": [...], "n": k, "at": epoch}}.
    Embeddings only. Written atomically with mode 600."""

    def __init__(self, path: str):
        self.path = path
        self.voices: dict[str, dict] = {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                self.voices = json.load(f).get("voices", {})
        except FileNotFoundError:
            pass

    def centroids(self) -> dict[str, np.ndarray]:
        return {k: np.asarray(v["centroid"], dtype=np.float64) for k, v in self.voices.items()}

    def enrol(self, name: str, embeddings: list[np.ndarray]) -> None:
        if not embeddings:
            raise ValueError("no embeddings to enrol")
        c = np.mean([e / np.linalg.norm(e) for e in embeddings], axis=0)
        self.voices[name] = {"centroid": [round(float(v), 6) for v in c],
                             "n": len(embeddings), "at": int(time.time())}
        self._save()

    def forget(self, name: str) -> bool:
        if self.voices.pop(name, None) is None:
            return False
        self._save()
        return True

    def summary(self) -> dict:
        # A COUNT, never the names: /health answers anything that reaches the port.
        return {"enrolled": len(self.voices)}

    def _save(self) -> None:
        data = json.dumps({"voices": self.voices}).encode("utf-8")
        tmp = self.path + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, self.path)


def identify(emb: np.ndarray | None, centroids: dict[str, np.ndarray],
             floor: float, margin: float) -> tuple[str | None, float | None]:
    """(name, best cosine) or (None, best cosine). Fails toward None:
    no embedding, no voices, best under the floor, or a runner-up within the
    margin. With ONE voice enrolled the runner-up is taken as 0, so the floor
    alone decides — and an unenrolled person must land under it."""
    if emb is None or not centroids:
        return None, None
    scores = sorted(((cosine(emb, c), n) for n, c in centroids.items()), reverse=True)
    best, name = scores[0]
    second = scores[1][0] if len(scores) > 1 else 0.0
    if best < floor or best - second < margin:
        return None, round(best, 3)
    return name, round(best, 3)
