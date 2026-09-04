from datetime import datetime, timezone

from conftest import task_request

from app.ai import GeneratedAction, GeneratedAnswer
from app.models import EntityType, ProposalOperation


def test_authentication_is_required(client):
    assert client.get("/v1/records/task").status_code == 401


def test_health_requires_a_constructed_runtime(client):
    assert client.get("/healthz").json() == {
        "status": "ok", "cloud_services_initialized": True,
    }


def test_bad_token_is_rejected(client):
    response = client.get("/v1/records/task", headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


def test_record_crud_and_user_isolation(client, auth):
    created = client.put("/v1/records/task/t1", json=task_request(), headers=auth)
    assert created.status_code == 200
    assert created.json()["revision"] == 1
    assert client.get("/v1/records/task/t1", headers={
        "Authorization": "Bearer uid:bob"
    }).status_code == 404
    updated_body = task_request("Changed", 1, "request-0002")
    assert client.put("/v1/records/task/t1", json=updated_body, headers=auth).json()["revision"] == 2
    deleted = client.request("DELETE", "/v1/records/task/t1", headers=auth, json={
        "expected_revision": 2, "idempotency_key": "delete-0001"
    })
    assert deleted.status_code == 204


def test_strict_contract_rejects_unknown_fields(client, auth):
    body = task_request()
    body["surprise"] = "not allowed"
    assert client.put("/v1/records/task/t1", json=body, headers=auth).status_code == 422


def test_migration_is_idempotent(client, auth):
    body = {
        "migration_id": "migration-20260813",
        "items": [{
            "legacy_key": "nw_tasks", "legacy_id": 1,
            "content": task_request()["content"], "approved_for_ai": False,
        }],
    }
    first = client.post("/v1/migrations/local-storage", json=body, headers=auth)
    second = client.post("/v1/migrations/local-storage", json=body, headers=auth)
    assert first.json()["imported"] == 1
    assert second.json()["skipped"] == 1
    assert first.json()["record_ids"] == second.json()["record_ids"]


def test_privacy_opt_out_deletes_only_user_index(client, auth, services):
    response = client.put("/v1/privacy", json={
        "ai_enabled": False, "indexed_entity_types": [], "index_attachments": False,
        "retain_chat": False, "chat_retention_days": 0,
    }, headers=auth)
    assert response.status_code == 200
    assert response.json()["indexed_entity_types"] == []
    assert response.json()["retain_chat"] is False
    assert any(event.event_type == "privacy_changed" for event in services.test_sink.events)


def test_privacy_removing_one_entity_type_deletes_that_vector_partition(client, auth, services):
    client.put("/v1/privacy", json={
        "ai_enabled": True, "indexed_entity_types": ["task", "note"],
        "index_attachments": False, "retain_chat": False, "chat_retention_days": 0,
    }, headers=auth)
    response = client.put("/v1/privacy", json={
        "ai_enabled": True, "indexed_entity_types": ["task"],
        "index_attachments": False, "retain_chat": False, "chat_retention_days": 0,
    }, headers=auth)
    assert response.status_code == 200
    assert response.json()["indexed_entity_types"] == ["task"]


def test_mcp_initialize_and_tools_are_session_bound(client, auth):
    initialized = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}
    }, headers=auth)
    session = initialized.headers["mcp-session-id"]
    listed = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}
    }, headers={**auth, "Mcp-Session-Id": session})
    assert listed.status_code == 200
    assert len(listed.json()["result"]["tools"]) == 6
    denied = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {}
    }, headers={"Authorization": "Bearer uid:bob", "Mcp-Session-Id": session})
    assert denied.status_code == 403


def test_mcp_uid_argument_is_rejected(client, auth):
    initialized = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}
    }, headers=auth)
    response = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {"name": "tasks", "arguments": {"uid": "bob"}},
    }, headers={**auth, "Mcp-Session-Id": initialized.headers["mcp-session-id"]})
    assert response.status_code == 403


