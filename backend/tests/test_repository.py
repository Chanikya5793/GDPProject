from datetime import date

import pytest

from app.models import EntityType, RecordUpsertRequest, TaskContent
from app.repository import IdempotencyConflict, MemoryPlannerRepository, NotFound, RevisionConflict


def request(title="Task", revision=None, key="idem-0001"):
    return RecordUpsertRequest(
        content=TaskContent(title=title, due_date=date(2026, 8, 20)),
        expected_revision=revision, idempotency_key=key,
    )


def test_create_and_update_with_revision():
    repo = MemoryPlannerRepository()
    first = repo.upsert_record("alice", EntityType.task, "t1", request())
    second = repo.upsert_record("alice", EntityType.task, "t1", request("Changed", 1, "idem-0002"))
    assert first.revision == 1
    assert second.revision == 2
    assert second.content.title == "Changed"


def test_stale_write_rejected():
    repo = MemoryPlannerRepository()
    repo.upsert_record("alice", EntityType.task, "t1", request())
    with pytest.raises(RevisionConflict):
        repo.upsert_record("alice", EntityType.task, "t1", request("Changed", 0, "idem-0002"))


def test_idempotent_retry_returns_same_record():
    repo = MemoryPlannerRepository()
    body = request()
    first = repo.upsert_record("alice", EntityType.task, "t1", body)
    second = repo.upsert_record("alice", EntityType.task, "t1", body)
    assert first == second
    assert second.revision == 1


def test_idempotency_key_cannot_be_reused_for_different_payload():
    repo = MemoryPlannerRepository()
    repo.upsert_record("alice", EntityType.task, "t1", request())
    with pytest.raises(IdempotencyConflict):
        repo.upsert_record("alice", EntityType.task, "t1", request("Other"))


def test_cross_user_records_are_isolated():
    repo = MemoryPlannerRepository()
    repo.upsert_record("alice", EntityType.task, "t1", request())
    with pytest.raises(NotFound):
        repo.get_record("bob", EntityType.task, "t1")
    assert repo.list_records("bob", EntityType.task) == []


def test_delete_checks_revision_and_is_idempotent():
    repo = MemoryPlannerRepository()
    repo.upsert_record("alice", EntityType.task, "t1", request())
    with pytest.raises(RevisionConflict):
        repo.delete_record("alice", EntityType.task, "t1", 2, "delete-001")
    repo.delete_record("alice", EntityType.task, "t1", 1, "delete-001")
    repo.delete_record("alice", EntityType.task, "t1", 1, "delete-001")
    with pytest.raises(NotFound):
        repo.get_record("alice", EntityType.task, "t1")

