from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, List

from .models import (
    DeterministicRecommendation,
    PlannerRecord,
    ProposalOperation,
    ReminderContent,
    ScheduleContent,
    TaskContent,
)


class PlannerEngine:
    """Pure rules engine. It returns facts and operations, never prose or mutations."""

    def __init__(self, max_daily_minutes: int = 360):
        self.max_daily_minutes = max_daily_minutes

    def analyze(
        self, records: Iterable[PlannerRecord], today: date | None = None
    ) -> List[DeterministicRecommendation]:
        today = today or datetime.now(timezone.utc).date()
        recommendations: List[DeterministicRecommendation] = []
        tasks_by_day = defaultdict(list)
        schedules: List[PlannerRecord] = []

        for record in records:
            content = record.content
            if isinstance(content, TaskContent) and not content.completed:
                if content.due_date:
                    tasks_by_day[content.due_date].append(record)
                    days = (content.due_date - today).days
                    if days < 0:
                        recommendations.append(DeterministicRecommendation(
                            kind="deadline", record_ids=[record.record_id], severity="critical",
                            rule_id="deadline.overdue.v1", facts={"days_overdue": abs(days)},
                            suggested_operation=ProposalOperation.reschedule,
                        ))
                    elif days <= 2 and content.priority != "high":
                        recommendations.append(DeterministicRecommendation(
                            kind="priority", record_ids=[record.record_id], severity="warning",
                            rule_id="priority.deadline_escalation.v1",
                            facts={"days_until_due": days, "current_priority": content.priority},
                            suggested_operation=ProposalOperation.update,
                        ))
            elif isinstance(content, ScheduleContent):
                schedules.append(record)
            elif isinstance(content, ReminderContent) and not content.completed and content.date < today:
                recommendations.append(DeterministicRecommendation(
                    kind="deadline", record_ids=[record.record_id], severity="warning",
                    rule_id="reminder.overdue.v1", facts={"days_overdue": (today - content.date).days},
                ))

        for due_day, tasks in tasks_by_day.items():
            total = sum(record.content.estimated_minutes for record in tasks)  # type: ignore[union-attr]
            if total > self.max_daily_minutes:
                recommendations.append(DeterministicRecommendation(
                    kind="overload", record_ids=[r.record_id for r in tasks], severity="critical",
                    rule_id="workload.daily_capacity.v1",
                    facts={"date": due_day.isoformat(), "total_minutes": total,
                           "capacity_minutes": self.max_daily_minutes},
                    suggested_operation=ProposalOperation.reschedule,
                ))

        schedules.sort(key=lambda r: r.content.starts_at)  # type: ignore[union-attr]
        for index, left in enumerate(schedules):
            left_content = left.content
            for right in schedules[index + 1:]:
                right_content = right.content
                if right_content.starts_at >= left_content.ends_at:  # type: ignore[union-attr]
                    break
                recommendations.append(DeterministicRecommendation(
                    kind="conflict", record_ids=[left.record_id, right.record_id], severity="critical",
                    rule_id="schedule.overlap.v1",
                    facts={"overlap_minutes": int(
                        (min(left_content.ends_at, right_content.ends_at) -  # type: ignore[union-attr]
                         max(left_content.starts_at, right_content.starts_at)).total_seconds() / 60
                    )}, suggested_operation=ProposalOperation.reschedule,
                ))
        return recommendations

    def next_available_day(
        self, records: Iterable[PlannerRecord], after: date, required_minutes: int
    ) -> date:
        workload = defaultdict(int)
        for record in records:
            if isinstance(record.content, TaskContent) and record.content.due_date:
                workload[record.content.due_date] += record.content.estimated_minutes
        candidate = after + timedelta(days=1)
        for _ in range(365):
            if workload[candidate] + required_minutes <= self.max_daily_minutes:
                return candidate
            candidate += timedelta(days=1)
        raise RuntimeError("No capacity found within planning horizon")
