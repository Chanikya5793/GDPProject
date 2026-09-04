from __future__ import annotations

import re
import secrets
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from .ai import GeneratedAction
from .audit import AuditLogger
from .models import (
    ActionProposal,
    EntityType,
    NoteContent,
    PlannerContent,
    ProposalOperation,
    ProposedRecord,
    RecurrenceRule,
    ReminderContent,
    TaskContent,
)
from .recurrence import MAX_OCCURRENCES, describe, expand
from .repository import NotFound, PlannerRepository, generated_record_id

# The model fills these fields, so they are untrusted input like any other. It
# answers "next Friday at 5pm" with a full datetime in due_date, which
# date.fromisoformat rejects outright, and an unhandled ValueError there is a 500
# in the student's face. Parse defensively and treat anything unreadable as
# absent, which the callers already know how to refuse.
_TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)")


def split_generated_datetime(value: Optional[str]) -> tuple[Optional[date], Optional[str]]:
    """Split whatever the model put in a date field into a date and maybe a time."""
    text = (value or "").strip()
    if not text:
        return None, None
    date_part, _, time_part = text.partition("T")
    try:
        parsed_date = date.fromisoformat(date_part)
    except ValueError:
        return None, None
    match = _TIME_PATTERN.match(time_part)
    return parsed_date, f"{match.group(1)}:{match.group(2)}" if match else None


def clean_generated_time(value: Optional[str]) -> Optional[str]:
    """A time the record models will accept, or None. They pin HH:MM and reject
    anything else with a validation error the caller cannot catch usefully."""
    match = _TIME_PATTERN.match((value or "").strip())
    return f"{match.group(1)}:{match.group(2)}" if match else None


# How long a preview stays confirmable. Thirty minutes was shorter than the
# conversation it belonged to: the chat now survives a reload, so a student
# coming back to a thread found every change in it dead. A stale confirm is not
# dangerous -- it carries the base revision it was built from, so a record
# edited in the meantime is refused rather than clobbered -- which is what makes
# a generous window safe.
DEFAULT_PROPOSAL_TTL_HOURS = 24


class InvalidProposal(ValueError):
    pass


@dataclass
class PreparedAction:
    """A change turned into a preview, or the reason it could not be.

    The reason exists because "I could not prepare that change" told the student
    nothing at all: not which change, and not what was missing.
    """

    proposal: Optional[ActionProposal] = None
    reason: str = ""


