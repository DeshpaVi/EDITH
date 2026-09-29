#!/usr/bin/env python3
"""Stopgap impostors: build data/libri_<id>/clipN.wav from Mini LibriSpeech (public, CC BY 4.0).

Downloads ~126 MB from openslr.org, picks N speakers, and joins their utterances into ~30 s clips
(16 kHz mono WAV). These are studio recordings, not phone audio: run stage1_eval.py with
--telephony. This is weak evidence that the model separates voices; a real colleague over the
same phone route is better.

    pip install soundfile numpy
    python scripts/fetch_public_speakers.py --out data --speakers 3
"""
import argparse
import io
import tarfile
import urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf

URL = "https://www.openslr.org/resources/31/dev-clean-2.tar.gz"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("data"))
    ap.add_argument("--speakers", type=int, default=3)
    ap.add_argument("--clips", type=int, default=3)
    ap.add_argument("--seconds", type=float, default=30.0)
    a = ap.parse_args()

    print("downloading", URL)
    raw = urllib.request.urlopen(URL).read()
    utts = defaultdict(list)  # speaker -> [(name, samples)]
    with tarfile.open(fileobj=io.BytesIO(raw)) as t:
        for m in t:
            if m.name.endswith(".flac"):
                spk = m.name.split("/")[-3]
                wav, sr = sf.read(io.BytesIO(t.extractfile(m).read()), dtype="float32")
                assert sr == 16000
                utts[spk].append((m.name, wav))

    need = int(a.seconds * 16000)
    chosen = [s for s in sorted(utts) if sum(len(w) for _, w in utts[s]) >= need * a.clips][: a.speakers]
    for spk in chosen:
        pool = np.concatenate([w for _, w in sorted(utts[spk])])
        d = a.out / f"libri_{spk}"
        d.mkdir(parents=True, exist_ok=True)
        for i in range(a.clips):
            sf.write(d / f"clip{i + 1}.wav", pool[i * need:(i + 1) * need], 16000, subtype="PCM_16")
        print("wrote", d)


if __name__ == "__main__":
    main()
