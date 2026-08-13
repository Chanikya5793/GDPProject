from datetime import date, datetime, timezone

from app.models import (
    PlannerRecord, ReminderContent, ScheduleContent, TaskContent,
)
from app.planner import PlannerEngine


def record(record_id, content):
    now = datetime.now(timezone.utc)
    return PlannerRecord(
        record_id=record_id, revision=1, content=content, approved_for_ai=True,
        created_at=now, updated_at=now,
    )


def test_overdue_and_priority_escalation_rules():
    engine = PlannerEngine()
    items = [
        record("late", TaskContent(title="Late", due_date=date(2026, 8, 1))),
        record("soon", TaskContent(title="Soon", due_date=date(2026, 8, 14), priority="low")),
    ]
    result = engine.analyze(items, today=date(2026, 8, 13))
    assert {item.rule_id for item in result} >= {
        "deadline.overdue.v1", "priority.deadline_escalation.v1"
    }


def test_daily_overload_rule():
    engine = PlannerEngine(max_daily_minutes=100)
    items = [
        record("a", TaskContent(title="A", due_date=date(2026, 8, 20), estimated_minutes=60)),
        record("b", TaskContent(title="B", due_date=date(2026, 8, 20), estimated_minutes=60)),
    ]
    result = engine.analyze(items, today=date(2026, 8, 13))
    overload = next(item for item in result if item.kind == "overload")
    assert overload.facts["total_minutes"] == 120


def test_schedule_conflict_rule():
    engine = PlannerEngine()
    items = [
        record("a", ScheduleContent(title="A", starts_at="2026-08-13T10:00:00Z", ends_at="2026-08-13T11:00:00Z")),
        record("b", ScheduleContent(title="B", starts_at="2026-08-13T10:30:00Z", ends_at="2026-08-13T11:30:00Z")),
    ]
    result = engine.analyze(items, today=date(2026, 8, 13))
    assert next(item for item in result if item.kind == "conflict").facts["overlap_minutes"] == 30


def test_overdue_reminder_rule():
    engine = PlannerEngine()
    result = engine.analyze([
        record("r1", ReminderContent(title="Call", date=date(2026, 8, 12)))
    ], today=date(2026, 8, 13))
    assert result[0].rule_id == "reminder.overdue.v1"


def test_next_available_day_skips_overloaded_date():
    engine = PlannerEngine(max_daily_minutes=100)
    records = [record("a", TaskContent(
        title="A", due_date=date(2026, 8, 14), estimated_minutes=90
    ))]
    assert engine.next_available_day(records, date(2026, 8, 13), 20) == date(2026, 8, 15)
