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


def load(path: Path, telephony: bool) -> np.ndarray:
    import torchaudio

    wav, sr = torchaudio.load(str(path))
    wav = wav.mean(dim=0)
    if telephony:
        wav = torchaudio.functional.resample(wav, sr, 8000)
        sr = 8000
    return embed.embed(embed.trim_silence(wav.numpy(), sr), sr)


def stats(label: str, xs: list[float]) -> None:
    if xs:
        print(f"{label:9s} n={len(xs):3d}  min={min(xs):.3f}  mean={np.mean(xs):.3f}  max={max(xs):.3f}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("data", type=Path)
    ap.add_argument("--telephony", action="store_true", help="downsample to 8 kHz first")
    a = ap.parse_args()

    embs = {d.name: [load(w, a.telephony) for w in sorted(d.glob("*.wav"))] for d in sorted(a.data.iterdir()) if d.is_dir()}
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
