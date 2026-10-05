"""Average the per-answer scores and pick a route. Exact Decimal math, no float drift."""
from dataclasses import dataclass
from decimal import ROUND_DOWN, Decimal
from typing import Mapping, Optional

from .config import (
    FIELDS, ROUTE_STANDARD, ROUTE_VERIFICATION, ROUTE_VERIFICATION_2,
    STANDARD_MIN, VERIFICATION_MIN,
)

URGENT_REQUEST = "URGENT_REQUEST"


@dataclass(frozen=True)
class Routing:
    average: str    # truncated, never rounded up, so a displayed 0.85 always means STANDARD
    route: str
    reason: str


def decide(scores: Mapping[str, Decimal], urgent_request: bool = False) -> Routing:
    """Unanswered fields count as 0. A caller asking urgently for a person bypasses the average."""
    total = sum((scores.get(f, Decimal("0")) for f in FIELDS), Decimal("0"))
    n = Decimal(len(FIELDS))
    avg = (total / n).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    if urgent_request:
        return Routing(str(avg), ROUTE_STANDARD, URGENT_REQUEST)
    # Compare total against threshold * n (exact) instead of dividing.
    if total >= STANDARD_MIN * n:
        return Routing(str(avg), ROUTE_STANDARD, "AVERAGE_HIGH")
    if total >= VERIFICATION_MIN * n:
        return Routing(str(avg), ROUTE_VERIFICATION, "AVERAGE_MEDIUM")
    return Routing(str(avg), ROUTE_VERIFICATION_2, "AVERAGE_LOW")
