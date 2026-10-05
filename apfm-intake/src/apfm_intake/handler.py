"""Lambda entry point behind the ACXD Data requests.

Two actions, selected by the `action` request field:
  save_field   - score one answer and store it. Returns only {"saved": true}: the response
                 carries no score and no next step, so the agent has nothing to act on.
  get_summary  - after the last question: average, route and flat apfm_* attributes.

TODO(acxd-schema): the request/response shapes below are ours; they define the Data request
request/response models. How ACXD wraps an External request (body vs query, headers) must be
confirmed against a real Data request test before relying on it.
"""
import hmac
import json
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from .config import FIELDS
from .routing import decide
from .scoring import score_field
from .store import DynamoStore

log = logging.getLogger()
log.setLevel(logging.INFO)

_store = None


def _default_store():
    global _store
    if _store is None:
        _store = DynamoStore()
    return _store


def _response(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": {"Content-Type": "application/json"}, "body": json.dumps(body)}


def _authorized(event: dict) -> bool:
    token = os.environ.get("APFM_API_TOKEN")
    if not token:  # fail closed: never run unauthenticated
        return False
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    return hmac.compare_digest(headers.get("authorization", ""), f"Bearer {token}")


def _mask_digits(text: str) -> str:
    return "".join("#" if c.isdigit() else c for c in text)


def lambda_handler(event, context=None, store=None):
    store = store or _default_store()
    if not _authorized(event):
        return _response(401, {"error": "unauthorized"})
    try:
        body = json.loads(event["body"]) if isinstance(event.get("body"), str) else (event.get("body") or event)
        action = body.get("action")
        cid = body["conversation_id"]
        if action == "save_field":
            return _save_field(store, cid, body)
        if action == "get_summary":
            return _get_summary(store, cid, body)
        return _response(400, {"error": f"unknown action: {action}"})
    except (KeyError, ValueError, json.JSONDecodeError) as e:
        return _response(400, {"error": f"bad request: {e}"})


def _save_field(store, cid: str, body: dict) -> dict:
    field = body["field"]
    if field not in FIELDS:  # never silently drop an unknown field
        return _response(400, {"saved": False, "error": f"unknown field: {field}"})
    quote = body.get("evidence_quote", "")
    scored = score_field(field, body.get("value", ""), quote, body.get("evidence_type"), body.get("ani"))
    # A repeated field overwrites the earlier answer (caller changed their mind).
    store.put_field(cid, field, {
        "value": scored.value,
        "score": str(scored.score),
        "label": scored.label,
        "evidence": _mask_digits(quote) if field == "phone" else quote,
        "ts": datetime.now(timezone.utc).isoformat(),
    })
    log.info("scored field=%s score=%s label=%s", field, scored.score, scored.label)  # no values in logs
    return _response(200, {"saved": True})


def _get_summary(store, cid: str, body: dict) -> dict:
    item = store.get(cid)
    if body.get("urgent_request"):
        store.set_flag(cid, "urgent_request", True)
    urgent = bool(body.get("urgent_request") or item.get("urgent_request"))
    scores = {f: Decimal(r["score"]) for f, r in item["fields"].items()}
    routing = decide(scores, urgent_request=urgent)
    out = {
        "apfm_avg_score": routing.average,
        "apfm_route": routing.route,
        "apfm_route_reason": routing.reason,
        "apfm_answered_count": sum(1 for f in FIELDS if f in item["fields"]),
        "apfm_urgent": urgent or item["fields"].get("move_timeline", {}).get("value") == "URGENT",
        "apfm_escalation_reason": body.get("escalation_reason", ""),
    }
    for f in FIELDS:
        r = item["fields"].get(f)
        out[f"apfm_{f}"] = r["value"] if r else ""
        out[f"apfm_{f}_score"] = r["score"] if r else "0"
        out[f"apfm_{f}_evidence"] = r["evidence"] if r else ""
    return _response(200, out)
