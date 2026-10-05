"""Per-answer confidence scoring.

Pure functions: (field, value, quote, ...) -> Scored. No I/O, no LLM calls, so scoring
is deterministic and testable against the spreadsheet rows. The score is a side output
and never feeds back into the conversation.
"""
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from .cities import (
    ALIASES, AMBIGUOUS_CITIES, NEIGHBORHOODS, STATE_ABBRS, STATES, UNIQUE_CITIES,
)
from .config import ALLOWED_VALUES, EVIDENCE_SCORES, FIELDS

D = Decimal


@dataclass(frozen=True)
class Scored:
    value: str          # normalized value ("" when nothing usable was captured)
    score: Decimal
    label: str          # which rule / evidence class produced the score


def score_field(field: str, value: str, quote: str, evidence_type: Optional[str] = None,
                ani: Optional[str] = None) -> Scored:
    if field not in FIELDS:
        raise ValueError(f"unknown field: {field}")
    value = (value or "").strip()
    quote = (quote or "").strip()
    if field == "phone":
        return _score_phone(value, quote, ani)
    if field == "city":
        return _score_city(value, quote)
    return _score_enum(field, value, quote, evidence_type)


# ---------------------------------------------------------------- enum fields

# (pattern, mapped value, score, label); first match wins, so order matters.
_RULES = {
    "caller_for": [
        (r"\bnot sure\b|\bjust looking\b|\bdon'?t know\b", "", "0.30", "UNSURE"),
        (r"\bboth of us\b|\bme and my\b|\bmy (wife|husband|partner|spouse) and (i|me)\b|\bwe both\b",
         "COUPLE", "0.65", "COUPLE"),
        (r"\b(friend|client|patient|neighbou?r|co-?worker)\b", "OTHER", "0.60", "NON_FAMILY"),
        (r"\b(mom|mother|dad|father|grand(mother|father|ma|pa)|aunt|uncle|in-law|sister|brother|"
         r"mum|stepmother|stepfather)\b", "RELATIVE", "0.95", "NAMED_RELATIVE"),
        (r"\bparents\b|\bfamily member\b|\brelative\b|\bloved one\b", "RELATIVE", "0.90", "GENERIC_RELATIVE"),
        (r"\b(wife|husband|partner|spouse)\b", "RELATIVE", "0.85", "SPOUSE"),
        (r"\b(me|myself)\b|\bfor me\b", "SELF", "0.95", "EXPLICIT_SELF"),
        (r"can'?t manage|on my own|by myself|at home anymore", "SELF", "0.70", "IMPLICIT_SELF"),
    ],
    "benefit_type": [
        (r"\bmedicaid\b|\bmedicare\b|\binsurance\b", "OUT_OF_SCOPE", "0.30", "OUT_OF_SCOPE"),
        (r"\bboth\b.*\b(va|veteran)\b|\b(va|veteran)\b.*\bboth\b|"
         r"\b(housing|assisted living|memory care)\b.*\b(va|veteran)\b",
         "BOTH", "0.75", "BOTH"),
        (r"aid and attendance|va pension", "VETERAN", "0.85", "SPECIFIC_TERM"),
        (r"\bva benefits?\b|\bveterans?'? benefits?\b", "VETERAN", "0.95", "EXPLICIT_VETERAN"),
        (r"assisted living|memory care|senior living|nursing home", "HOUSING", "0.90", "CARE_TERM"),
        (r"\bhousing\b|somewhere to live|place to live", "HOUSING", "0.95", "EXPLICIT_HOUSING"),
        (r"\bveteran\b", "VETERAN", "0.65", "STATUS_ONLY"),
        (r"forgetful|needs more care|can'?t be alone", "HOUSING", "0.70", "INFERRED_HOUSING"),
        (r"\bdon'?t know\b|\bnot sure\b", "", "0.30", "UNSURE"),
    ],
    "care_level": [
        (r"memory|dementia|alzheimer|wander|forgetful", "MEMORY", "0.90", "MEMORY"),
        (r"bathing|\bmeds?\b|medication|dressing|toilet|help with", "ASSISTED", "0.90", "ASSISTED"),
        (r"independent|on (his|her|their) own|doing fine", "INDEPENDENT", "0.90", "INDEPENDENT"),
        (r"some help|not sure|\bunsure\b", "unclear", "0.60", "UNCLEAR"),
    ],
    "move_timeline": [
        (r"\basap\b|this week|right away|immediately|\burgent|tomorrow|\btoday\b",
         "URGENT", "0.95", "URGENT"),
        (r"next month|in a month|within a month|30 days|few weeks", "1_MONTH", "0.90", "ONE_MONTH"),
        (r"few months|couple (of )?months|three months|3 months", "3_MONTHS", "0.85", "THREE_MONTHS"),
        (r"researching|just looking|exploring|no rush|in no hurry", "EXPLORING", "0.90", "EXPLORING"),
        (r"not sure|don'?t know", "", "0.50", "UNSURE"),
    ],
}
_RULES = {f: [(re.compile(p, re.I), v, D(s), lbl) for p, v, s, lbl in rs] for f, rs in _RULES.items()}


def _score_enum(field: str, value: str, quote: str, evidence_type: Optional[str]) -> Scored:
    allowed = ALLOWED_VALUES[field]
    text = quote or value
    for pattern, mapped, score, label in _RULES[field]:
        if not pattern.search(text):
            continue
        if mapped == "unclear":
            return Scored(value if value in allowed else "", score, label)
        if mapped == "":
            return Scored("", score, label)
        if value and value != mapped:
            # The slot value disagrees with what the caller's words support.
            return Scored(mapped, EVIDENCE_SCORES["WEAK"], "MISMATCH")
        return Scored(mapped, score, label)
    # No rule matched: fall back to the evidence type the agent reported, if the value is valid.
    if value in allowed and evidence_type in EVIDENCE_SCORES:
        return Scored(value, EVIDENCE_SCORES[evidence_type], f"EVIDENCE_{evidence_type}")
    return Scored("", D("0"), "UNSCORED")