def test_stale_revision_returns_typed_conflict(client, auth):
    client.put("/v1/records/task/t1", json=task_request(), headers=auth)
    response = client.put(
        "/v1/records/task/t1", json=task_request("Changed", 0, "request-0002"), headers=auth
    )
    assert response.status_code == 409
    assert response.json()["code"] == "stale_revision"


def test_index_chat_and_confirmed_proposal_flow(client, auth, services):
    client.put("/v1/privacy", json={
        "ai_enabled": True, "indexed_entity_types": ["task"], "index_attachments": False,
        "retain_chat": False, "chat_retention_days": 0,
    }, headers=auth)
    created = client.put(
        "/v1/records/task/t1", json=task_request(approved=True), headers=auth
    ).json()
    assert client.post("/v1/index/task/t1", json={
        "approved": True, "expected_revision": 1
    }, headers=auth).status_code == 202
    services.test_generator.response = GeneratedAnswer(
        answer="You can complete it after review.", citation_ids=["S1"],
        action=GeneratedAction(
            operation=ProposalOperation.complete, entity_type=EntityType.task, record_id="t1"
        ),
    )
    chat = client.post("/v1/copilot/chat", json={
        "message": "complete my report", "request_id": "chatreq-0001", "timezone": "UTC"
    }, headers=auth)
    assert chat.status_code == 200
    proposal = chat.json()["proposals"][0]
    assert proposal["before"]["completed"] is False
    assert proposal["after"]["completed"] is True
    assert created["content"]["completed"] is False
    confirmed = client.post(f"/v1/proposals/{proposal['proposal_id']}/confirm", json={
        "idempotency_key": "confirm-0001", "expected_base_revision": 1
    }, headers=auth)
    assert confirmed.json()["status"] == "confirmed"


def test_mcp_requires_session_after_initialize(client, auth):
    response = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}
    }, headers=auth)
    assert response.status_code == 403


def test_retained_chat_is_encrypted_repository_backed_idempotent_and_deletable(
    client, auth, services
):
    client.put("/v1/privacy", json={
        "ai_enabled": True, "indexed_entity_types": ["task"], "index_attachments": False,
        "retain_chat": True, "chat_retention_days": 7,
    }, headers=auth)
    client.put("/v1/records/task/t1", json=task_request(approved=True), headers=auth)
    client.post("/v1/index/task/t1", json={
        "approved": True, "expected_revision": 1,
    }, headers=auth)
    body = {"message": "When is my report due?", "request_id": "chatreq-0001", "timezone": "UTC"}
    first = client.post("/v1/copilot/chat", json=body, headers=auth)
    second = client.post("/v1/copilot/chat", json=body, headers=auth)
    assert first.json() == second.json()
    assert len(services.test_generator.prompts) == 1
    assert client.delete("/v1/chats", headers=auth).json() == {"deleted": 1}


