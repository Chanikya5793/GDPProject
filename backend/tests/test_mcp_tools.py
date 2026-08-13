from datetime import date

import pytest

from app.models import (
    EntityType,
    NoteContent,
    PrivacySettings,
    RecordUpsertRequest,
    ReminderContent,
    ScheduleContent,
    TaskContent,
)


def put(services, kind, record_id, content, approved=False):
    return services.repository.upsert_record(
        "alice", kind, record_id,
        RecordUpsertRequest(
            content=content, idempotency_key=f"create-{record_id}-000", approved_for_ai=approved,
        ),
    )


def seed(services):
    task = put(services, EntityType.task, "task1", TaskContent(
        title="Exam study", due_date=date(2026, 8, 20), estimated_minutes=90
    ), approved=True)
    put(services, EntityType.task, "task2", TaskContent(
        title="Completed", due_date=date(2026, 8, 20), completed=True
    ))
    put(services, EntityType.reminder, "rem1", ReminderContent(
        title="Advisor", date=date(2026, 8, 20)
    ))
    put(services, EntityType.note, "note1", NoteContent(title="Reference", body="Exam facts"))
    put(services, EntityType.schedule, "event1", ScheduleContent(
        title="Class", starts_at="2026-08-20T10:00:00Z", ends_at="2026-08-20T11:00:00Z"
    ))
    return task


@pytest.mark.parametrize("name,args,minimum", [
    ("tasks", {}, 1),
    ("tasks", {"include_completed": True}, 2),
    ("reminders", {}, 1),
    ("notes", {}, 1),
    ("calendar_window", {"start": "2026-08-19", "end": "2026-08-21"}, 4),
    ("workload_summary", {}, 0),
])
def test_read_only_mcp_tools(services, name, args, minimum):
    seed(services)
    result = services.mcp_tools.call("alice", name, args)
    assert len(result) >= minimum


def test_mcp_planner_search_uses_approved_index(services):
    task = seed(services)
    services.repository.set_privacy("alice", PrivacySettings(
        ai_enabled=True, indexed_entity_types=[EntityType.task]
    ))
    services.indexing.index("alice", EntityType.task, task.record_id, task.revision)
    result = services.mcp_tools.call("alice", "planner_search", {"query": "exam"})
    assert result[0]["citation"]["record_id"] == "task1"


def test_mcp_unknown_tool_rejected(services):
    with pytest.raises(KeyError):
        services.mcp_tools.call("alice", "write_task", {})