# ---------------------------------------------------------------------- phone

_WORD_DIGITS = {
    "zero": "0", "oh": "0", "o": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
}
_REFUSAL = re.compile(r"why do you need|rather not|don'?t want to (give|share)|not comfortable|no thanks", re.I)
_ANI = re.compile(r"this number|calling from|same number|number i'?m (calling|on)|this phone", re.I)
_NANP = re.compile(r"^[2-9]\d{2}[2-9]\d{6}$")


def _spoken_to_digits(text: str):
    """Return (digits, normalized) where normalized is True if any spoken form was converted."""
    tokens = re.findall(r"[a-z]+|\d+", text.lower())
    out, normalized, i = [], False, 0
    while i < len(tokens):
        t = tokens[i]
        if t.isdigit():
            out.append(t)
        elif t in ("double", "triple") and i + 1 < len(tokens):
            nxt = tokens[i + 1]
            digit = nxt if nxt.isdigit() else _WORD_DIGITS.get(nxt)
            if digit:
                out.append(digit * (2 if t == "double" else 3))
                normalized = True
                i += 1
        elif t in _WORD_DIGITS:
            out.append(_WORD_DIGITS[t])
            normalized = True
        i += 1
    return "".join(out), normalized


def _score_phone(value: str, quote: str, ani: Optional[str]) -> Scored:
    text = quote or value
    if _REFUSAL.search(text):
        return Scored("", D("0"), "REFUSED")
    if _ANI.search(text):
        # TODO(acxd-schema): confirm ANI is exposed to the Data request (e.g. as a context variable).
        digits = re.sub(r"\D", "", ani or "")
        if len(digits) == 11 and digits[0] == "1":
            digits = digits[1:]
        if _NANP.match(digits):
            return Scored(f"+1{digits}", D("0.90"), "ANI")
        return Scored("", D("0.30"), "ANI_UNAVAILABLE")
    digits, normalized = _spoken_to_digits(text)
    if not digits and value:
        digits, normalized = _spoken_to_digits(value)
    long_form = len(digits) == 11 and digits[0] == "1"
    core = digits[1:] if long_form else digits
    if _NANP.match(core) and len(core) == 10:
        if normalized:
            return Scored(f"+1{core}", D("0.85"), "SPOKEN_NORMALIZED")
        return Scored(f"+1{core}", D("0.90") if long_form else D("0.95"), "LONG_FORM" if long_form else "TEN_DIGITS")
    if len(digits) == 7:
        return Scored("", D("0.50"), "SEVEN_DIGITS")
    return Scored("", D("0.30"), "INVALID_PHONE")


# ----------------------------------------------------------------------- city

_FAR = re.compile(r"far from here|^the (us|u\.s\.|usa|states)$|^america$|^the us$|^usa$", re.I)
_QUALIFIER = re.compile(r"^(?:outside(?: of)?|near|around|close to|by|just outside)\s+(.+)$", re.I)
_LEAD = re.compile(r"^(?:i'?m|we'?re|i am|we are|it'?s|we live|i live|live|living)?\s*(?:in|at|from)?\s+", re.I)
_ZIP = re.compile(r"\b(\d{5})\b")


def _title(s: str) -> str:
    return " ".join(w.capitalize() for w in s.split())


def _score_city(value: str, quote: str) -> Scored:
    text = (quote or value).strip().strip(".!?").strip()
    low = text.lower()
    if not low or _FAR.search(low):
        return Scored("", D("0.30"), "NO_LOCATION")
    z = _ZIP.search(low)
    if z:
        # TODO(geocode): resolve ZIP to city/state; format-valid ZIP only for now.
        return Scored(z.group(1), D("0.90"), "ZIP")
    low = _LEAD.sub("", low, count=1).strip()
    q = _QUALIFIER.match(low)
    if q:
        place = q.group(1).strip()
        return Scored(_resolve(place), D("0.65"), "QUALIFIED_PLACE")
    if low in ALIASES:
        c, s = ALIASES[low]
        return Scored(f"{c}, {s}", D("0.75"), "ALIAS")
    if low in STATES:
        return Scored("", D("0.45"), "STATE_ONLY")
    city_state = re.match(r"^(.+?)[,\s]+([a-z ]+)$", low)
    if city_state:
        city, st = city_state.group(1).strip(), city_state.group(2).strip()
        abbr = STATES.get(st) or (st.upper() if st.upper() in STATE_ABBRS and len(st) == 2 else None)
        if abbr:
            return Scored(f"{_title(city)}, {abbr}", D("0.95"), "CITY_STATE")
    if low in NEIGHBORHOODS:
        c, s = NEIGHBORHOODS[low]
        return Scored(f"{c}, {s}", D("0.60"), "NEIGHBORHOOD")
    if low in AMBIGUOUS_CITIES:
        return Scored(_title(low), D("0.80"), "AMBIGUOUS_CITY")
    if low in UNIQUE_CITIES:
        return Scored(f"{_title(low)}, {UNIQUE_CITIES[low]}", D("0.90"), "UNIQUE_CITY")
    # TODO(geocode): without a gazetteer hit we cannot call this a unique city.
    return Scored(_title(low), D("0.75"), "UNVERIFIED_CITY")


def _resolve(place: str) -> str:
    place = place.strip().lower()
    if place in UNIQUE_CITIES:
        return f"{_title(place)}, {UNIQUE_CITIES[place]}"
    return _title(place)
