#!/usr/bin/env python3
"""Proof that voice_agent.py's numpy log-mel IS WhisperFeatureExtractor.

⚠ WHY THIS EXISTS. Smart Turn v3 wants an 80-bin log-mel, and the reference
implementation builds it with transformers' WhisperFeatureExtractor. voice_agent
computes it in numpy instead, because transformers is not a dependency the one
process whose failure means a deaf house can afford — it pulls huggingface_hub,
tokenizers and safetensors behind it for what is, at bottom, an STFT and a
matrix multiply.

That substitution is the single most dangerous thing in the feature. A
filterbank or a window or an ordering that is subtly wrong produces a model that
LOADS, RUNS, and RETURNS PLAUSIBLE NUMBERS — which is far worse than one that
refuses, because nothing anywhere reports it and the endpointing just quietly
gets worse. So it is checked numerically rather than reasoned about.

Measured 2026-08-22 on the G11: worst feature difference 8.3e-07 across four
signals, and the model's own output to 5e-07. Re-run it after touching
_turn_features, after a model upgrade, or after a numpy major version.

⚠ NEEDS transformers, which the AGENT does not and must not. Use a throwaway
venv, never the agent's:

    python3 -m venv ~/smart-turn-probe
    ~/smart-turn-probe/bin/pip install transformers numpy onnxruntime
    ~/smart-turn-probe/bin/python tools/voice-agent/st_verify.py <model.onnx>

It writes mel_filters_80.npy beside the model — that file is the ONE artefact
the agent needs at runtime, exported from the reference so it cannot drift from
it. Everything else here is scaffolding.
"""
import sys

import numpy as np
import onnxruntime as ort
from transformers import WhisperFeatureExtractor

MODEL = sys.argv[1] if len(sys.argv) > 1 else "smart-turn-v3.2-cpu.onnx"

N_FFT, HOP, MEL_SAMPLES = 400, 160, 8 * 16000
_HANN = np.hanning(N_FFT + 1)[:-1].astype(np.float32)   # periodic, as transformers

fe = WhisperFeatureExtractor(chunk_length=8)
filters = np.asarray(fe.mel_filters, dtype=np.float32)
np.save("mel_filters_80.npy", filters)
print(f"filterbank exported: mel_filters_80.npy {filters.shape}")


def mine(audio):
    """The exact body of voice_agent._turn_features, on float input.

    Kept as a COPY rather than imported: importing voice_agent drags in
    openwakeword, which is not installed in a probe venv, and stubbing it here
    would mean this proof no longer reads as the thing it is proving.
    """
    a = np.asarray(audio, dtype=np.float32)[-MEL_SAMPLES:]
    a = (a - a.mean()) / np.sqrt(a.var() + 1e-7)
    if len(a) < MEL_SAMPLES:
        a = np.concatenate([a, np.zeros(MEL_SAMPLES - len(a), np.float32)])
    pad = N_FFT // 2
    p = np.pad(a, (pad, pad), mode="reflect")
    frames = 1 + (len(p) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(frames)[:, None]
    power = np.abs(np.fft.rfft(p[idx] * _HANN, n=N_FFT, axis=1)) ** 2
    mel = np.log10(np.maximum(1e-10, power @ filters)).T[:, :-1]
    mel = np.maximum(mel, mel.max() - 8.0)
    return ((mel + 4.0) / 4.0).astype(np.float32)[None, :, :]


def reference(audio):
    out = fe(audio, sampling_rate=16000, return_tensors="np", padding="max_length",
             max_length=MEL_SAMPLES, truncation=True, do_normalize=True)
    return np.expand_dims(out.input_features.squeeze(0).astype(np.float32), 0)


rng = np.random.default_rng(0)
SIGNALS = {
    "silence": np.zeros(MEL_SAMPLES, np.float32),
    "tone":    (0.2 * np.sin(2 * np.pi * 440 * np.arange(MEL_SAMPLES) / 16000)).astype(np.float32),
    "noise":   (rng.standard_normal(MEL_SAMPLES) * 0.05).astype(np.float32),
    # Shorter than the window, so the right-padding and the normalise-before-pad
    # ordering are both exercised — the two places an ordering slip would hide.
    "short":   (rng.standard_normal(20000) * 0.05).astype(np.float32),
}

sess = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
worst_feat = worst_out = 0.0
for name, audio in SIGNALS.items():
    ref, got = reference(audio), mine(audio)
    assert got.shape == ref.shape == (1, 80, 800), f"{name}: {got.shape} vs {ref.shape}"
    df = float(np.abs(got - ref).max())
    p_ref = float(sess.run(None, {"input_features": ref})[0].ravel()[0])
    p_got = float(sess.run(None, {"input_features": got})[0].ravel()[0])
    do = abs(p_ref - p_got)
    worst_feat, worst_out = max(worst_feat, df), max(worst_out, do)
    print(f"  {name:8s} feature Δ {df:.2e}   probability {p_got:.6f} vs {p_ref:.6f}  Δ {do:.2e}")

print(f"\nworst feature Δ {worst_feat:.3e} · worst probability Δ {worst_out:.3e}")
ok = worst_feat < 1e-4 and worst_out < 1e-4
print("MATCH — the numpy frontend is the reference frontend" if ok else
      "MISMATCH — DO NOT SHIP; the agent would score real speech on wrong features")
sys.exit(0 if ok else 1)
