from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import RLock
from typing import Callable, Dict, Optional, Protocol, Tuple

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore


class RateLimitExceeded(RuntimeError):
    """Raised when a caller has spent its budget for the current window."""

    def __init__(self, retry_after_seconds: int, message: str | None = None):
        self.retry_after_seconds = retry_after_seconds
        super().__init__(
            message or f"Rate limit exceeded. Retry in {retry_after_seconds} seconds."
        )


@dataclass(frozen=True)
class RateLimitPolicy:
    """A token bucket: `requests` tokens that refill evenly over `window_seconds`.

    Capacity equals the window allowance, so a caller may burst up to `requests`
    and then settles into the sustained rate.
    """

    requests: int
    window_seconds: int

    def __post_init__(self) -> None:
        if self.requests < 1:
            raise ValueError("requests must be at least 1")
        if self.window_seconds < 1:
            raise ValueError("window_seconds must be at least 1")

    @property
    def refill_per_second(self) -> float:
        return self.requests / self.window_seconds


def _spend(
    tokens: float, updated_at: datetime, now: datetime, policy: RateLimitPolicy
) -> Tuple[Optional[float], int]:
    """Refill for elapsed time then take one token.

    Returns the remaining tokens, or `(None, retry_after)` when the bucket is dry.
    Shared by every backend so the arithmetic is identical in tests and production.
    """
    elapsed = max(0.0, (now - updated_at).total_seconds())
    available = min(float(policy.requests), tokens + elapsed * policy.refill_per_second)
    if available < 1.0:
        deficit = 1.0 - available
        return None, max(1, math.ceil(deficit / policy.refill_per_second))
    return available - 1.0, 0


class RateLimiter(Protocol):
    def check(self, uid: str) -> None: ...


class MemoryRateLimiter:
    """Process-local limiter. Correct for tests and single-process runs only.

    Cloud Run serves several workers per instance and scales out, so each process
    would enforce its own budget; production uses the Firestore limiter instead.
    """

    def __init__(
        self, policy: RateLimitPolicy, now: Callable[[], datetime] | None = None
    ) -> None:
        self.policy = policy
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._buckets: Dict[str, Tuple[float, datetime]] = {}
        self._lock = RLock()

    def check(self, uid: str) -> None:
        with self._lock:
            now = self._now()
            tokens, updated_at = self._buckets.get(uid, (float(self.policy.requests), now))
            remaining, retry_after = _spend(tokens, updated_at, now, self.policy)
            if remaining is None:
                raise RateLimitExceeded(retry_after)
            self._buckets[uid] = (remaining, now)


class FirestoreRateLimiter:
    """Shared limiter so the budget holds across workers and instances.

    State lives beside the user's other data at `users/{uid}/limits/{name}` and is
    read-modify-written in a transaction, so concurrent requests cannot both spend
    the last token.
    """

    def __init__(
        self,
        client: firestore.Client,
        policy: RateLimitPolicy,
        name: str = "copilot_chat",
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.client = client
        self.policy = policy
        self.name = name
        self._now = now or (lambda: datetime.now(timezone.utc))

    def _ref(self, uid: str):
        return (
            self.client.collection("users").document(uid)
            .collection("limits").document(self.name)
        )

    def decide(
        self, data: Optional[Dict[str, object]], now: datetime
    ) -> Tuple[Optional[Dict[str, object]], int]:
        """Resolve a stored bucket into the next state, or a retry-after.

        Kept out of the transaction closure so the read-modify-write decision can
        be tested without standing up Firestore.
        """
        if data:
            tokens = float(data.get("tokens", self.policy.requests))  # type: ignore[arg-type]
            updated_at = data.get("updated_at") or now
        else:
            tokens, updated_at = float(self.policy.requests), now
        remaining, retry_after = _spend(tokens, updated_at, now, self.policy)  # type: ignore[arg-type]
        if remaining is None:
            return None, retry_after
        return {"tokens": remaining, "updated_at": now}, 0

    def check(self, uid: str) -> None:
        ref = self._ref(uid)
        now = self._now()
        transaction = self.client.transaction()

        @firestore.transactional
        def spend(txn) -> int:
            snapshot = ref.get(transaction=txn)
            data = snapshot.to_dict() if snapshot.exists else None
            payload, retry_after = self.decide(data, now)
            if payload is None:
                return retry_after
            if snapshot.exists:
                txn.update(ref, payload)
            else:
                txn.set(ref, {**payload, "uid": uid, "limit": self.name})
            return 0

        try:
            retry_after = spend(transaction)
        except AlreadyExists:
            # Another request created the bucket between our read and write. The
            # budget is untouched either way, so let this one through.
            return
        if retry_after:
            raise RateLimitExceeded(retry_after)
