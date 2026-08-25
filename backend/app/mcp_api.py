from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import date
from typing import Any, ClassVar, Dict, List

from .audit import AuditLogger
from .models import EntityType, ReminderContent, TaskContent
from .planner import PlannerEngine
from .rag import RetrievalService, record_text
from .repository import PlannerRepository


class McpSessionManager:
    def __init__(self, secret: bytes, ttl_seconds: int = 3600):
        if len(secret) < 32:
            raise ValueError("MCP session secret must be at least 32 bytes")
        self.secret = secret
        self.ttl_seconds = ttl_seconds

    def issue(self, uid: str) -> str:
        payload = json.dumps({
            "uid": uid, "exp": int(time.time()) + self.ttl_seconds,
            "nonce": secrets.token_urlsafe(12),
        }, separators=(",", ":")).encode()
        signature = hmac.new(self.secret, payload, hashlib.sha256).digest()
        encoded_payload = base64.urlsafe_b64encode(payload).decode().rstrip("=")
        encoded_signature = base64.urlsafe_b64encode(signature).decode().rstrip("=")
        return f"{encoded_payload}.{encoded_signature}"

    def verify(self, token: str, uid: str) -> None:
        try:
            encoded_payload, encoded_signature = token.split(".", 1)
            payload = base64.urlsafe_b64decode(
                encoded_payload + "=" * (-len(encoded_payload) % 4)
            )
            signature = base64.urlsafe_b64decode(
                encoded_signature + "=" * (-len(encoded_signature) % 4)
            )
            expected = hmac.new(self.secret, payload, hashlib.sha256).digest()
            data = json.loads(payload)
        except Exception as exc:
            raise PermissionError("Invalid MCP session") from exc
        if not hmac.compare_digest(signature, expected):
            raise PermissionError("Invalid MCP session")
        if data.get("uid") != uid or int(data.get("exp", 0)) < int(time.time()):
            raise PermissionError("MCP session is expired or belongs to another user")


class McpToolService:
    """Read-only MCP tool dispatcher. UID comes only from the verified session."""

    TOOL_SCHEMAS: ClassVar[List[Dict[str, Any]]] = [
        {"name": "tasks", "description": "List the authenticated user's tasks",
         "inputSchema": {"type": "object", "properties": {"include_completed": {"type": "boolean"}},
                         "additionalProperties": False}},
        {"name": "reminders", "description": "List the authenticated user's reminders",
         "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
        {"name": "notes", "description": "List note titles for the authenticated user",
         "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
        {"name": "calendar_window", "description": "Read planner items in a date window",
         "inputSchema": {"type": "object", "required": ["start", "end"], "properties": {
             "start": {"type": "string", "format": "date"}, "end": {"type": "string", "format": "date"}},
             "additionalProperties": False}},
        {"name": "workload_summary", "description": "Get deterministic workload findings",
         "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
        {"name": "planner_search", "description": "Search approved indexed planner records",
         "inputSchema": {"type": "object", "required": ["query"], "properties": {
             "query": {"type": "string", "minLength": 1, "maxLength": 8000}},
             "additionalProperties": False}},
    ]

    def __init__(
        self, repository: PlannerRepository, retrieval: RetrievalService,
        planner: PlannerEngine, audit: AuditLogger,
    ):
        self.repository = repository
        self.retrieval = retrieval
        self.planner = planner
        self.audit = audit

    def call(self, uid: str, name: str, arguments: Dict[str, Any]) -> Any:
        if "uid" in arguments or "user_id" in arguments:
            self.audit.record(uid, "mcp_access", "denied", {"tool": name})
            raise PermissionError("UID is session-bound and cannot be supplied as a tool argument")
        contracts = {
            "tasks": ({"include_completed"}, set()),
            "reminders": (set(), set()),
            "notes": (set(), set()),
            "calendar_window": ({"start", "end"}, {"start", "end"}),
            "workload_summary": (set(), set()),
            "planner_search": ({"query"}, {"query"}),
        }
        if name not in contracts:
            raise KeyError(f"Unknown MCP tool: {name}")
        allowed, required = contracts[name]
        if set(arguments) - allowed or required - set(arguments):
            raise ValueError("MCP tool arguments do not match the declared schema")
        if "include_completed" in arguments and not isinstance(arguments["include_completed"], bool):
            raise ValueError("include_completed must be a boolean")
        for key in required:
            if not isinstance(arguments[key], str):
                raise ValueError(f"{key} must be a string")
        if name == "planner_search" and not 1 <= len(arguments["query"]) <= 8000:
            raise ValueError("Search query length is invalid")
        if name == "tasks":
            records = self.repository.list_records(uid, EntityType.task)
            if not arguments.get("include_completed", False):
                records = [record for record in records if not record.content.completed]  # type: ignore[union-attr]
            result = [record.model_dump(mode="json") for record in records]
        elif name == "reminders":
            result = [record.model_dump(mode="json") for record in
                      self.repository.list_records(uid, EntityType.reminder)]
        elif name == "notes":
            result = [{"record_id": record.record_id, "revision": record.revision,
                       "title": record.content.title} for record in
                      self.repository.list_records(uid, EntityType.note)]
        elif name == "calendar_window":
            start, end = date.fromisoformat(arguments["start"]), date.fromisoformat(arguments["end"])
            result = []
            for kind in (EntityType.task, EntityType.reminder, EntityType.schedule):
                for record in self.repository.list_records(uid, kind):
                    content = record.content
                    item_date = (content.due_date if isinstance(content, TaskContent) else
                                 content.date if isinstance(content, ReminderContent) else
                                 content.starts_at.date())
                    if item_date and start <= item_date <= end:
                        result.append(record.model_dump(mode="json"))
        elif name == "workload_summary":
            records = []
            for kind in EntityType:
                records.extend(self.repository.list_records(uid, kind))
            capacity = self.repository.get_planner_settings(uid).max_daily_minutes
            result = [item.model_dump(mode="json")
                      for item in self.planner.analyze(records, max_daily_minutes=capacity)]
        elif name == "planner_search":
            records, citations = self.retrieval.retrieve(uid, str(arguments["query"]))
            result = [{"citation": citation.model_dump(mode="json"),
                       "record": record_text(record)} for record, citation in zip(records, citations)]
        self.audit.record(uid, "mcp_access", metadata={"tool": name, "result_count": len(result)})
        return result