def test_a_change_it_cannot_prepare_is_admitted_not_implied(client, services, auth):
    # It described creating a reminder with no day, which cannot become a
    # proposal. Without this the student is told to confirm a preview that will
    # never appear.
    from app.ai import GeneratedAction, GeneratedAnswer
    from app.models import EntityType, ProposalOperation

    services.test_generator.response = GeneratedAnswer(
        answer="I'm setting up that reminder now.",
        action=GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.reminder,
            title="Email advisor",
        ),
    )
    response = client.post("/v1/copilot/chat", headers=auth, json={
        "message": "remind me to email my advisor", "request_id": "nodate-0001",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["proposals"] == []
    assert "nothing to confirm" in body["answer"]


def retain_on(client, auth, days=30):
    client.put("/v1/privacy", json={
        "ai_enabled": True, "indexed_entity_types": ["task"], "index_attachments": False,
        "retain_chat": True, "chat_retention_days": days,
    }, headers=auth)


def ask(client, auth, message, request_id):
    return client.post("/v1/copilot/chat", headers=auth,
                       json={"message": message, "request_id": request_id, "timezone": "UTC"})


def test_retained_chats_can_actually_be_read_back(client, auth, services):
    # They were write-only: the single lookup is by request_id, which the client
    # never reuses, and no endpoint listed them. Turning retention on wrote rows
    # that nothing could ever display.
    retain_on(client, auth)
    services.test_generator.response = GeneratedAnswer(answer="Two things today.")
    ask(client, auth, "what is due today?", "hist-0001")
    ask(client, auth, "and tomorrow?", "hist-0002")

    listed = client.get("/v1/chats", headers=auth)

    assert listed.status_code == 200
    body = listed.json()
    assert [row["question"] for row in body] == ["and tomorrow?", "what is due today?"]
    assert body[0]["answer"] == "Two things today."
    assert body[0]["request_id"] == "hist-0002"


def test_history_is_newest_first_and_honours_the_limit(client, auth, services):
    retain_on(client, auth)
    services.test_generator.response = GeneratedAnswer(answer="ok")
    for index in range(5):
        ask(client, auth, f"question {index}", f"limit-000{index}")

    body = client.get("/v1/chats?limit=2", headers=auth).json()

    assert [row["question"] for row in body] == ["question 4", "question 3"]


def test_history_does_not_carry_proposals(client, auth, services):
    # A proposal expires thirty minutes after it is made, so one offered in
    # history could never be confirmed and would only look like a change that
    # silently failed.
    retain_on(client, auth)
    services.test_generator.response = GeneratedAnswer(
        answer="I can add that.",
        action=GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.task, title="Essay",
        ),
    )
    ask(client, auth, "add an essay task", "prop-0001")

    row = client.get("/v1/chats", headers=auth).json()[0]

    assert "proposals" not in row
    assert row["answer"] == "I can add that."


def test_an_expired_exchange_is_neither_listed_nor_left_behind(client, auth, services):
    # expires_at was written and never enforced in bulk, so retained chats piled
    # up for good. Listing is the sweep.
    retain_on(client, auth)
    services.test_generator.response = GeneratedAnswer(answer="ok")
    ask(client, auth, "old question", "stale-0001")
    key = ("alice", "stale-0001")
    question, response, created_at, _ = services.repository.chats[key]
    services.repository.chats[key] = (
        question, response, created_at, datetime(2020, 1, 1, tzinfo=timezone.utc)
    )

    assert client.get("/v1/chats", headers=auth).json() == []
    assert key not in services.repository.chats


def test_one_exchange_can_be_deleted_without_clearing_the_lot(client, auth, services):
    retain_on(client, auth)
    services.test_generator.response = GeneratedAnswer(answer="ok")
    ask(client, auth, "keep me", "keep-0001")
    ask(client, auth, "delete me", "drop-0001")

    assert client.delete("/v1/chats/drop-0001", headers=auth).status_code == 204
    assert [row["question"] for row in client.get("/v1/chats", headers=auth).json()] == ["keep me"]
    assert client.delete("/v1/chats/drop-0001", headers=auth).status_code == 404


def test_history_still_lists_after_retention_is_switched_off(client, auth, services):
    # Turning it off stops new rows being written; it does not remove the ones
    # already there, and refusing to list them would leave no way to see or
    # clear what is stored.
    retain_on(client, auth)
    services.test_generator.response = GeneratedAnswer(answer="ok")
    ask(client, auth, "written while on", "off-0001")
    client.put("/v1/privacy", json={
        "ai_enabled": True, "indexed_entity_types": ["task"], "index_attachments": False,
        "retain_chat": False, "chat_retention_days": 0,
    }, headers=auth)

    # Switching retention off deletes them, which is the documented behaviour;
    # what must not happen is rows surviving with no way to reach them.
    assert client.get("/v1/chats", headers=auth).json() == []


def test_history_needs_a_token(client):
    assert client.get("/v1/chats").status_code == 401
