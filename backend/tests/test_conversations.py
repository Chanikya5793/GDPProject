"""Threads: what makes a conversation something you can come back to."""

from __future__ import annotations

from datetime import datetime, timezone

from app.ai import GeneratedAnswer
from app.models import EntityType, PrivacySettings, RecordUpsertRequest, TaskContent

NOW = datetime(2026, 9, 6, tzinfo=timezone.utc)


def ask(client, auth, message, request_id, conversation_id=None, history=None):
    body = {"message": message, "request_id": request_id, "timezone": "UTC"}
    if conversation_id:
        body["conversation_id"] = conversation_id
    if history is not None:
        body["history"] = history
    return client.post("/v1/copilot/chat", headers=auth, json=body)


def test_a_chat_with_no_thread_starts_one_and_says_which(client, auth, services):
    # Retained chats were a flat archive keyed by a request id the client never
    # reused, so there was nothing to reopen. A turn now lands in a thread.
    services.test_generator.response = GeneratedAnswer(answer="Two things today.")

    body = ask(client, auth, "what is due today?", "thread-0001").json()

    assert body["conversation_id"]
    listed = client.get("/v1/conversations", headers=auth).json()
    assert [row["conversation_id"] for row in listed] == [body["conversation_id"]]


def test_the_thread_is_named_after_the_first_thing_asked_in_it(client, auth, services):
    services.test_generator.response = GeneratedAnswer(answer="ok")

    ask(client, auth, "what is due today?", "thread-0002")

    assert client.get("/v1/conversations", headers=auth).json()[0]["title"] == "what is due today?"


def test_a_second_turn_continues_the_same_thread(client, auth, services):
    services.test_generator.response = GeneratedAnswer(answer="ok")
    first = ask(client, auth, "what is due today?", "thread-0003").json()

    second = ask(client, auth, "and tomorrow?", "thread-0004", first["conversation_id"]).json()

    assert second["conversation_id"] == first["conversation_id"]
    detail = client.get(f"/v1/conversations/{first['conversation_id']}", headers=auth).json()
    assert [m["text"] for m in detail["messages"]] == [
        "what is due today?", "ok", "and tomorrow?", "ok",
    ]
    assert len(client.get("/v1/conversations", headers=auth).json()) == 1


def test_the_thread_is_the_history_not_whatever_the_client_sends(client, auth, services):
    # This is what lets a thread be picked up on another device: the transcript
    # is the server's, so a client that has never seen it can still continue it.
    services.test_generator.response = GeneratedAnswer(answer="ok")
    first = ask(client, auth, "remember the lab report", "thread-0005").json()

    ask(client, auth, "what did I just say?", "thread-0006", first["conversation_id"],
        history=[{"role": "user", "text": "something else entirely"}])

    prompt = services.test_generator.prompts[-1]
    assert "remember the lab report" in prompt
    assert "something else entirely" not in prompt


def test_a_client_with_no_thread_still_gets_its_own_history_replayed(client, auth, services):
    # An older build sends history and no conversation id; it must keep working.
    services.test_generator.response = GeneratedAnswer(answer="ok")

    ask(client, auth, "carry on", "thread-0007",
        history=[{"role": "assistant", "text": "What should I call it?"}])

    assert "What should I call it?" in services.test_generator.prompts[-1]


def test_threads_are_listed_newest_first(client, auth, services):
    services.test_generator.response = GeneratedAnswer(answer="ok")
    ask(client, auth, "older thread", "thread-0008")
    ask(client, auth, "newer thread", "thread-0009")

    listed = client.get("/v1/conversations", headers=auth).json()

    assert [row["title"] for row in listed] == ["newer thread", "older thread"]


def test_a_thread_can_be_renamed(client, auth, services):
    services.test_generator.response = GeneratedAnswer(answer="ok")
    started = ask(client, auth, "untitled thing", "thread-0010").json()

    renamed = client.patch(
        f"/v1/conversations/{started['conversation_id']}",
        headers=auth, json={"title": "Chemistry revision plan"},
    )

    assert renamed.status_code == 200
    assert client.get("/v1/conversations", headers=auth).json()[0]["title"] == "Chemistry revision plan"


