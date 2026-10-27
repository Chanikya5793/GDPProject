"""The retrieval trace: every candidate's distance and outcome, as the
client's trace view shows them, without naming records the assistant may not
use."""
from datetime import date

from app.ai import GeneratedAnswer
from app.models import (
    CandidateOutcome,
    EntityType,
    NoteContent,
    PrivacySettings,
    RecordUpsertRequest,
    TaskContent,
)


def enable(services, uid="alice", kinds=(EntityType.task,)):
    services.repository.set_privacy(uid, PrivacySettings(ai_enabled=True, indexed_entity_types=list(kinds)))


def task(services, record_id, title, uid="alice", approved=True, notes="Study chapters 1 through 5"):
    record = services.repository.upsert_record(
        uid, EntityType.task, record_id,
        RecordUpsertRequest(
            content=TaskContent(title=title, due_date=date(2026, 8, 20), notes=notes),
            idempotency_key=f"create-{uid}-{record_id}", approved_for_ai=approved,
        ),
    )
    services.indexing.index(uid, EntityType.task, record.record_id, record.revision)
    return record


def test_search_reports_every_candidate_with_its_distance(services):
    enable(services)
    task(services, "t1", "Chemistry exam")
    task(services, "t2", "Physics lab report")
    records, citations, trace = services.retrieval.search("alice", "chemistry exam")
    assert [r.record_id for r in records] == ["t1"]
    assert trace.query == "chemistry exam"
    assert trace.requested == services.retrieval.limit * 5
    assert trace.limit == services.retrieval.limit
    by_id = {c.record_id: c for c in trace.candidates}
    assert by_id["t1"].outcome == CandidateOutcome.kept
    assert by_id["t1"].distance == round(by_id["t1"].distance, 6)
    assert [c.rank for c in trace.candidates] == sorted(c.rank for c in trace.candidates)
    distances = [c.distance for c in trace.candidates]
    assert distances == sorted(distances)
    # The retrieve() API callers rely on is unchanged.
    assert services.retrieval.retrieve("alice", "chemistry exam")[0][0].record_id == "t1"
    assert citations[0].record_id == "t1"


def test_a_stale_vector_is_named_but_a_record_that_lost_approval_is_not(services):
    enable(services)
    stale = task(services, "t1", "Chemistry exam")
    services.repository.upsert_record(
        "alice", EntityType.task, "t1",
        RecordUpsertRequest(
            content=stale.content.model_copy(update={"notes": "moved"}),
            expected_revision=1, idempotency_key="update-t1", approved_for_ai=True,
        ),
    )
    hidden = task(services, "t2", "Chemistry quiz")
    services.repository.upsert_record(
        "alice", EntityType.task, "t2",
        RecordUpsertRequest(
            content=hidden.content, expected_revision=1, idempotency_key="unapprove-t2",
            approved_for_ai=False,
        ),
    )
    _, _, trace = services.retrieval.search("alice", "chemistry")
    outcomes = {c.outcome: c for c in trace.candidates}
    assert outcomes[CandidateOutcome.stale_revision].record_id == "t1"
    # Revoking approval may leave a vector behind until it is cleaned up; the
    # trace still must not point at the record.
    if CandidateOutcome.not_approved in outcomes:
        assert outcomes[CandidateOutcome.not_approved].record_id is None
        assert all(c.record_id != "t2" for c in trace.candidates)


def test_excluded_types_and_type_filters_are_reported(services):
    enable(services, kinds=(EntityType.task, EntityType.note))
    task(services, "t1", "Chemistry exam")
    note = services.repository.upsert_record(
        "alice", EntityType.note, "n1",
        RecordUpsertRequest(content=NoteContent(title="Chemistry notes", body="Moles"),
                            idempotency_key="create-n1", approved_for_ai=True),
    )
    services.indexing.index("alice", EntityType.note, note.record_id, note.revision)
    _, _, filtered = services.retrieval.search("alice", "chemistry", EntityType.task)
    assert {c.outcome for c in filtered.candidates} >= {CandidateOutcome.kept, CandidateOutcome.type_filtered}
    enable(services, kinds=(EntityType.task,))
    _, _, excluded = services.retrieval.search("alice", "chemistry")
    hidden = [c for c in excluded.candidates if c.outcome == CandidateOutcome.type_not_indexed]
    assert hidden and all(c.record_id is None for c in hidden)


def test_no_shared_word_and_limit_are_outcomes_too(services):
    enable(services)
    for i in range(7):
        task(services, f"t{i}", f"Chemistry exam {i}")
    services.retrieval.limit = 5
    _, _, trace = services.retrieval.search("alice", "chemistry")
    outcomes = [c.outcome for c in trace.candidates]
    assert outcomes.count(CandidateOutcome.kept) == 5
    assert CandidateOutcome.limit_reached in outcomes


def test_a_stopword_query_is_marked_skipped(services):
    enable(services)
    task(services, "t1", "Chemistry exam")
    records, _, trace = services.retrieval.search("alice", "what is the")
    assert records == []
    assert trace.skipped and trace.candidates == []


def test_the_chat_response_carries_the_turns_searches(services):
    enable(services)
    task(services, "t1", "Chemistry exam")
    services.test_generator.response = GeneratedAnswer(answer="It is on the 20th.", citation_ids=["S1"])
    _, citations, disclosure, _ = services.copilot.answer("alice", "when is my chemistry exam?")
    assert disclosure.searches, "the opening search is reported"
    opening = disclosure.searches[0]
    kept = [c for c in opening.candidates if c.outcome == CandidateOutcome.kept]
    assert kept[0].record_id == "t1"
    # The citation id is the one the assistant was shown, so the trace and the
    # reply's citations agree.
    assert kept[0].citation_id == citations[0].citation_id


def test_another_users_records_never_appear_in_the_trace(services):
    enable(services, "alice")
    enable(services, "bob")
    task(services, "alice-secret", "Chemistry secret", uid="alice")
    task(services, "bob-task", "Chemistry homework", uid="bob")
    _, _, trace = services.retrieval.search("bob", "chemistry secret")
    assert all(c.record_id in (None, "bob-task") for c in trace.candidates)
