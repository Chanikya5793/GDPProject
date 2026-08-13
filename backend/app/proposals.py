from __future__ import annotations

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
    RecordUpsertRequest,
    ReminderContent,
    TaskContent,
)
from .repository import NotFound, PlannerRepository, generated_record_id


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
            after = TaskContent(
                title=action.title,
                due_date=date.fromisoformat(action.due_date) if action.due_date else None,
                due_time=action.due_time,
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
                if not action.due_date:
                    return None
                new_date = date.fromisoformat(action.due_date)
                if isinstance(before, TaskContent):
                    after = before.model_copy(update={"due_date": new_date, "due_time": action.due_time})
                elif isinstance(before, ReminderContent):
                    after = before.model_copy(update={"date": new_date, "time": action.due_time})
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
        assert proposal.record_id
        if proposal.operation == ProposalOperation.delete:
            assert proposal.base_revision is not None
            self.repository.delete_record(
                uid, proposal.entity_type, proposal.record_id, proposal.base_revision, idempotency_key
            )
        elif proposal.after is not None:
            current_approval = False
            if proposal.base_revision:
                current = self.repository.get_record(uid, proposal.entity_type, proposal.record_id)
                if current.revision != proposal.base_revision:
                    raise InvalidProposal("Record changed after the preview was created")
                current_approval = current.approved_for_ai
            self.repository.upsert_record(
                uid, proposal.entity_type, proposal.record_id,
                RecordUpsertRequest(
                    content=proposal.after, expected_revision=proposal.base_revision,
                    idempotency_key=idempotency_key, approved_for_ai=current_approval,
                ),
            )
        confirmed = self.repository.update_proposal_status(uid, proposal_id, "confirmed")
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
