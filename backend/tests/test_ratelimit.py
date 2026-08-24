from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.ratelimit import (
    FirestoreRateLimiter,
    MemoryRateLimiter,
    RateLimitExceeded,
    RateLimitPolicy,
)


class FakeClock:
    def __init__(self, start: datetime | None = None):
        self.now = start or datetime(2026, 8, 24, 12, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


def limiter(requests=3, window=60, clock=None):
    return MemoryRateLimiter(RateLimitPolicy(requests, window), now=clock)


def enable_ai(client, auth, retain=False, days=0):
    """The copilot refuses with 403 until the user opts in, so tests must opt in."""
    return client.put("/v1/privacy", headers=auth, json={
        "ai_enabled": True, "indexed_entity_types": [], "index_attachments": False,
        "retain_chat": retain, "chat_retention_days": days,
    })


def test_policy_rejects_nonsense_values():
    with pytest.raises(ValueError):
        RateLimitPolicy(requests=0, window_seconds=60)
    with pytest.raises(ValueError):
        RateLimitPolicy(requests=5, window_seconds=0)


def test_allows_the_full_allowance_then_denies():
    clock = FakeClock()
    limit = limiter(requests=3, window=60, clock=clock)
    for _ in range(3):
        limit.check("alice")
    with pytest.raises(RateLimitExceeded) as excinfo:
        limit.check("alice")
    assert excinfo.value.retry_after_seconds > 0


def test_budgets_are_per_user():
    clock = FakeClock()
    limit = limiter(requests=1, window=60, clock=clock)
    limit.check("alice")
    # Bob is untouched by Alice spending her allowance.
    limit.check("bob")
    with pytest.raises(RateLimitExceeded):
        limit.check("alice")


def test_tokens_refill_over_time():
    clock = FakeClock()
    limit = limiter(requests=2, window=60, clock=clock)
    limit.check("alice")
    limit.check("alice")
    with pytest.raises(RateLimitExceeded):
        limit.check("alice")

    clock.advance(30)  # 60s window / 2 tokens => one token per 30s
    limit.check("alice")
    with pytest.raises(RateLimitExceeded):
        limit.check("alice")


def test_retry_after_is_long_enough_to_actually_succeed():
    clock = FakeClock()
    limit = limiter(requests=2, window=60, clock=clock)
    limit.check("alice")
    limit.check("alice")
    with pytest.raises(RateLimitExceeded) as excinfo:
        limit.check("alice")

    clock.advance(excinfo.value.retry_after_seconds)
    limit.check("alice")  # must not raise


def test_bucket_never_refills_past_capacity():
    clock = FakeClock()
    limit = limiter(requests=2, window=60, clock=clock)
    limit.check("alice")
    clock.advance(86_400)  # idle for a day
    limit.check("alice")
    limit.check("alice")
    with pytest.raises(RateLimitExceeded):
        limit.check("alice")


def test_clock_going_backwards_does_not_grant_free_tokens():
    clock = FakeClock()
    limit = limiter(requests=1, window=60, clock=clock)
    limit.check("alice")
    clock.advance(-600)
    with pytest.raises(RateLimitExceeded):
        limit.check("alice")


def test_chat_endpoint_returns_429_with_retry_after(client, auth, services):
    enable_ai(client, auth)
    services.rate_limiter = MemoryRateLimiter(RateLimitPolicy(requests=1, window_seconds=60))

    first = client.post(
        "/v1/copilot/chat", headers=auth,
        json={"message": "What is due today?", "request_id": "chat-0001"},
    )
    assert first.status_code == 200

    second = client.post(
        "/v1/copilot/chat", headers=auth,
        json={"message": "What is due today?", "request_id": "chat-0002"},
    )
    assert second.status_code == 429
    assert second.json()["code"] == "rate_limited"
    assert int(second.headers["Retry-After"]) > 0


def test_rate_limited_chat_is_audited_without_the_prompt(client, auth, services):
    enable_ai(client, auth)
    services.rate_limiter = MemoryRateLimiter(RateLimitPolicy(requests=1, window_seconds=60))
    client.post(
        "/v1/copilot/chat", headers=auth,
        json={"message": "first question", "request_id": "chat-0001"},
    )
    client.post(
        "/v1/copilot/chat", headers=auth,
        json={"message": "sensitive question text", "request_id": "chat-0002"},
    )

    denied = [e for e in services.test_sink.events if e.event_type == "rate_limited"]
    assert len(denied) == 1
    assert denied[0].outcome == "denied"
    assert denied[0].metadata["endpoint"] == "copilot_chat"
    # The audit trail must never carry the prompt or a raw uid.
    serialized = denied[0].model_dump_json()
    assert "sensitive question text" not in serialized
    assert "alice" not in serialized


def test_limiter_does_not_block_other_endpoints(client, auth, services):
    enable_ai(client, auth)
    services.rate_limiter = MemoryRateLimiter(RateLimitPolicy(requests=1, window_seconds=60))
    client.post(
        "/v1/copilot/chat", headers=auth,
        json={"message": "burn the budget", "request_id": "chat-0001"},
    )
    # Ordinary record traffic is unaffected by the copilot budget.
    assert client.get("/v1/records/task", headers=auth).status_code == 200
    assert client.get("/v1/privacy", headers=auth).status_code == 200


def test_retained_chat_replay_does_not_spend_quota(client, auth, services):
    enable_ai(client, auth, retain=True, days=7)
    services.rate_limiter = MemoryRateLimiter(RateLimitPolicy(requests=1, window_seconds=60))
    first = client.post(
        "/v1/copilot/chat", headers=auth,
        json={"message": "What is due today?", "request_id": "chat-0001"},
    )
    assert first.status_code == 200

    # Same request_id: served from the retained copy, so the budget is untouched.
    replay = client.post(
        "/v1/copilot/chat", headers=auth,
        json={"message": "What is due today?", "request_id": "chat-0001"},
    )
    assert replay.status_code == 200


class FakeFirestoreClient:
    """Only enough surface for FirestoreRateLimiter.decide to be exercised."""

    def collection(self, _name):
        return self

    def document(self, _name):
        return self

    def transaction(self):
        raise AssertionError("decide() must not need a transaction")


def firestore_limiter(requests=2, window=60, clock=None):
    return FirestoreRateLimiter(
        FakeFirestoreClient(), RateLimitPolicy(requests, window), now=clock
    )


def test_firestore_decide_seeds_a_full_bucket_for_a_new_user():
    clock = FakeClock()
    limit = firestore_limiter(requests=2, clock=clock)
    payload, retry_after = limit.decide(None, clock.now)
    assert retry_after == 0
    # A fresh bucket starts full, so the first call leaves requests-1 behind.
    assert payload["tokens"] == pytest.approx(1.0)
    assert payload["updated_at"] == clock.now


def test_firestore_decide_denies_an_empty_bucket():
    clock = FakeClock()
    limit = firestore_limiter(requests=2, window=60, clock=clock)
    payload, retry_after = limit.decide({"tokens": 0.0, "updated_at": clock.now}, clock.now)
    assert payload is None
    assert retry_after == 30  # 60s window / 2 tokens


def test_firestore_decide_refills_from_the_stored_timestamp():
    clock = FakeClock()
    limit = firestore_limiter(requests=2, window=60, clock=clock)
    stored = {"tokens": 0.0, "updated_at": clock.now}
    clock.advance(60)
    payload, retry_after = limit.decide(stored, clock.now)
    assert retry_after == 0
    # A full window elapsed, so the bucket refilled to capacity before spending.
    assert payload["tokens"] == pytest.approx(1.0)


def test_firestore_decide_tolerates_a_bucket_missing_its_fields():
    clock = FakeClock()
    limit = firestore_limiter(requests=3, clock=clock)
    payload, retry_after = limit.decide({}, clock.now)
    assert retry_after == 0
    assert payload["tokens"] == pytest.approx(2.0)


def test_firestore_decide_is_capped_at_capacity():
    clock = FakeClock()
    limit = firestore_limiter(requests=2, window=60, clock=clock)
    stored = {"tokens": 2.0, "updated_at": clock.now}
    clock.advance(86_400)
    payload, _ = limit.decide(stored, clock.now)
    assert payload["tokens"] == pytest.approx(1.0)


def test_firestore_limiter_targets_a_user_scoped_document():
    limit = FirestoreRateLimiter(FakeFirestoreClient(), RateLimitPolicy(5, 60))
    assert limit.name == "copilot_chat"
    assert limit._ref("alice") is limit.client