class ProposalService:
    def __init__(
        self, repository: PlannerRepository, audit: AuditLogger,
        ttl_hours: int = DEFAULT_PROPOSAL_TTL_HOURS,
    ):
        self.repository = repository
        self.audit = audit
        self.ttl_hours = ttl_hours

    def prepare(self, uid: str, action: GeneratedAction, rationale: str) -> PreparedAction:
        """Build the preview, or say plainly why the change cannot be one."""
        now = datetime.now(timezone.utc)
        before = None
        after: PlannerContent | None = None
        base_revision = None
        record_id = action.record_id

        if action.operation == ProposalOperation.create:
            if not action.title:
                return PreparedAction(reason="it did not say what to call it")
            repeat = _requested_repeat(action)
            record_id = generated_record_id()
            due_date, embedded_time = split_generated_datetime(action.due_date)
            # A time inside the date field is still the time they asked for.
            at_time = clean_generated_time(action.due_time) or embedded_time
            if action.entity_type == EntityType.task:
                after = TaskContent(
                    title=action.title, due_date=due_date, due_time=at_time,
                    priority=action.priority or "medium", notes=action.notes or "",
                )
            elif action.entity_type == EntityType.reminder:
                # A reminder is meaningless without a day to fire on, so refuse
                # rather than invent one; the model is told to ask instead.
                if not due_date:
                    return PreparedAction(reason="a reminder needs a day to fire on")
                after = ReminderContent(
                    title=action.title, date=due_date, time=at_time,
                    notes=action.notes or "",
                )
            elif action.entity_type == EntityType.note:
                after = NoteContent(
                    title=action.title, body=action.body or action.notes or "",
                )
            else:
                # ScheduleContent exists in the model, but nothing in either
                # client renders one, so a confirmed calendar block would vanish
                # into a collection no screen reads. Refusing with a reason the
                # student can act on beats writing an invisible record.
                return PreparedAction(reason=(
                    "I can only create tasks, reminders and notes, not calendar "
                    "blocks. Ask me for a task with a time and I will set that up"
                ))
        else:
            if not record_id:
                return PreparedAction(reason="it did not say which record to change")
            try:
                record = self.repository.get_record(uid, action.entity_type, record_id)
            except NotFound:
                return PreparedAction(reason="that record no longer exists")
            before = record.content
            base_revision = record.revision
            if action.operation == ProposalOperation.delete:
                after = None
            elif action.operation == ProposalOperation.complete:
                if isinstance(before, (TaskContent, ReminderContent)):
                    after = before.model_copy(update={"completed": True})
                else:
                    return PreparedAction(reason="only tasks and reminders can be completed")
            elif action.operation == ProposalOperation.reschedule:
                new_date, embedded_time = split_generated_datetime(action.due_date)
                if not new_date:
                    return PreparedAction(reason="it did not say what day to move it to")
                new_time = clean_generated_time(action.due_time) or embedded_time
                if isinstance(before, TaskContent):
                    after = before.model_copy(update={"due_date": new_date, "due_time": new_time})
                elif isinstance(before, ReminderContent):
                    after = before.model_copy(update={"date": new_date, "time": new_time})
                else:
                    return PreparedAction(reason="only tasks and reminders have a day to move")
            elif action.operation == ProposalOperation.update:
                updates = {
                    key: value for key, value in {
                        "title": action.title, "priority": action.priority, "notes": action.notes,
                    }.items() if value is not None
                }
                if not updates:
                    return PreparedAction(reason="it did not say what to change about it")
                if isinstance(before, NoteContent) and "priority" in updates:
                    return PreparedAction(reason="a note has no priority to set")
                after = before.model_copy(update=updates)

        series: list[ProposedRecord] = []
        if action.operation == ProposalOperation.create and after is not None:
            repeat = _requested_repeat(action)
            if repeat and not isinstance(after, (TaskContent, ReminderContent)):
                return PreparedAction(reason="only tasks and reminders can repeat")
            first = due_date if isinstance(after, TaskContent) else getattr(after, "date", None)
            if repeat and first is None:
                return PreparedAction(reason="a repeat needs a day to start on")
            if repeat:
                dates = expand(repeat, first)
                if not dates:
                    return PreparedAction(reason="that repeat works out to no dates at all")
                series_id = generated_record_id()
                for index, occurrence in enumerate(dates):
                    moved = _on_date(after, occurrence).model_copy(
                        update={"series_id": series_id, "recurrence": repeat}
                    )
                    series.append(ProposedRecord(
                        record_id=record_id if index == 0 else generated_record_id(),
                        content=moved,
                    ))
                # The preview shows the first occurrence, and the rationale says
                # how many follow, so a series is judged as one thing.
                after = series[0].content
                rationale = (
                    f"{rationale}\n\nRepeats {describe(repeat)}: "
                    f"{len(dates)} records from {dates[0].isoformat()} to "
                    f"{dates[-1].isoformat()}."
                )
            else:
                series.append(ProposedRecord(record_id=record_id, content=after))

        proposal = ActionProposal(
            proposal_id=secrets.token_urlsafe(18), operation=action.operation,
            entity_type=action.entity_type, record_id=record_id, base_revision=base_revision,
            before=before, after=after, series=series, rationale=rationale[:2000],
            created_at=now, expires_at=now + timedelta(hours=self.ttl_hours),
        )
        self.repository.save_proposal(uid, proposal)
        self.audit.record(uid, "proposal_created", metadata={
            "operation": proposal.operation.value, "entity_type": proposal.entity_type.value,
            "records": len(proposal.series) or 1,
        })
        return PreparedAction(proposal=proposal)

    def from_generated_action(
        self, uid: str, action: GeneratedAction, rationale: str
    ) -> Optional[ActionProposal]:
        """The proposal alone, for callers that do not report the reason."""
        return self.prepare(uid, action, rationale).proposal

    def confirm(
        self, uid: str, proposal_id: str, idempotency_key: str,
        expected_base_revision: Optional[int],
    ) -> ActionProposal:
        proposal = self.repository.get_proposal(uid, proposal_id)
        if proposal.status == "confirmed":
            return proposal
        if proposal.status != "pending":
            raise InvalidProposal(f"Proposal is {proposal.status}")
        if proposal.expires_at <= datetime.now(timezone.utc):
            self.repository.update_proposal_status(uid, proposal_id, "cancelled")
            raise InvalidProposal("Proposal expired")
        if expected_base_revision != proposal.base_revision:
            raise InvalidProposal("Confirmation does not match the previewed revision")
        try:
            confirmed = self.repository.apply_proposal(uid, proposal, idempotency_key)
        except Exception as exc:
            self.audit.record(uid, "failure", "failed", {
                "stage": "proposal_confirmation", "error_type": type(exc).__name__,
            })
            raise
        self.audit.record(uid, "proposal_confirmed", metadata={
            "operation": proposal.operation.value, "entity_type": proposal.entity_type.value,
        })
        return confirmed

    def reject(self, uid: str, proposal_id: str) -> ActionProposal:
        proposal = self.repository.get_proposal(uid, proposal_id)
        if proposal.status != "pending":
            raise InvalidProposal(f"Proposal is {proposal.status}")
        rejected = self.repository.update_proposal_status(uid, proposal_id, "rejected")
        self.audit.record(uid, "proposal_rejected", metadata={
            "operation": proposal.operation.value, "entity_type": proposal.entity_type.value,
        })
        return rejected

    def cancel(self, uid: str, proposal_id: str) -> ActionProposal:
        proposal = self.repository.get_proposal(uid, proposal_id)
        if proposal.status != "pending":
            raise InvalidProposal(f"Proposal is {proposal.status}")
        return self.repository.update_proposal_status(uid, proposal_id, "cancelled")


def _requested_repeat(action: GeneratedAction) -> Optional[RecurrenceRule]:
    """The repeat the model asked for, or None. Anything unusable is treated as
    no repeat rather than an error, because a single record is a sane outcome
    and a rejected reply is not."""
    if not action.repeat_frequency:
        return None
    try:
        return RecurrenceRule(
            frequency=action.repeat_frequency,
            interval=action.repeat_interval or 1,
            count=min(action.repeat_count or 1, MAX_OCCURRENCES),
        )
    except ValueError:
        return None


def _on_date(content: PlannerContent, day: date) -> PlannerContent:
    """The same content, moved to another day, whatever its type calls that."""
    if isinstance(content, TaskContent):
        return content.model_copy(update={"due_date": day})
    return content.model_copy(update={"date": day})