def test_one_thread_can_be_deleted_without_clearing_the_rest(client, auth, services):
    services.test_generator.response = GeneratedAnswer(answer="ok")
    keep = ask(client, auth, "keep me", "thread-0011").json()
    drop = ask(client, auth, "delete me", "thread-0012").json()

    assert client.delete(f"/v1/conversations/{drop['conversation_id']}", headers=auth).status_code == 204

    remaining = client.get("/v1/conversations", headers=auth).json()
    assert [row["conversation_id"] for row in remaining] == [keep["conversation_id"]]
    assert client.delete(f"/v1/conversations/{drop['conversation_id']}", headers=auth).status_code == 404


def test_every_thread_can_be_cleared_at_once(client, auth, services):
    services.test_generator.response = GeneratedAnswer(answer="ok")
    ask(client, auth, "one", "thread-0013")
    ask(client, auth, "two", "thread-0014")

    assert client.delete("/v1/conversations", headers=auth).json() == {"deleted": 2}
    assert client.get("/v1/conversations", headers=auth).json() == []


def test_opting_out_keeps_the_thread_off_the_server(client, auth, services):
    # Still a switch, not a fact. Off, nothing is written and the id the client
    # sent comes back, so a device-only conversation still threads locally.
    client.put("/v1/privacy", json={
        "ai_enabled": True, "indexed_entity_types": ["task"], "index_attachments": False,
        "retain_chat": False, "chat_retention_days": 0,
    }, headers=auth)
    services.test_generator.response = GeneratedAnswer(answer="ok")

    body = ask(client, auth, "private question", "thread-0015", "local-thread-1").json()

    assert body["conversation_id"] == "local-thread-1"
    assert client.get("/v1/conversations", headers=auth).json() == []


def test_a_new_planner_keeps_its_conversations(services):
    # The default flipped: a thread you cannot reopen is not a thread. Users who
    # already chose off keep that, because stored settings beat the default.
    privacy = services.repository.get_privacy("brand-new-user")
    assert privacy.retain_chat is True
    assert privacy.chat_retention_days == 30


def test_a_thread_stops_growing_rather_than_outgrowing_its_document(services):
    from app.models import ConversationMessage
    from app.repository import MAX_THREAD_MESSAGES

    conversation_id = None
    for index in range(MAX_THREAD_MESSAGES):
        detail = services.repository.append_turn(
            "alice", conversation_id,
            ConversationMessage(role="user", text=f"q{index}", created_at=NOW),
            ConversationMessage(role="assistant", text=f"a{index}", created_at=NOW),
        )
        conversation_id = detail.conversation_id

    assert detail.message_count == MAX_THREAD_MESSAGES
    # The oldest fall off, not the newest.
    assert detail.messages[-1].text == f"a{MAX_THREAD_MESSAGES - 1}"


def test_threads_do_not_leak_between_users(client, services):
    services.test_generator.response = GeneratedAnswer(answer="ok")
    mine = ask(client, {"Authorization": "Bearer uid:alice"}, "mine", "thread-0016").json()

    theirs = client.get("/v1/conversations", headers={"Authorization": "Bearer uid:bob"}).json()

    assert theirs == []
    assert client.get(
        f"/v1/conversations/{mine['conversation_id']}",
        headers={"Authorization": "Bearer uid:bob"},
    ).status_code == 404


def test_listing_threads_needs_a_token(client):
    assert client.get("/v1/conversations").status_code == 401


# ---------------------------------------------------------------------------
# Prompt caching
# ---------------------------------------------------------------------------


def test_the_briefing_sits_ahead_of_what_changes_every_turn(client, auth, services):
    # Providers cache a prompt by its prefix. With the conversation and the
    # question in front, the briefing behind them was re-read from scratch on
    # every turn despite being byte-identical until a record changed.
    services.repository.upsert_record(
        "alice", EntityType.task, "t1",
        RecordUpsertRequest(
            content=TaskContent(title="Chemistry revision"),
            idempotency_key="seed-cache-0001", approved_for_ai=True,
        ),
    )
    services.repository.set_privacy("alice", PrivacySettings(
        ai_enabled=True, indexed_entity_types=[EntityType.task], retain_chat=True,
    ))
    services.test_generator.response = GeneratedAnswer(answer="ok")

    ask(client, auth, "anything", "cache-0001")
    prompt = services.test_generator.prompts[-1]

    assert prompt.index("PLANNER_BRIEFING=") < prompt.index("CONVERSATION=")
    assert prompt.index("PLANNER_BRIEFING=") < prompt.index("USER_QUESTION=")
    assert prompt.index("CONVERSATION=") < prompt.index("USER_QUESTION=")
