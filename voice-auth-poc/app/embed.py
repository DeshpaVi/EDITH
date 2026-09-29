"""Speaker embedding (SpeechBrain ECAPA-TDNN). Imports torch lazily so scoring/mkv tests stay light."""
from __future__ import annotations

import os
from typing import Sequence

import numpy as np

MODEL_DIR = os.environ.get("MODEL_DIR", "/opt/model")
MODEL_SOURCE = "speechbrain/spkrec-ecapa-voxceleb"
MODEL_SR = 16000
MIN_SPEECH_SECONDS = 3.0  # below this an embedding is noise; caller decides what to do

_enc = None


def encoder():
    global _enc
    if _enc is None:
        from speechbrain.inference.speaker import EncoderClassifier

        _enc = EncoderClassifier.from_hparams(source=MODEL_SOURCE, savedir=MODEL_DIR, run_opts={"device": "cpu"})
    return _enc


def pcm16_to_float(pcm: bytes) -> np.ndarray:
    return np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0


def trim_silence(wav: np.ndarray, sr: int, frame_ms: int = 30, rel_db: float = -35.0) -> np.ndarray:
    """Energy gate: keep frames within `rel_db` of the loudest frame. Silence dilutes the embedding
    and inflates similarity between different speakers."""
    n = int(sr * frame_ms / 1000)
    if len(wav) < n:
        return wav
    frames = wav[: len(wav) // n * n].reshape(-1, n)
    rms = np.sqrt((frames**2).mean(axis=1) + 1e-12)
    keep = rms > rms.max() * (10 ** (rel_db / 20))
    return frames[keep].reshape(-1)


def embed(wav: np.ndarray, sr: int) -> np.ndarray:
    """1-D float32 waveform -> L2-normalised 192-d vector. Resamples to 16 kHz.
    Upsampling 8 kHz audio matches the model's input shape; it does not recover lost bandwidth."""
    import torch
    import torchaudio

    x = torch.from_numpy(np.ascontiguousarray(wav, dtype=np.float32))
    if sr != MODEL_SR:
        x = torchaudio.functional.resample(x, sr, MODEL_SR)
    with torch.no_grad():
        e = encoder().encode_batch(x.unsqueeze(0)).squeeze()
    e = torch.nn.functional.normalize(e, dim=0)
    return e.numpy().astype(np.float32)


def speech_seconds(wav: np.ndarray, sr: int) -> float:
    return len(wav) / sr


def average(embeddings: Sequence[np.ndarray]) -> np.ndarray:
    m = np.stack(embeddings).mean(axis=0)
    return (m / np.linalg.norm(m)).astype(np.float32)
