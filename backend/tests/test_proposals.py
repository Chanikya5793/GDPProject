from datetime import date

import pytest

from app.ai import GeneratedAction
from app.models import EntityType, ProposalOperation, RecordUpsertRequest, TaskContent
from app.proposals import InvalidProposal
from app.repository import NotFound, RevisionConflict


def existing_task(services):
    return services.repository.upsert_record(
        "alice", EntityType.task, "t1",
        RecordUpsertRequest(
            content=TaskContent(title="Write essay", due_date=date(2026, 8, 20)),
            idempotency_key="create-task-001",
        ),
    )


def test_complete_proposal_has_before_after_preview(services):
    existing_task(services)
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.complete, entity_type=EntityType.task, record_id="t1"
        ), "Mark it done",
    )
    assert proposal.before.completed is False
    assert proposal.after.completed is True
    assert services.repository.get_record("alice", EntityType.task, "t1").content.completed is False


def test_confirmation_applies_only_after_matching_revision(services):
    existing_task(services)
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.complete, entity_type=EntityType.task, record_id="t1"
        ), "Done",
    )
    with pytest.raises(InvalidProposal):
        services.proposals.confirm("alice", proposal.proposal_id, "confirm-0001", 2)
    confirmed = services.proposals.confirm("alice", proposal.proposal_id, "confirm-0001", 1)
    assert confirmed.status == "confirmed"
    assert services.repository.get_record("alice", EntityType.task, "t1").content.completed


def test_confirmation_is_idempotent(services):
    existing_task(services)
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.complete, entity_type=EntityType.task, record_id="t1"
        ), "Done",
    )
    first = services.proposals.confirm("alice", proposal.proposal_id, "confirm-0001", 1)
    second = services.proposals.confirm("alice", proposal.proposal_id, "confirm-0001", 1)
    assert first == second
    assert services.repository.get_record("alice", EntityType.task, "t1").revision == 2


def test_stale_write_between_preview_and_confirmation_is_rejected(services):
    current = existing_task(services)
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.delete, entity_type=EntityType.task, record_id="t1"
        ), "Delete",
    )
    services.repository.upsert_record(
        "alice", EntityType.task, "t1",
        RecordUpsertRequest(
            content=current.content.model_copy(update={"title": "Changed"}), expected_revision=1,
            idempotency_key="outside-update-1",
        ),
    )
    with pytest.raises(RevisionConflict):
        services.proposals.confirm("alice", proposal.proposal_id, "confirm-0001", 1)


def test_reject_and_cancel_never_mutate(services):
    existing_task(services)
    reject = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.delete, entity_type=EntityType.task, record_id="t1"
        ), "Delete",
    )
    assert services.proposals.reject("alice", reject.proposal_id).status == "rejected"
    cancel = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.complete, entity_type=EntityType.task, record_id="t1"
        ), "Done",
    )
    assert services.proposals.cancel("alice", cancel.proposal_id).status == "cancelled"
    assert not services.repository.get_record("alice", EntityType.task, "t1").content.completed


def test_create_proposal_does_not_create_until_confirmed(services):
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.task,
            title="New task", due_date="2026-08-30",
        ), "Create",
    )
    assert services.repository.list_records("alice", EntityType.task) == []
    services.proposals.confirm("alice", proposal.proposal_id, "confirm-0001", None)
    assert len(services.repository.list_records("alice", EntityType.task)) == 1


def test_a_confirmed_creation_is_visible_to_the_assistant(services):
    # The user asked the assistant to create it, so hiding it from the assistant
    # would leave it unable to answer about its own work a moment later.
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.task,
            title="Lab report", due_date="2026-09-01",
        ), "Create",
    )
    services.proposals.confirm("alice", proposal.proposal_id, "confirm-vis-1", None)
    created = services.repository.list_records("alice", EntityType.task)[0]
    assert created.approved_for_ai is True


@pytest.mark.parametrize("action", [
    GeneratedAction(operation=ProposalOperation.create, entity_type=EntityType.note),
    GeneratedAction(operation=ProposalOperation.complete, entity_type=EntityType.task),
    GeneratedAction(operation=ProposalOperation.reschedule, entity_type=EntityType.task, record_id="missing"),
])
def test_invalid_generated_actions_do_not_create_proposals(services, action):
    assert services.proposals.from_generated_action("alice", action, "Nope") is None


def test_reschedule_and_update_proposals(services):
    existing_task(services)
    reschedule = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.reschedule, entity_type=EntityType.task,
            record_id="t1", due_date="2026-09-01", due_time="09:30",
        ), "Move it",
    )
    assert reschedule.after.due_date == date(2026, 9, 1)
    update = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.update, entity_type=EntityType.task,
            record_id="t1", priority="high",
        ), "Escalate",
    )
    assert update.after.priority == "high"


def test_delete_proposal_requires_confirmation(services):
    existing_task(services)
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.delete, entity_type=EntityType.task, record_id="t1"
        ), "Delete",
    )
    assert services.repository.get_record("alice", EntityType.task, "t1")
    services.proposals.confirm("alice", proposal.proposal_id, "delete-confirm-1", 1)
    with pytest.raises(NotFound):
        services.repository.get_record("alice", EntityType.task, "t1")
