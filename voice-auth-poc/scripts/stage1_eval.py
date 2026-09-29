#!/usr/bin/env python3
"""Stage 1: does the model separate voices on YOUR audio? Runs locally, no AWS.

Layout:  data/<speaker>/*.wav   (>=2 clips per speaker, >=2 speakers, consenting colleagues only)

For every clip: enrol on that speaker's *other* clips, score the held-out clip (genuine trial),
and score it against every other speaker's voiceprint built from all their clips (impostor trials).
`--telephony` downsamples to 8 kHz first, to approximate a phone line.
This validates the pipeline; a handful of speakers cannot give a real FAR/FRR.
"""
import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
import embed  # noqa: E402
from scoring import cosine  # noqa: E402


def load(path: Path, telephony: bool, split: float) -> list[np.ndarray]:
    """One embedding per clip, or per `split`-second chunk of the speech when split > 0."""
    import soundfile as sf  # torchaudio.load now needs torchcodec; soundfile reads WAV/FLAC directly
    import torch
    import torchaudio

    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    wav = torch.from_numpy(data.mean(axis=1))
    if telephony:
        wav = torchaudio.functional.resample(wav, sr, 8000)
        sr = 8000
    wav = embed.trim_silence(wav.numpy(), sr)
    n = int(split * sr) if split > 0 else len(wav)
    chunks = [wav[i:i + n] for i in range(0, len(wav), n)]
    chunks = [c for c in chunks if len(c) >= embed.MIN_SPEECH_SECONDS * sr]  # drop short tail
    return [embed.embed(c, sr) for c in chunks]


def stats(label: str, xs: list[float]) -> None:
    if xs:
        print(f"{label:9s} n={len(xs):3d}  min={min(xs):.3f}  mean={np.mean(xs):.3f}  max={max(xs):.3f}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("data", type=Path)
    ap.add_argument("--telephony", action="store_true", help="downsample to 8 kHz first")
    ap.add_argument("--split", type=float, default=0.0, metavar="SEC",
                    help="cut each clip's speech into SEC-second chunks (e.g. 10) when you only have one long clip per speaker. "
                         "Chunks from one call are correlated, so genuine scores will look optimistic")
    a = ap.parse_args()

    embs = {d.name: [e for w in sorted(d.glob("*.wav")) for e in load(w, a.telephony, a.split)]
            for d in sorted(a.data.iterdir()) if d.is_dir()}
    print({k: len(v) for k, v in embs.items()}, "clips/chunks per speaker")
    embs = {k: v for k, v in embs.items() if len(v) >= 2}
    if len(embs) < 2:
        print("need >=2 speakers with >=2 clips each", file=sys.stderr)
        return 2

    full = {k: embed.average(v) for k, v in embs.items()}
    genuine, impostor = [], []
    for spk, clips in embs.items():
        for i, probe in enumerate(clips):
            genuine.append(cosine(probe, embed.average(clips[:i] + clips[i + 1:])))
            impostor += [cosine(probe, full[o]) for o in embs if o != spk]

    stats("genuine", genuine)
    stats("impostor", impostor)
    gap = min(genuine) - max(impostor)
    print(f"\nseparation (min genuine - max impostor): {gap:+.3f}  ->", "separates" if gap > 0 else "OVERLAPS: fix before building further")
    print("Thresholds: pick from these distributions, do not copy from elsewhere.")
    return 0 if gap > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
