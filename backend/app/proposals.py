from __future__ import annotations

import re
import secrets
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
    ReminderContent,
    TaskContent,
)
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


class InvalidProposal(ValueError):
    pass


class ProposalService:
    def __init__(self, repository: PlannerRepository, audit: AuditLogger):
        self.repository = repository
        self.audit = audit

    def from_generated_action(
        self, uid: str, action: GeneratedAction, rationale: str
    ) -> Optional[ActionProposal]:
        now = datetime.now(timezone.utc)
        before = None
        after: PlannerContent | None = None
        base_revision = None
        record_id = action.record_id

        if action.operation == ProposalOperation.create:
            if action.entity_type != EntityType.task or not action.title:
                return None
            record_id = generated_record_id()
            due_date, embedded_time = split_generated_datetime(action.due_date)
            after = TaskContent(
                title=action.title,
                due_date=due_date,
                # A time inside the date field is still the time they asked for.
                due_time=clean_generated_time(action.due_time) or embedded_time,
                priority=action.priority or "medium",
                notes=action.notes or "",
            )
        else:
            if not record_id:
                return None
            try:
                record = self.repository.get_record(uid, action.entity_type, record_id)
            except NotFound:
                return None
            before = record.content
            base_revision = record.revision
            if action.operation == ProposalOperation.delete:
                after = None
            elif action.operation == ProposalOperation.complete:
                if isinstance(before, (TaskContent, ReminderContent)):
                    after = before.model_copy(update={"completed": True})
                else:
                    return None
            elif action.operation == ProposalOperation.reschedule:
                new_date, embedded_time = split_generated_datetime(action.due_date)
                if not new_date:
                    return None
                new_time = clean_generated_time(action.due_time) or embedded_time
                if isinstance(before, TaskContent):
                    after = before.model_copy(update={"due_date": new_date, "due_time": new_time})
                elif isinstance(before, ReminderContent):
                    after = before.model_copy(update={"date": new_date, "time": new_time})
                else:
                    return None
            elif action.operation == ProposalOperation.update:
                updates = {
                    key: value for key, value in {
                        "title": action.title, "priority": action.priority, "notes": action.notes,
                    }.items() if value is not None
                }
                if not updates or (isinstance(before, NoteContent) and "priority" in updates):
                    return None
                after = before.model_copy(update=updates)

        proposal = ActionProposal(
            proposal_id=secrets.token_urlsafe(18), operation=action.operation,
            entity_type=action.entity_type, record_id=record_id, base_revision=base_revision,
            before=before, after=after, rationale=rationale[:1000],
            created_at=now, expires_at=now + timedelta(minutes=30),
        )
        self.repository.save_proposal(uid, proposal)
        self.audit.record(uid, "proposal_created", metadata={
            "operation": proposal.operation.value, "entity_type": proposal.entity_type.value,
        })
        return proposal

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
