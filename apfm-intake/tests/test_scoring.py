"""One case per spreadsheet row for the six POC fields: (field, caller words, value, expected value, score)."""
import unittest
from decimal import Decimal

from apfm_intake.scoring import score_field

D = Decimal
ANI = "+14155550132"

CASES = [
    # Q1 caller_for
    ("caller_for", "it's for me", "SELF", "SELF", "0.95"),
    ("caller_for", "my mom needs help", "RELATIVE", "RELATIVE", "0.95"),
    ("caller_for", "my father-in-law", "RELATIVE", "RELATIVE", "0.95"),
    ("caller_for", "my parents", "RELATIVE", "RELATIVE", "0.90"),
    ("caller_for", "a family member", "RELATIVE", "RELATIVE", "0.90"),
    ("caller_for", "my wife", "RELATIVE", "RELATIVE", "0.85"),
    ("caller_for", "I can't manage at home anymore", "SELF", "SELF", "0.70"),
    ("caller_for", "both of us", "COUPLE", "COUPLE", "0.65"),
    ("caller_for", "me and my wife", "COUPLE", "COUPLE", "0.65"),
    ("caller_for", "a friend", "OTHER", "OTHER", "0.60"),
    ("caller_for", "my patient", "OTHER", "OTHER", "0.60"),
    ("caller_for", "not sure", "", "", "0.30"),
    ("caller_for", "just looking", "", "", "0.30"),
    # Q2 benefit_type
    ("benefit_type", "somewhere to live", "HOUSING", "HOUSING", "0.95"),
    ("benefit_type", "assisted living", "HOUSING", "HOUSING", "0.90"),
    ("benefit_type", "nursing home", "HOUSING", "HOUSING", "0.90"),
    ("benefit_type", "VA benefits", "VETERAN", "VETERAN", "0.95"),
    ("benefit_type", "Aid and Attendance", "VETERAN", "VETERAN", "0.85"),
    ("benefit_type", "he's getting forgetful, needs more care", "HOUSING", "HOUSING", "0.70"),
    ("benefit_type", "both housing and VA benefits", "BOTH", "BOTH", "0.75"),
    ("benefit_type", "I'm a veteran", "VETERAN", "VETERAN", "0.65"),
    ("benefit_type", "Medicaid", "OUT_OF_SCOPE", "OUT_OF_SCOPE", "0.30"),
    ("benefit_type", "I don't know", "", "", "0.30"),
    # Q7 care_level
    ("care_level", "needs help with bathing", "ASSISTED", "ASSISTED", "0.90"),
    ("care_level", "memory issues, wandering", "MEMORY", "MEMORY", "0.90"),
    ("care_level", "mostly independent", "INDEPENDENT", "INDEPENDENT", "0.90"),
    ("care_level", "some help, not sure", "", "", "0.60"),
    # Q9 move_timeline
    ("move_timeline", "ASAP", "URGENT", "URGENT", "0.95"),
    ("move_timeline", "this week", "URGENT", "URGENT", "0.95"),
    ("move_timeline", "next month", "1_MONTH", "1_MONTH", "0.90"),
    ("move_timeline", "a few months", "3_MONTHS", "3_MONTHS", "0.85"),
    ("move_timeline", "just researching", "EXPLORING", "EXPLORING", "0.90"),
    ("move_timeline", "not sure", "", "", "0.50"),
    # Q3 phone (value is ignored when the caller's words carry the digits)
    ("phone", "415 555 0132", "", "+14155550132", "0.95"),
    ("phone", "1 415 555 0132", "", "+14155550132", "0.90"),
    ("phone", "this number", "", ANI, "0.90"),
    ("phone", "the one I'm calling from", "", ANI, "0.90"),
    ("phone", "four one five five five five oh one three two", "", "+14155550132", "0.85"),
    ("phone", "415 double five five 0132", "", "+14155550132", "0.85"),
    ("phone", "555 0132", "", "", "0.50"),
    ("phone", "415 555 01", "", "", "0.30"),
    ("phone", "415 555 0132 99", "", "", "0.30"),
    ("phone", "why do you need that?", "", "", "0"),
    # Q4 city
    ("city", "Dallas, Texas", "", "Dallas, TX", "0.95"),
    ("city", "Tampa Florida", "", "Tampa, FL", "0.95"),
    ("city", "85001", "", "85001", "0.90"),
    ("city", "Phoenix", "", "Phoenix, AZ", "0.90"),
    ("city", "Columbus", "", "Columbus", "0.80"),
    ("city", "LA", "", "Los Angeles, CA", "0.75"),
    ("city", "NYC", "", "New York, NY", "0.75"),
    ("city", "Philly", "", "Philadelphia, PA", "0.75"),
    ("city", "outside Houston", "", "Houston, TX", "0.65"),
    ("city", "near Denver", "", "Denver, CO", "0.65"),
    ("city", "Brooklyn", "", "New York, NY", "0.60"),
    ("city", "Florida", "", "", "0.45"),
    ("city", "far from here", "", "", "0.30"),
    ("city", "the US", "", "", "0.30"),
]


class TestSpreadsheetRows(unittest.TestCase):
    def test_rows(self):
        for field, quote, value, exp_value, exp_score in CASES:
            with self.subTest(field=field, quote=quote):
                got = score_field(field, value, quote, ani=ANI)
                self.assertEqual(got.score, D(exp_score), got)
                self.assertEqual(got.value, exp_value, got)


class TestBehaviour(unittest.TestCase):
    def test_slot_value_disagreeing_with_words_is_weak(self):
        got = score_field("caller_for", "SELF", "my mom")
        self.assertEqual((got.value, got.score, got.label), ("RELATIVE", D("0.45"), "MISMATCH"))

    def test_evidence_type_fallback_when_no_rule_matches(self):
        got = score_field("caller_for", "RELATIVE", "she is my favourite person", "INFERRED")
        self.assertEqual((got.value, got.score), ("RELATIVE", D("0.70")))

    def test_invalid_value_never_scored_from_evidence(self):
        self.assertEqual(score_field("care_level", "BANANA", "zzz", "EXPLICIT").score, D("0"))

    def test_ani_without_ani_is_low(self):
        self.assertEqual(score_field("phone", "", "this number").score, D("0.30"))

    def test_invalid_area_code_rejected(self):
        self.assertEqual(score_field("phone", "", "115 555 0132").score, D("0.30"))

    def test_unknown_city_is_unverified_not_unique(self):
        got = score_field("city", "", "Smallville")
        self.assertEqual((got.score, got.label), (D("0.75"), "UNVERIFIED_CITY"))

    def test_unknown_field_raises(self):
        with self.assertRaises(ValueError):
            score_field("budget_range", "x", "x")


if __name__ == "__main__":
    unittest.main()
