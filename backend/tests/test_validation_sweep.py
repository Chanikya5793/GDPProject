"""Regressions from the September 2026 line-by-line review.

Each test names a failure that was reachable in production: a 500 where a typed
error belonged, a date computed on the wrong clock, or a gate that was missing.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.ai import GeneratedAction, GeneratedAnswer
from app.api import local_today
from app.auth import FirebaseTokenVerifier, Forbidden
from app.models import EntityType, ProposalOperation, RecordUpsertRequest, ScheduleContent
from app.proposals import clean_generated_priority
from app.signup_policy import SignupPolicy
from tests.conftest import task_request

# --- auth ---------------------------------------------------------------------

def verifier(policy: SignupPolicy) -> FirebaseTokenVerifier:
    instance = FirebaseTokenVerifier.__new__(FirebaseTokenVerifier)
    instance.settings = None
    instance.policy = policy
    return instance


def enforced():
    return SignupPolicy(enforce=True, allowed_domains=["nwmissouri.edu"])


def test_an_unverified_address_is_refused_while_the_policy_is_enforced():
    decoded = {"uid": "u1", "email": "s123@nwmissouri.edu", "email_verified": False}
    with patch("app.auth.auth.verify_id_token", return_value=decoded), \
            pytest.raises(Forbidden) as exc:
        verifier(enforced()).verify("token")
    assert exc.value.code == "email_unverified"
    assert "Verify your email" in exc.value.detail


def test_a_verified_address_passes():
    decoded = {"uid": "u1", "email": "s123@nwmissouri.edu", "email_verified": True}
    with patch("app.auth.auth.verify_id_token", return_value=decoded):
        assert verifier(enforced()).verify("token").uid == "u1"


def test_verification_is_not_demanded_when_the_policy_is_off():
    decoded = {"uid": "u1", "email": "anyone@example.com", "email_verified": False}
    with patch("app.auth.auth.verify_id_token", return_value=decoded):
        assert verifier(SignupPolicy(enforce=False)).verify("token").uid == "u1"


def test_a_verifier_outage_is_503_not_a_sign_out():
    with patch("app.auth.auth.verify_id_token", side_effect=ConnectionError("dns")), \
            pytest.raises(HTTPException) as exc:
        verifier(SignupPolicy(enforce=False)).verify("token")
    assert exc.value.status_code == 503


def test_a_bad_token_is_still_401():
    from firebase_admin import auth as firebase_auth
    error = firebase_auth.InvalidIdTokenError("nope")
    with patch("app.auth.auth.verify_id_token", side_effect=error), \
            pytest.raises(HTTPException) as exc:
        verifier(SignupPolicy(enforce=False)).verify("token")
    assert exc.value.status_code == 401


# --- the student's calendar date ----------------------------------------------

def test_today_follows_the_zone_the_client_sent():
    late_utc = datetime(2026, 9, 18, 1, 30, tzinfo=timezone.utc)  # 20:30 the 17th in Missouri
    with patch("app.api.datetime") as fake:
        fake.now.side_effect = lambda tz=None: late_utc.astimezone(tz) if tz else late_utc
        assert local_today("America/Chicago") == date(2026, 9, 17)
        assert local_today("UTC") == date(2026, 9, 18)
        assert local_today("Not/AZone") == date(2026, 9, 18)


def test_chat_passes_the_local_date_to_the_copilot(client, services, auth):
    client.put("/v1/records/task/t1", json=task_request(approved=True), headers=auth)
    client.post("/v1/index/task/t1", json={"approved": True, "expected_revision": 1}, headers=auth)
    services.test_generator.response = GeneratedAnswer(answer="ok", citation_ids=["S1"])
    late_utc = datetime(2026, 9, 18, 1, 30, tzinfo=timezone.utc)
    with patch("app.api.datetime") as fake:
        fake.now.side_effect = lambda tz=None: late_utc.astimezone(tz) if tz else late_utc
        response = client.post("/v1/copilot/chat", json={
            "message": "what is due today?", "request_id": "tz-request-0001",
            "timezone": "America/Chicago",
        }, headers=auth)
    assert response.status_code == 200
    assert 'TODAY="2026-09-17"' in services.test_generator.prompts[-1]


# --- typed errors instead of 500s ----------------------------------------------

def test_content_of_the_wrong_kind_is_422(client, auth):
    body = task_request()
    response = client.put("/v1/records/note/n1", json=body, headers=auth)
    assert response.status_code == 422


def test_a_record_id_outside_the_contract_is_422(client, auth):
    response = client.put("/v1/records/task/a%20b", json=task_request(), headers=auth)
    assert response.status_code == 422


def test_mixed_datetime_awareness_is_a_validation_error_not_a_crash():
    block = ScheduleContent(
        title="Class", starts_at="2026-09-17T10:00:00", ends_at="2026-09-17T11:00:00Z",
    )
    assert block.starts_at.tzinfo is not None
    assert block.ends_at - block.starts_at == timedelta(hours=1)
    with pytest.raises(ValueError):
        ScheduleContent(title="Class", starts_at="2026-09-17T11:00:00Z", ends_at="2026-09-17T10:00:00")


def test_a_long_migration_id_still_migrates(client, auth):
    body = {
        "migration_id": "m" * 128,
        "items": [{
            "legacy_key": "nw_tasks", "legacy_id": 1,
            "content": task_request()["content"], "approved_for_ai": False,
        }],
    }
    first = client.post("/v1/migrations/local-storage", json=body, headers=auth)
    assert first.status_code == 200, first.text
    assert first.json()["imported"] == 1
    assert client.post("/v1/migrations/local-storage", json=body, headers=auth).json()["skipped"] == 1


def test_an_idempotency_key_is_bound_to_the_record_it_was_used_on(client, auth):
    first = client.put("/v1/records/task/t1", json=task_request(key="shared-key-1"), headers=auth)
    assert first.status_code == 200
    replay = client.put("/v1/records/task/t2", json=task_request(key="shared-key-1"), headers=auth)
    assert replay.status_code == 409
    assert replay.json()["code"] == "idempotency_conflict"
    assert client.get("/v1/records/task", headers=auth).json()[0]["record_id"] == "t1"


def test_mcp_arguments_of_the_wrong_shape_are_403_not_500(client, auth):
    init = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize"}, headers=auth)
    session = init.headers["Mcp-Session-Id"]
    response = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {"name": "tasks", "arguments": ["include_completed"]},
    }, headers={**auth, "Mcp-Session-Id": session})
    assert response.status_code == 403


def test_a_provider_failure_on_the_blocking_route_is_502(client, services, auth):
    class Broken:
        provider = "fake"
        trains_on_prompts = False
        model = "fake"

        def generate(self, prompt):
            raise RuntimeError("safety block")

    services.copilot.generator = Broken()
    response = client.post("/v1/copilot/chat", json={
        "message": "hello", "request_id": "broken-request-0001",
    }, headers=auth)
    assert response.status_code == 502
    assert "try again" in response.json()["detail"].lower()


# --- model output is untrusted --------------------------------------------------

@pytest.mark.parametrize("value,expected", [
    ("High", "high"), ("urgent", "high"), ("MEDIUM", "medium"), ("none", "low"),
    ("whatever", None), ("", None),
])
def test_generated_priorities_are_normalised(value, expected):
    assert clean_generated_priority(value) == expected


def test_a_create_with_a_capitalised_priority_becomes_a_proposal(services):
    prepared = services.proposals.prepare("alice", GeneratedAction(
        operation=ProposalOperation.create, entity_type=EntityType.task,
        title="Read chapter 4", priority="High",
    ), "Add task")
    assert prepared.proposal is not None
    assert prepared.proposal.after.priority == "high"


def test_an_update_to_an_unknown_priority_is_refused_with_a_reason(services):
    services.repository.upsert_record("alice", EntityType.task, "t1", RecordUpsertRequest(
        **task_request(key="create-t1-0001")
    ))
    prepared = services.proposals.prepare("alice", GeneratedAction(
        operation=ProposalOperation.update, entity_type=EntityType.task,
        record_id="t1", priority="ludicrous",
    ), "Change task")
    assert prepared.proposal is None
    assert "priority" in prepared.reason


def test_an_update_that_breaks_the_record_model_is_refused_not_stored(services):
    services.repository.upsert_record("alice", EntityType.task, "t1", RecordUpsertRequest(
        **task_request(key="create-t1-0002")
    ))
    prepared = services.proposals.prepare("alice", GeneratedAction(
        operation=ProposalOperation.update, entity_type=EntityType.task,
        record_id="t1", title="x" * 600,
    ), "Change task")
    assert prepared.proposal is None
    assert "title" in prepared.reason


def test_a_create_with_an_overlong_title_is_refused_not_a_500(services):
    prepared = services.proposals.prepare("alice", GeneratedAction(
        operation=ProposalOperation.create, entity_type=EntityType.note, title="x" * 600,
    ), "Add note")
    assert prepared.proposal is None
    assert "title" in prepared.reason


# --- a confirmed delete leaves nothing behind ----------------------------------

def test_a_confirmed_delete_clears_the_vector_index(client, services, auth):
    client.put("/v1/records/task/t1", json=task_request(approved=True), headers=auth)
    client.post("/v1/index/task/t1", json={"approved": True, "expected_revision": 1}, headers=auth)
    assert len(services.vector_store.vectors) == 1
    services.test_generator.response = GeneratedAnswer(
        answer="Deleting it.", citation_ids=["S1"],
        action=GeneratedAction(
            operation=ProposalOperation.delete, entity_type=EntityType.task, record_id="t1",
        ),
    )
    chat = client.post("/v1/copilot/chat", json={
        "message": "delete my report task", "request_id": "delete-request-0001",
    }, headers=auth).json()
    proposal = chat["proposals"][0]
    confirmed = client.post(f"/v1/proposals/{proposal['proposal_id']}/confirm", json={
        "idempotency_key": "confirm-del-0001", "expected_base_revision": 1,
    }, headers=auth)
    assert confirmed.status_code == 200
    assert len(services.vector_store.vectors) == 0


# --- the stream always ends with a terminal event ---------------------------------

def test_a_failure_after_generation_still_ends_the_stream_with_an_error(client, services, auth):
    from tests.test_chat_stream import StreamingGenerator, read_events
    client.put("/v1/records/task/t1", json=task_request(approved=True), headers=auth)
    client.post("/v1/index/task/t1", json={"approved": True, "expected_revision": 1}, headers=auth)
    services.copilot.generator = StreamingGenerator(
        GeneratedAnswer(answer="Done.", citation_ids=["S1"]), chunks=["Done."],
    )
    with patch("app.api.remember_turn", side_effect=RuntimeError("firestore down")):
        response = client.post("/v1/copilot/chat/stream", headers=auth, json={
            "message": "hi", "request_id": "stream-fail-request-0001",
        })
        events = read_events(response)
    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "generation_failed"


def test_ai_disabled_carries_a_code_the_clients_can_key_on(client, auth):
    client.put("/v1/privacy", json={
        "ai_enabled": False, "indexed_entity_types": [], "index_attachments": False,
        "retain_chat": False, "chat_retention_days": 0,
    }, headers=auth)
    response = client.post("/v1/copilot/chat", json={
        "message": "hello", "request_id": "disabled-request-0001",
    }, headers=auth)
    assert response.status_code == 403
    assert response.json()["code"] == "ai_disabled"
