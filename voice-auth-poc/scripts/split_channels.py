#!/usr/bin/env python3
"""Split stereo recordings into mono files so you can listen to which channel is the caller.

    python scripts/split_channels.py data/vipraj

Writes data/_split/<name>_left/ and data/_split/<name>_right/ (mono, same names) and prints each
channel's loudness. Play one clip from each side: the one with your voice is the caller channel.
Then enrol / evaluate using only that channel's files.
"""
import sys
from pathlib import Path

import numpy as np
import soundfile as sf


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    src = Path(sys.argv[1])
    out = src.parent / "_split"
    for wav in sorted(src.glob("*.wav")):
        d, sr = sf.read(str(wav), dtype="float32", always_2d=True)
        if d.shape[1] < 2:
            print(f"{wav.name}: already mono, skipping")
            continue
        for i, side in enumerate(("left", "right")[: d.shape[1]]):
            dest = out / f"{src.name}_{side}"
            dest.mkdir(parents=True, exist_ok=True)
            sf.write(str(dest / wav.name), d[:, i], sr, subtype="PCM_16")
            print(f"{wav.name} {side}: rms={np.sqrt((d[:, i] ** 2).mean()):.4f} -> {dest / wav.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
