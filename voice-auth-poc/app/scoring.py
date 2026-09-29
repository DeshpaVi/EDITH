"""Pure scoring logic: no torch, no AWS. Unit-testable in isolation."""
from __future__ import annotations

import math
import re
from typing import Sequence

SPEAKER_ID_RE = re.compile(r"^spk_[a-z0-9]{4,32}$")  # pseudonymous only: never a phone number or name


def valid_speaker_id(speaker_id: str) -> bool:
    return bool(SPEAKER_ID_RE.match(speaker_id or ""))


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        raise ValueError("zero-length embedding")
    return float(dot / (na * nb))


def decide(score: float, low: float, high: float) -> str:
    """Three bands, not pass/fail. The middle band goes to step-up."""
    if low > high:
        raise ValueError(f"low threshold {low} exceeds high threshold {high}")
    if score >= high:
        return "authenticated"
    if score >= low:
        return "inconclusive"
    return "failed"
