import json
import os
import unittest
from decimal import Decimal

from apfm_intake.handler import lambda_handler
from apfm_intake.routing import decide
from apfm_intake.store import MemoryStore

D = Decimal
FIELDS = ("caller_for", "benefit_type", "phone", "city", "care_level", "move_timeline")


def scores(*vals):
    return {f: D(v) for f, v in zip(FIELDS, vals)}


class TestDecide(unittest.TestCase):
    def test_all_high(self):
        r = decide(scores("0.95", "0.90", "0.95", "0.90", "0.90", "0.95"))
        self.assertEqual((r.route, r.average), ("STANDARD", "0.92"))

    def test_all_medium(self):
        self.assertEqual(decide(scores("0.70", "0.65", "0.80", "0.75", "0.60", "0.85")).route, "VERIFICATION")

    def test_mixed_average_decides(self):
        # 0.95, 0.90, 0.70, 0.65, 0.90, 0.60 -> 4.70 / 6 = 0.78
        r = decide(scores("0.95", "0.90", "0.70", "0.65", "0.90", "0.60"))
        self.assertEqual((r.route, r.average), ("VERIFICATION", "0.78"))

    def test_one_weak_answer_is_hidden_by_plain_average(self):
        # Agreed behaviour: plain average, no per-field floor.
        self.assertEqual(decide(scores("0.95", "0.95", "0.50", "0.95", "0.95", "0.95")).route, "STANDARD")

    def test_exact_boundaries(self):
        self.assertEqual(decide(scores(*["0.85"] * 6)).route, "STANDARD")
        self.assertEqual(decide(scores(*["0.60"] * 6)).route, "VERIFICATION")
        self.assertEqual(decide(scores(*["0.59"] * 6)).route, "VERIFICATION_2")

    def test_average_just_under_standard_does_not_display_as_standard(self):
        r = decide(scores("0.85", "0.85", "0.85", "0.85", "0.85", "0.84"))
        self.assertEqual((r.route, r.average), ("VERIFICATION", "0.84"))

    def test_unanswered_counts_as_zero(self):
        # four 0.95 answers + two missing = 3.80 / 6 = 0.63
        r = decide({f: D("0.95") for f in FIELDS[:4]})
        self.assertEqual((r.route, r.average), ("VERIFICATION", "0.63"))

    def test_nothing_answered(self):
        self.assertEqual(decide({}).route, "VERIFICATION_2")

    def test_urgent_request_bypasses_average(self):
        r = decide({}, urgent_request=True)
        self.assertEqual((r.route, r.reason), ("STANDARD", "URGENT_REQUEST"))


class TestHandler(unittest.TestCase):
    def setUp(self):
        os.environ["APFM_API_TOKEN"] = "t0k"
        self.store = MemoryStore()

    def call(self, body, token="t0k"):
        event = {"headers": {"Authorization": f"Bearer {token}"}, "body": json.dumps(body)}
        res = lambda_handler(event, None, store=self.store)
        return res["statusCode"], json.loads(res["body"])

    def save(self, field, quote, value="", **kw):
        return self.call({"action": "save_field", "conversation_id": "c1", "field": field,
                          "value": value, "evidence_quote": quote, **kw})

    def test_save_reveals_nothing_to_the_agent(self):
        status, body = self.save("caller_for", "my mom", "RELATIVE")
        self.assertEqual((status, body), (200, {"saved": True}))

    def test_end_to_end_summary(self):
        self.save("caller_for", "my mom", "RELATIVE")
        self.save("benefit_type", "assisted living", "HOUSING")
        self.save("phone", "415 555 0132")
        self.save("city", "Dallas, Texas")
        self.save("care_level", "memory issues", "MEMORY")
        self.save("move_timeline", "next month", "1_MONTH")
        status, s = self.call({"action": "get_summary", "conversation_id": "c1"})
        self.assertEqual(status, 200)
        self.assertEqual((s["apfm_route"], s["apfm_avg_score"], s["apfm_answered_count"]), ("STANDARD", "0.92", 6))
        self.assertEqual((s["apfm_phone"], s["apfm_phone_evidence"]), ("+14155550132", "### ### ####"))
        self.assertFalse(s["apfm_urgent"])

    def test_changed_answer_overwrites(self):
        self.save("caller_for", "a friend", "OTHER")
        self.save("caller_for", "actually it's for my dad", "RELATIVE")
        _, s = self.call({"action": "get_summary", "conversation_id": "c1"})
        self.assertEqual((s["apfm_caller_for"], s["apfm_caller_for_score"]), ("RELATIVE", "0.95"))

    def test_partial_call_routes_to_lower_queue(self):
        self.save("caller_for", "my mom", "RELATIVE")
        _, s = self.call({"action": "get_summary", "conversation_id": "c1"})
        self.assertEqual((s["apfm_route"], s["apfm_answered_count"]), ("VERIFICATION_2", 1))

    def test_urgent_request(self):
        _, s = self.call({"action": "get_summary", "conversation_id": "c9", "urgent_request": True,
                          "escalation_reason": "caller asked for a person"})
        self.assertEqual((s["apfm_route"], s["apfm_urgent"], s["apfm_escalation_reason"]),
                         ("STANDARD", True, "caller asked for a person"))

    def test_auth_fails_closed(self):
        self.assertEqual(self.call({"action": "get_summary", "conversation_id": "c1"}, token="bad")[0], 401)
        del os.environ["APFM_API_TOKEN"]
        self.assertEqual(self.call({"action": "get_summary", "conversation_id": "c1"})[0], 401)

    def test_unknown_field_and_action_rejected(self):
        self.assertEqual(self.save("budget_range", "x")[0], 400)
        self.assertEqual(self.call({"action": "nope", "conversation_id": "c1"})[0], 400)
        self.assertEqual(self.call({"action": "save_field"})[0], 400)


if __name__ == "__main__":
    unittest.main()
