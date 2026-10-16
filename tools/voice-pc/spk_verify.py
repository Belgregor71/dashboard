"""Prove speaker_id.py's numpy frontend before anything trusts it.

Same idea as tools/voice-agent/st_verify.py: a model fed the wrong frontend
returns confident nonsense, so the frontend is checked against an independent
implementation, not against the docs.

1. EQUIVALENCE. sherpa-onnx computes the same model's embedding end to end with
   its own C++ fbank. Each (window, cmn) combination of speaker_id.fbank is
   compared with it; the machinery is proven only if one reaches cos >= 0.999.
2. SEPARATION. With wespeaker's TRAINING frontend (hamming + cmn), the two
   halves of one real recording must score higher than halves of different
   recordings. Speed and geometry only; thresholds come from the room.

Run in a throwaway venv that has sherpa-onnx (NEVER the live voice-stt venv):
    python -I spk_verify.py <model.onnx> <a.wav> <b.wav> [...]
Exit 0 on pass, 1 on fail.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

import speaker_id as sid  # noqa: E402


def knf_fbank(samples_i16):
    import kaldi_native_fbank as knf

    o = knf.FbankOptions()
    o.frame_opts.samp_freq = sid.SAMPLE_RATE
    o.frame_opts.frame_length_ms = 25
    o.frame_opts.frame_shift_ms = 10
    o.frame_opts.dither = 0.0
    o.frame_opts.window_type = "hamming"
    o.frame_opts.snip_edges = True
    o.frame_opts.remove_dc_offset = True
    o.frame_opts.preemph_coeff = 0.97
    o.frame_opts.round_to_power_of_two = True
    o.mel_opts.num_bins = sid.N_MELS
    o.mel_opts.low_freq = 20
    o.mel_opts.high_freq = 0  # 0 = Nyquist, as in torchaudio / Kaldi
    o.use_energy = False
    o.use_log_fbank = True
    o.use_power = True
    fb = knf.OnlineFbank(o)
    fb.accept_waveform(sid.SAMPLE_RATE, samples_i16.astype(np.float32).tolist())
    fb.input_finished()
    return np.array([fb.get_frame(i) for i in range(fb.num_frames_ready)], dtype=np.float32)


def emb_from_feats(model, feats):
    import onnxruntime as ort

    s = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    e = s.run(None, {s.get_inputs()[0].name: feats[None, :, :].astype(np.float32)})[0][0]
    e = np.asarray(e, dtype=np.float64)
    return e / np.linalg.norm(e)


def sherpa_embedding(model, samples_i16):
    import sherpa_onnx

    cfg = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=model, num_threads=1)
    ex = sherpa_onnx.SpeakerEmbeddingExtractor(cfg)
    st = ex.create_stream()
    st.accept_waveform(sample_rate=sid.SAMPLE_RATE, waveform=(samples_i16 / 32768.0).astype(np.float32))
    st.input_finished()
    e = np.asarray(ex.compute(st), dtype=np.float64)
    return e / np.linalg.norm(e)


def main():
    model, wavs = sys.argv[1], sys.argv[2:]
    clips = {}
    for p in wavs:
        with open(p, "rb") as f:
            s = sid.wav_to_samples(f.read())
        if s is None:
            print(f"skip {os.path.basename(p)}: not 16 kHz mono int16")
            continue
        clips[os.path.basename(p)] = s
    if len(clips) < 2:
        print("FAIL need at least two usable clips")
        return 1

    ok = True
    print("== 1. fbank equivalence against kaldi-native-fbank, training settings")
    # The gate. Same options wespeaker's processor.py passes to torchaudio's
    # Kaldi fbank, set EXPLICITLY so no library default can leak in.
    for name, s in clips.items():
        ref = knf_fbank(s)
        mine = sid.fbank(s, "hamming", cmn=False)
        if ref.shape != mine.shape:
            ok = False
            print(f"  FAIL {name}: shape {mine.shape} vs reference {ref.shape}")
            continue
        d = np.abs(ref - mine)
        p99, worst = float(np.percentile(d, 99)), float(d.max())
        # Embedding through the SAME model from the reference features (+ the same
        # CMN) — the number that decides identity, so it is the real gate.
        e_ref = emb_from_feats(model, ref - ref.mean(axis=0, keepdims=True))
        e_mine = sid.Embedder(model, "hamming", True).embed(s)
        c = sid.cosine(e_ref, e_mine)
        print(f"  {name}: {mine.shape[0]} frames, |diff| p99 {p99:.1e} max {worst:.1e}, "
              f"embedding cos {c:.6f}")
        # A wrong window / mel / framing shows as diffs of 0.1-1 in log energy;
        # float32 rounding in near-silent frames stays well under 1e-2.
        if p99 > 1e-3 or worst > 1e-2 or c < 0.9999:
            ok = False
            print("  FAIL features or embedding differ from the Kaldi reference")

    print("== 1b. sherpa-onnx end to end (information only: its frontend is not the training one)")
    for name, s in clips.items():
        ref = sherpa_embedding(model, s)
        row = sorted(((sid.cosine(sid.Embedder(model, w, m).embed(s), ref), w, m)
                      for w in ("povey", "hamming") for m in (False, True)), reverse=True)
        print(f"  {name}: " + "  ".join(f"{w}/{'cmn' if m else 'raw'}={c:.4f}" for c, w, m in row))

    print("== 2. separation, training frontend (hamming + cmn)")
    emb = sid.Embedder(model, "hamming", True)
    halves = {}
    for name, s in clips.items():
        mid = s.size // 2
        halves[name] = (emb.embed(s[:mid]), emb.embed(s[mid:]))
    same = {n: sid.cosine(a, b) for n, (a, b) in halves.items()}
    names = list(halves)
    cross = [(sid.cosine(halves[x][0], halves[y][1]), x, y)
             for i, x in enumerate(names) for y in names[i + 1:]]
    for n, c in same.items():
        print(f"  same  {n}: {c:.3f}")
    for c, x, y in cross:
        print(f"  cross {x} ~ {y}: {c:.3f}")
    worst_same, best_cross = min(same.values()), max(c for c, _, _ in cross)
    print(f"  min same {worst_same:.3f}  vs  max cross {best_cross:.3f}")
    if worst_same <= best_cross:
        ok = False
        print("  FAIL a recording is closer to another voice than to itself")

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
