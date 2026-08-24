from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Dict, List, Protocol, Union

from .models import AuditEvent


class AuditSink(Protocol):
    def append(self, event: AuditEvent) -> None: ...


class AuditLogger:
    def __init__(self, sink: AuditSink, hash_salt: bytes):
        self.sink = sink
        self.hash_salt = hash_salt

    def uid_hash(self, uid: str) -> str:
        return hashlib.sha256(self.hash_salt + uid.encode()).hexdigest()[:24]

    def record(
        self,
        uid: str,
        event_type: str,
        outcome: str = "success",
        metadata: Dict[str, Union[str, int, bool]] | None = None,
    ) -> AuditEvent:
        event = AuditEvent(
            event_id=secrets.token_urlsafe(18),
            uid_hash=self.uid_hash(uid),
            event_type=event_type,
            outcome=outcome,
            occurred_at=datetime.now(timezone.utc),
            metadata=metadata or {},
        )
        self.sink.append(event)
        return event


class MemoryAuditSink:
    def __init__(self) -> None:
        self.events: List[AuditEvent] = []

    def append(self, event: AuditEvent) -> None:
        self.events.append(event)
