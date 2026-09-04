"""Turning "every Friday" into the days it actually means."""

from __future__ import annotations

from datetime import date

from app.ai import GeneratedAction
from app.models import (
    EntityType,
    ProposalOperation,
    RecordUpsertRequest,
    RecurrenceRule,
)
from app.recurrence import HORIZON_DAYS, MAX_OCCURRENCES, describe, expand


def rule(frequency="weekly", interval=1, count=4):
    return RecurrenceRule(frequency=frequency, interval=interval, count=count)


def test_the_first_occurrence_is_the_day_they_asked_for(services):
    # "Every Friday starting today" includes today, not a week from today.
    assert expand(rule(count=3), date(2026, 9, 4))[0] == date(2026, 9, 4)


def test_three_months_of_weekly_is_thirteen_fridays(services):
    dates = expand(rule(count=13), date(2026, 9, 4))
    assert len(dates) == 13
    assert dates[-1] == date(2026, 11, 27)
    assert {day.weekday() for day in dates} == {4}


def test_an_interval_skips_the_weeks_between(services):
    dates = expand(rule(interval=2, count=3), date(2026, 9, 4))
    assert dates == [date(2026, 9, 4), date(2026, 9, 18), date(2026, 10, 2)]


def test_a_monthly_repeat_from_the_31st_lands_on_short_months(services):
    # February has no 31st. The end of the month is what a person means.
    dates = expand(rule(frequency="monthly", count=4), date(2026, 1, 31))
    assert dates == [
        date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30),
    ]


def test_daily_counts_days(services):
    dates = expand(rule(frequency="daily", count=3), date(2026, 9, 4))
    assert dates == [date(2026, 9, 4), date(2026, 9, 5), date(2026, 9, 6)]


def test_a_series_stops_at_the_planning_horizon(services):
    # Sixty daily records is fine; sixty monthly ones would reach into 2031.
    dates = expand(rule(frequency="monthly", count=MAX_OCCURRENCES), date(2026, 9, 4))
    assert dates[-1] <= date(2026, 9, 4) + __import__("datetime").timedelta(days=HORIZON_DAYS)


def test_the_rule_is_described_the_way_a_person_says_it(services):
    assert describe(rule(count=13)) == "every week, 13 times"
    assert describe(rule(interval=2, count=3)) == "every 2 weeks, 3 times"


# ---------------------------------------------------------------------------
# One confirmation, one series.
# ---------------------------------------------------------------------------


def repeat_action(**overrides):
    return GeneratedAction(**{
        "operation": ProposalOperation.create, "entity_type": EntityType.reminder,
        "title": "Fill Microsoft Form", "due_date": "2026-09-04", "due_time": "13:30",
        "repeat_frequency": "weekly", "repeat_count": 13, **overrides,
    })


def test_a_repeat_is_one_preview_not_thirteen(services):
    # The reported complaint: a recurring request used to be one confirmation
    # per date, when it was not simply refused outright.
    prepared = services.proposals.prepare("alice", repeat_action(), "Every Friday at 1:30.")

    assert prepared.proposal is not None
    assert len(prepared.proposal.series) == 13
    assert prepared.proposal.after.date == date(2026, 9, 4)
    assert "13 records" in prepared.proposal.rationale


def test_confirming_once_writes_the_whole_series(services):
    prepared = services.proposals.prepare("alice", repeat_action(), "Every Friday at 1:30.")

    services.proposals.confirm("alice", prepared.proposal.proposal_id, "series-key-0001", None)

    written = services.repository.list_records("alice", EntityType.reminder)
    assert len(written) == 13
    assert {record.content.time for record in written} == {"13:30"}
    assert len({record.content.series_id for record in written}) == 1
    assert all(record.content.recurrence.count == 13 for record in written)


def test_every_record_in_a_series_stands_on_its_own(services):
    # No per-occurrence exception model: each is a real record, so completing
    # or moving one is the ordinary path.
    prepared = services.proposals.prepare("alice", repeat_action(), "Every Friday.")
    services.proposals.confirm("alice", prepared.proposal.proposal_id, "series-key-0002", None)

    written = sorted(
        services.repository.list_records("alice", EntityType.reminder),
        key=lambda record: record.content.date,
    )
    assert len({record.record_id for record in written}) == 13

    # Completing the second Friday leaves the other twelve alone.
    second = written[1]
    services.repository.upsert_record(
        "alice", EntityType.reminder, second.record_id,
        RecordUpsertRequest(
            content=second.content.model_copy(update={"completed": True}),
            expected_revision=second.revision, idempotency_key="complete-one-0001",
            approved_for_ai=True,
        ),
    )

    after = services.repository.list_records("alice", EntityType.reminder)
    assert sum(1 for record in after if record.content.completed) == 1


def test_a_repeat_the_model_asked_for_badly_still_makes_one_record(services):
    # A single record is a sane outcome; a rejected reply is not.
    prepared = services.proposals.prepare(
        "alice", repeat_action(repeat_frequency=None, repeat_count=13), "Once.",
    )

    assert len(prepared.proposal.series) == 1


def test_a_repeat_is_capped_rather_than_refused(services):
    prepared = services.proposals.prepare(
        "alice", repeat_action(repeat_frequency="daily", repeat_count=500), "Daily forever.",
    )

    assert len(prepared.proposal.series) <= MAX_OCCURRENCES


def test_a_note_cannot_repeat(services):
    prepared = services.proposals.prepare("alice", repeat_action(
        entity_type=EntityType.note, repeat_frequency="weekly", repeat_count=4,
    ), "Weekly note.")

    assert prepared.proposal is None
    assert "only tasks and reminders can repeat" in prepared.reason


def test_a_repeating_task_carries_its_rule_too(services):
    prepared = services.proposals.prepare("alice", repeat_action(
        entity_type=EntityType.task, title="Weekly review",
    ), "Every Friday.")
    services.proposals.confirm("alice", prepared.proposal.proposal_id, "series-key-0003", None)

    written = services.repository.list_records("alice", EntityType.task)
    assert len(written) == 13
    assert all(record.content.recurrence.frequency == "weekly" for record in written)


def test_an_ordinary_create_is_untouched_by_any_of_this(services):
    prepared = services.proposals.prepare("alice", repeat_action(repeat_frequency=None), "Once.")
    services.proposals.confirm("alice", prepared.proposal.proposal_id, "single-key-0001", None)

    written = services.repository.list_records("alice", EntityType.reminder)
    assert len(written) == 1
    assert written[0].content.series_id is None
    assert written[0].content.recurrence is None
