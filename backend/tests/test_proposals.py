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


def test_a_reminder_can_be_created(services):
    # create used to accept tasks only, so the assistant could not make a
    # reminder at all however clearly it was asked.
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.reminder,
            title="Call the advisor", due_date="2026-09-04", due_time="09:15",
        ), "Create",
    )
    assert proposal is not None
    assert proposal.after.date == date(2026, 9, 4)
    assert proposal.after.time == "09:15"


def test_a_reminder_without_a_day_is_refused(services):
    # A reminder with no date has nothing to fire on; inventing one would be
    # worse than asking.
    assert services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.reminder,
            title="Call the advisor",
        ), "Create",
    ) is None


def test_a_note_can_be_created_with_its_text(services):
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.note,
            title="Lecture 4", body="Recursion, trees, Big-O.",
        ), "Create",
    )
    assert proposal is not None
    assert proposal.after.title == "Lecture 4"
    assert proposal.after.body == "Recursion, trees, Big-O."


def test_a_note_falls_back_to_notes_when_the_model_uses_the_wrong_field(services):
    # body is the note's own field, but the model reaches for notes by habit.
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.note,
            title="Lecture 5", notes="Graphs.",
        ), "Create",
    )
    assert proposal.after.body == "Graphs."


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


class TestGeneratedDateParsing:
    """The model fills these fields, so they are untrusted input."""

    def test_a_full_datetime_becomes_a_date_and_a_time(self):
        # "next Friday at 5pm" came back as 2026-09-04T17:00:00 and crashed the
        # endpoint with an unhandled ValueError.
        from app.proposals import split_generated_datetime
        assert split_generated_datetime("2026-09-04T17:00:00") == (date(2026, 9, 4), "17:00")

    def test_a_plain_date_has_no_time(self):
        from app.proposals import split_generated_datetime
        assert split_generated_datetime("2026-09-04") == (date(2026, 9, 4), None)

    @pytest.mark.parametrize("value", [None, "", "   ", "next friday", "2026-13-40", "garbage"])
    def test_unreadable_values_are_treated_as_absent(self, value):
        from app.proposals import split_generated_datetime
        assert split_generated_datetime(value) == (None, None)

    def test_an_out_of_range_time_is_dropped_but_the_date_survives(self):
        from app.proposals import split_generated_datetime
        assert split_generated_datetime("2026-09-04T99:99") == (date(2026, 9, 4), None)

    @pytest.mark.parametrize("value,expected", [
        ("17:00", "17:00"), ("09:30", "09:30"), ("9:30", None),
        ("25:00", None), ("abc", None), (None, None), ("", None),
    ])
    def test_only_times_the_record_models_accept_survive(self, value, expected):
        from app.proposals import clean_generated_time
        assert clean_generated_time(value) == expected


def test_a_datetime_in_the_date_field_still_produces_a_proposal(services):
    # End to end: this exact input returned HTTP 500 before.
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.task,
            title="Physics problem set", due_date="2026-09-04T17:00:00",
        ), "Create",
    )
    assert proposal is not None
    assert proposal.after.due_date == date(2026, 9, 4)
    assert proposal.after.due_time == "17:00"


def test_a_junk_date_from_the_model_refuses_rather_than_raising(services):
    proposal = services.proposals.from_generated_action(
        "alice", GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.task,
            title="Whatever", due_date="sometime next week",
        ), "Create",
    )
    # The title is enough to build a task; the unusable date is simply dropped.
    assert proposal is not None
    assert proposal.after.due_date is None
