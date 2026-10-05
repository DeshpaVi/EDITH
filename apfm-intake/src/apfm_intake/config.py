"""Fields, allowed values and thresholds. Thresholds are config, never prompt text."""
import os
from decimal import Decimal

FIELDS = ("caller_for", "benefit_type", "phone", "city", "care_level", "move_timeline")

ALLOWED_VALUES = {
    "caller_for": {"SELF", "RELATIVE", "COUPLE", "OTHER"},
    "benefit_type": {"HOUSING", "VETERAN", "BOTH", "OUT_OF_SCOPE"},
    "care_level": {"ASSISTED", "MEMORY", "INDEPENDENT"},
    "move_timeline": {"URGENT", "1_MONTH", "3_MONTHS", "EXPLORING"},
}

# Routing bands, applied to the plain average of per-field scores.
STANDARD_MIN = Decimal(os.environ.get("APFM_STANDARD_MIN", "0.85"))
VERIFICATION_MIN = Decimal(os.environ.get("APFM_VERIFICATION_MIN", "0.60"))

ROUTE_STANDARD = "STANDARD"
ROUTE_VERIFICATION = "VERIFICATION"
ROUTE_VERIFICATION_2 = "VERIFICATION_2"

# Generic evidence_type -> score, used only when no per-field rule matches.
EVIDENCE_SCORES = {
    "EXPLICIT": Decimal("0.95"),
    "SPECIFIC_TERM": Decimal("0.85"),
    "INFERRED": Decimal("0.70"),
    "AMBIGUOUS": Decimal("0.60"),
    "WEAK": Decimal("0.45"),
    "NONE": Decimal("0"),
}

RECORD_TTL_SECONDS = 24 * 60 * 60
