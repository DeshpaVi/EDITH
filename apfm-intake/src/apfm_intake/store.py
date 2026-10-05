"""Per-call state keyed by conversation id. Memory store for tests, DynamoDB for the POC."""
import os
import time
from decimal import Decimal
from typing import Dict, Optional

from .config import RECORD_TTL_SECONDS


class MemoryStore:
    def __init__(self):
        self._items: Dict[str, dict] = {}

    def put_field(self, conversation_id: str, field: str, record: dict) -> None:
        self._items.setdefault(conversation_id, {"fields": {}})["fields"][field] = record

    def set_flag(self, conversation_id: str, name: str, value) -> None:
        self._items.setdefault(conversation_id, {"fields": {}})[name] = value

    def get(self, conversation_id: str) -> dict:
        item = self._items.get(conversation_id, {"fields": {}})
        return {**item, "fields": dict(item["fields"])}


class DynamoStore:
    """One item per conversation; each field is its own top-level attribute so concurrent
    per-answer writes never overwrite each other. Scores are stored as strings (Decimal-safe)."""

    def __init__(self, table_name: Optional[str] = None):
        import boto3  # imported lazily so unit tests need no AWS libs
        self._table = boto3.resource("dynamodb").Table(table_name or os.environ["APFM_TABLE"])

    def _expiry(self) -> int:
        return int(time.time()) + RECORD_TTL_SECONDS

    def put_field(self, conversation_id: str, field: str, record: dict) -> None:
        self._table.update_item(
            Key={"conversation_id": conversation_id},
            UpdateExpression="SET #f = :r, expires_at = :t",
            ExpressionAttributeNames={"#f": f"field_{field}"},
            ExpressionAttributeValues={":r": record, ":t": self._expiry()},
        )

    def set_flag(self, conversation_id: str, name: str, value) -> None:
        self._table.update_item(
            Key={"conversation_id": conversation_id},
            UpdateExpression="SET #n = :v, expires_at = :t",
            ExpressionAttributeNames={"#n": name},
            ExpressionAttributeValues={":v": value, ":t": self._expiry()},
        )

    def get(self, conversation_id: str) -> dict:
        item = self._table.get_item(Key={"conversation_id": conversation_id}, ConsistentRead=True).get("Item", {})
        fields = {k[len("field_"):]: v for k, v in item.items() if k.startswith("field_")}
        return {**{k: v for k, v in item.items() if not k.startswith("field_")}, "fields": fields}
