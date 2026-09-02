"""The assistant's own reasoning: what it is shown, what it may look up, and
what it is allowed to say once it has."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone

import pytest

from app.ai import GeneratedAction, GeneratedAnswer, ToolName, ToolRequest
from app.models import (
    EntityType,
    PrivacySettings,
    ProposalOperation,
    RecordUpsertRequest,
    ReminderContent,
    ScheduleContent,
    TaskContent,
)
from app.rag import AgentStep

TODAY = date(2026, 9, 2)


def add_task(services, record_id, title, due=None, uid="alice", approved=True, **content):
    return services.repository.upsert_record(
        uid, EntityType.task, record_id,
        RecordUpsertRequest(
            content=TaskContent(title=title, due_date=due, **content),
            idempotency_key=f"seed-{uid}-{record_id}", approved_for_ai=approved,
        ),
    )


def add_reminder(services, record_id, title, due, uid="alice", approved=True):
    return services.repository.upsert_record(
        uid, EntityType.reminder, record_id,
        RecordUpsertRequest(
            content=ReminderContent(title=title, date=due),
            idempotency_key=f"seed-{uid}-{record_id}", approved_for_ai=approved,
        ),
    )


def add_schedule(services, record_id, title, starts, ends, uid="alice"):
    return services.repository.upsert_record(
        uid, EntityType.schedule, record_id,
        RecordUpsertRequest(
            content=ScheduleContent(title=title, starts_at=starts, ends_at=ends),
            idempotency_key=f"seed-{uid}-{record_id}", approved_for_ai=True,
        ),
    )


def briefing_from(prompt: str) -> dict:
    """Pull the briefing back out of the prompt the model was handed."""
    marker = "PLANNER_BRIEFING="
    start = prompt.index(marker) + len(marker)
    end = prompt.index("\nUNTRUSTED_SOURCES=", start)
    return json.loads(prompt[start:end])


def section_from(prompt: str, marker: str):
    start = prompt.index(marker) + len(marker)
    end = prompt.find("\n", start)
    return json.loads(prompt[start:] if end == -1 else prompt[start:end])


class ScriptedGenerator:
    """Answers a scripted sequence, one entry per generation.

    Standing in for a model that decides to look something up: the first entry
    asks for tools, the second answers with what came back.
    """

    provider = "scripted"
    trains_on_prompts = False
    model = "scripted-model"

    def __init__(self, *responses: GeneratedAnswer):
        self.responses = list(responses)
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> GeneratedAnswer:
        self.prompts.append(prompt)
        index = min(len(self.prompts) - 1, len(self.responses) - 1)
        return self.responses[index]


class ScriptedStreamingGenerator(ScriptedGenerator):
    def generate_stream(self, prompt: str):
        response = self.generate(prompt)
        if response.answer:
            yield response.answer
        yield response


def use(services, *responses: GeneratedAnswer) -> ScriptedGenerator:
    generator = ScriptedGenerator(*responses)
    services.copilot.generator = generator
    return generator


# ---------------------------------------------------------------------------
# The briefing: what the assistant is handed before it is asked anything.
# ---------------------------------------------------------------------------


def test_the_briefing_sorts_the_planner_into_days_without_being_asked(services):
    # The point of the whole thing: "what is due today" is a date question, and
    # cosine similarity cannot answer one. The briefing has to arrive already
    # bucketed, computed rather than guessed.
    add_task(services, "late", "Lab report", date(2026, 8, 28))
    add_task(services, "now", "Chemistry revision", TODAY)
    add_task(services, "soon", "Essay outline", date(2026, 9, 3))
    add_task(services, "week", "Group project", date(2026, 9, 6))
    add_task(services, "someday", "Read chapter 9", None)
    add_task(services, "done", "Old quiz", date(2026, 8, 1), completed=True)
    generator = use(services, GeneratedAnswer(answer="ok"))

    services.copilot.answer("alice", "what is due today?", today=TODAY)
    briefing = briefing_from(generator.prompts[-1])

    assert [item["title"] for item in briefing["overdue"]] == ["Lab report"]
    assert [item["title"] for item in briefing["due_today"]] == ["Chemistry revision"]
    assert [item["title"] for item in briefing["due_tomorrow"]] == ["Essay outline"]
    assert [item["title"] for item in briefing["due_this_week"]] == ["Group project"]
    assert [item["title"] for item in briefing["unscheduled"]] == ["Read chapter 9"]
    assert briefing["today"] == "2026-09-02"
    assert briefing["counts"]["task_open"] == 5
    assert briefing["counts"]["task_completed"] == 1


def test_every_briefed_record_carries_a_citation_it_can_be_checked_against(services):
    add_task(services, "now", "Chemistry revision", TODAY)
    generator = use(services, GeneratedAnswer(answer="ok"))

    _, _, _, _ = services.copilot.answer("alice", "today", today=TODAY)
    briefing = briefing_from(generator.prompts[-1])

    cited = briefing["due_today"][0]["citation_id"]
    assert cited.startswith("S")


def test_a_briefed_citation_can_be_used_in_the_answer(services):
    # Without this the briefing would be unusable: the model could see a task
    # but have no ID to attach a claim to, and the guard would strike it out.
    record = add_task(services, "now", "Chemistry revision", TODAY)
    generator = use(services, GeneratedAnswer(answer="Chemistry revision is due today."))
    briefed = None

    def capture(prompt):
        nonlocal briefed
        briefed = briefing_from(prompt)
        generator.prompts.append(prompt)
        return GeneratedAnswer(
            answer="Chemistry revision is due today.",
            citation_ids=[briefed["due_today"][0]["citation_id"]],
        )

    generator.generate = capture
    answer, citations, disclosure, _ = services.copilot.answer("alice", "today", today=TODAY)

    assert not disclosure.abstained
    assert [citation.record_id for citation in citations] == [record.record_id]
    assert answer == "Chemistry revision is due today."


def test_the_briefing_obeys_the_same_privacy_gate_retrieval_does(services):
    add_task(services, "secret", "Therapy appointment", TODAY, approved=False)
    add_task(services, "shown", "Chemistry revision", TODAY)
    add_reminder(services, "hidden-kind", "Call home", TODAY)
    services.repository.set_privacy("alice", PrivacySettings(
        ai_enabled=True, indexed_entity_types=[EntityType.task],
    ))
    generator = use(services, GeneratedAnswer(answer="ok"))

    services.copilot.answer("alice", "today", today=TODAY)
    prompt = generator.prompts[-1]

    assert "Chemistry revision" in prompt
    assert "Therapy appointment" not in prompt
    assert "Call home" not in prompt


def test_the_briefing_is_not_built_for_a_student_who_opted_out(services):
    add_task(services, "now", "Chemistry revision", TODAY)
    services.repository.set_privacy("alice", PrivacySettings(ai_enabled=False))
    use(services, GeneratedAnswer(answer="ok"))

    with pytest.raises(PermissionError):
        services.copilot.answer("alice", "today", today=TODAY)


def test_the_briefing_stops_at_its_item_budget(services):
    for index in range(12):
        add_task(services, f"t{index}", f"Task {index}", date(2026, 9, 20))
    services.copilot.toolbox.briefing_items = 5
    generator = use(services, GeneratedAnswer(answer="ok"))

    services.copilot.answer("alice", "anything", today=TODAY)
    briefing = briefing_from(generator.prompts[-1])

    assert len(briefing["due_later"]) == 5
    assert "truncated" in briefing
    # The counts stay exact even when the listing does not, so it can still say
    # how many there are without listing them.
    assert briefing["counts"]["task_open"] == 12


def test_the_briefing_lists_overdue_work_before_it_runs_out_of_room(services):
    for index in range(6):
        add_task(services, f"later{index}", f"Later {index}", date(2026, 9, 30))
    add_task(services, "late", "Lab report", date(2026, 8, 20))
    services.copilot.toolbox.briefing_items = 3
    generator = use(services, GeneratedAnswer(answer="ok"))

    services.copilot.answer("alice", "anything", today=TODAY)
    briefing = briefing_from(generator.prompts[-1])

    assert [item["title"] for item in briefing["overdue"]] == ["Lab report"]


def test_the_briefing_carries_the_workload_findings(services):
    add_task(services, "a", "Essay", TODAY, estimated_minutes=90)
    add_task(services, "b", "Revision", TODAY, estimated_minutes=90)
    generator = use(services, GeneratedAnswer(answer="ok"))

    services.copilot.answer("alice", "am I overloaded?", today=TODAY)
    briefing = briefing_from(generator.prompts[-1])

    rules = {finding["rule_id"] for finding in briefing["findings"]}
    assert "workload.daily_capacity.v1" in rules
    assert briefing["minutes_due_today"] == 180


# ---------------------------------------------------------------------------
# Looking things up: the model asks, the server runs it, the model is asked again.
# ---------------------------------------------------------------------------


def test_the_assistant_can_ask_for_a_lookup_and_is_run_again_with_the_result(services):
    add_task(services, "done1", "Finished quiz", date(2026, 8, 10), completed=True)
    generator = use(
        services,
        GeneratedAnswer(tool_requests=[ToolRequest(
            tool=ToolName.find, entity_type=EntityType.task, status="completed",
        )]),
        GeneratedAnswer(answer="You have finished one thing so far."),
    )

    answer, _, _, _ = services.copilot.answer(
        "alice", "how much have I finished?", today=TODAY
    )

    assert answer == "You have finished one thing so far."
    assert len(generator.prompts) == 2
    assert "TOOL_RESULTS=" not in generator.prompts[0]
    results = section_from(generator.prompts[1], "TOOL_RESULTS=")
    assert results[0]["tool"] == "find"
    assert results[0]["result"]["count"] == 1
    assert results[0]["result"]["results"][0]["title"] == "Finished quiz"


def test_a_lookup_is_announced_as_a_step_so_the_pause_is_explained(services):
    add_task(services, "now", "Chemistry revision", TODAY)
    use(
        services,
        GeneratedAnswer(tool_requests=[ToolRequest(
            tool=ToolName.agenda, start="2026-09-01", end="2026-09-07",
        )]),
        GeneratedAnswer(answer="Here is your week."),
    )

    steps = [
        item for item in services.copilot.answer_stream("alice", "my week", today=TODAY)
        if isinstance(item, AgentStep)
    ]

    assert [step.tool for step in steps] == ["agenda"]
    assert "2026-09-01" in steps[0].label


def test_the_lookup_budget_is_finite(services):
    # A model that keeps asking for something new must still produce an answer
    # rather than looping until the request times out.
    generator = use(
        services,
        GeneratedAnswer(tool_requests=[ToolRequest(tool=ToolName.workload)]),
        GeneratedAnswer(tool_requests=[ToolRequest(tool=ToolName.find, query="essay")]),
        GeneratedAnswer(
            answer="Here is what I have.",
            tool_requests=[ToolRequest(tool=ToolName.find, query="one more thing")],
        ),
    )
    services.copilot.max_tool_rounds = 2

    answer, _, _, _ = services.copilot.answer("alice", "what should I do?", today=TODAY)

    assert answer == "Here is what I have."
    assert len(generator.prompts) == 3
    assert "TOOLS_AVAILABLE=true" in generator.prompts[0]
    assert "TOOLS_AVAILABLE=false" in generator.prompts[-1]


def test_lookups_can_be_switched_off_entirely(services):
    generator = use(services, GeneratedAnswer(
        answer="Answered without looking.",
        tool_requests=[ToolRequest(tool=ToolName.workload)],
    ))
    services.copilot.max_tool_rounds = 0

    services.copilot.answer("alice", "anything", today=TODAY)

    assert len(generator.prompts) == 1
    assert "TOOLS_AVAILABLE=false" in generator.prompts[0]


def test_the_same_lookup_is_not_run_twice(services):
    # Repeating a request would spend a whole generation to learn nothing, and
    # a model that repeats itself would otherwise never terminate early.
    generator = use(
        services,
        GeneratedAnswer(tool_requests=[ToolRequest(tool=ToolName.workload)]),
        GeneratedAnswer(tool_requests=[ToolRequest(tool=ToolName.workload)]),
        GeneratedAnswer(answer="unreachable"),
    )

    services.copilot.answer("alice", "anything", today=TODAY)

    assert len(generator.prompts) == 2
    results = section_from(generator.prompts[1], "TOOL_RESULTS=")
    assert len(results) == 1


def test_an_unknown_tool_is_refused_rather_than_crashing(services):
    request = ToolRequest.model_construct(tool="delete_everything")
    session = services.copilot.toolbox.session("alice", TODAY)

    outcome = session.run(request)

    assert "no tool called" in outcome.payload["error"]


# ---------------------------------------------------------------------------
# The individual tools.
# ---------------------------------------------------------------------------


def test_find_filters_by_type_status_priority_and_due_window(services):
    add_task(services, "a", "Essay", date(2026, 9, 4), priority="high")
    add_task(services, "b", "Reading", date(2026, 9, 4), priority="low")
    add_task(services, "c", "Old", date(2026, 8, 1), priority="high")
    add_task(services, "d", "Done", date(2026, 9, 4), priority="high", completed=True)
    session = services.copilot.toolbox.session("alice", TODAY)

    outcome = session.run(ToolRequest(
        tool=ToolName.find, entity_type=EntityType.task, status="open",
        priority="high", start="2026-09-03", end="2026-09-10",
    ))

    assert [item["title"] for item in outcome.payload["results"]] == ["Essay"]
    assert outcome.payload["count"] == 1


def test_find_matches_text_inside_notes(services):
    add_task(services, "a", "Essay", date(2026, 9, 4), notes="cite the Whitman reading")
    add_task(services, "b", "Reading", date(2026, 9, 4))
    session = services.copilot.toolbox.session("alice", TODAY)

    outcome = session.run(ToolRequest(tool=ToolName.find, query="whitman"))

    assert [item["title"] for item in outcome.payload["results"]] == ["Essay"]


def test_agenda_groups_everything_that_lands_in_the_window_by_day(services):
    add_task(services, "a", "Essay", date(2026, 9, 3))
    add_reminder(services, "r", "Renew pass", date(2026, 9, 3))
    add_schedule(
        services, "s", "Lecture",
        datetime(2026, 9, 4, 9, 0, tzinfo=timezone.utc),
        datetime(2026, 9, 4, 10, 0, tzinfo=timezone.utc),
    )
    add_task(services, "far", "Later", date(2026, 10, 1))
    session = services.copilot.toolbox.session("alice", TODAY)

    outcome = session.run(ToolRequest(tool=ToolName.agenda, start="2026-09-03", end="2026-09-05"))

    assert sorted(outcome.payload["days"]) == ["2026-09-03", "2026-09-04"]
    assert len(outcome.payload["days"]["2026-09-03"]) == 2
    assert outcome.payload["count"] == 3


def test_workload_hands_back_the_records_its_findings_point_at(services):
    # A finding names record IDs, which the model cannot cite. Without the
    # records alongside it, it could report an overload it is not allowed to
    # attribute to anything.
    add_task(services, "a", "Essay", TODAY, estimated_minutes=90)
    add_task(services, "b", "Revision", TODAY, estimated_minutes=90)
    session = services.copilot.toolbox.session("alice", TODAY)

    outcome = session.run(ToolRequest(tool=ToolName.workload))

    assert outcome.payload["count"] >= 1
    assert {item["title"] for item in outcome.payload["records"]} == {"Essay", "Revision"}
    assert all(item["citation_id"] for item in outcome.payload["records"])


def test_open_day_skips_days_that_are_already_full(services):
    add_task(services, "a", "Essay", date(2026, 9, 3), estimated_minutes=120)
    session = services.copilot.toolbox.session("alice", TODAY)

    outcome = session.run(ToolRequest(tool=ToolName.open_day, start="2026-09-02", minutes=60))

    # The fixture's capacity is 120 minutes a day, so the 3rd is full.
    assert outcome.payload["next_available_day"] == "2026-09-04"


def test_a_date_the_model_wrote_as_prose_does_not_become_a_server_error(services):
    add_task(services, "a", "Essay", date(2026, 9, 3))
    session = services.copilot.toolbox.session("alice", TODAY)

    outcome = session.run(ToolRequest(tool=ToolName.agenda, start="next Friday", end="soon"))

    assert outcome.payload["start"] == TODAY.isoformat()


def test_one_record_keeps_one_citation_id_across_tools(services):
    # Seen in the briefing and again in a search, a task must not arrive twice
    # under two IDs; the answer would read as though there were two of them.
    add_task(services, "now", "Chemistry revision", TODAY)
    session = services.copilot.toolbox.session("alice", TODAY)

    briefing = session.briefing()
    found = session.run(ToolRequest(tool=ToolName.find, query="chemistry"))

    assert briefing["due_today"][0]["citation_id"] == found.payload["results"][0]["citation_id"]
    assert len(session.evidence.citations) == 1


def test_a_lookup_is_recorded_in_the_privacy_audit(services):
    add_task(services, "now", "Chemistry revision", TODAY)
    session = services.copilot.toolbox.session("alice", TODAY)

    session.run(ToolRequest(tool=ToolName.workload))

    assert any(
        event.event_type == "tool_call" and event.metadata["tool"] == "workload"
        for event in services.test_sink.events
    )


# ---------------------------------------------------------------------------
# What it is allowed to say.
# ---------------------------------------------------------------------------


def test_a_question_back_survives_the_citation_guard(services):
    # The bug this fixes: "create a task for tomorrow" has no title, so the
    # assistant asked what to call it, and the guard replaced the question with
    # an abstention. The student was left with no way to answer it.
    record = add_task(services, "now", "Chemistry revision", TODAY)
    services.indexing.index("alice", EntityType.task, record.record_id, record.revision)
    use(services, GeneratedAnswer(
        answer="Sure. What should I call it?", needs_clarification=True,
    ))

    answer, _, disclosure, _ = services.copilot.answer(
        "alice", "create a new task for tomorrow", today=TODAY
    )

    assert answer == "Sure. What should I call it?"
    assert not disclosure.abstained


def test_an_ungrounded_claim_is_still_replaced(services):
    # The clarification exemption must not become a way around the guard: a
    # statement about their records with nothing to back it still goes.
    record = add_task(services, "now", "Chemistry revision", TODAY)
    services.indexing.index("alice", EntityType.task, record.record_id, record.revision)
    use(services, GeneratedAnswer(answer="You have nine tasks due tomorrow."))

    answer, citations, disclosure, _ = services.copilot.answer(
        "alice", "chemistry", today=TODAY
    )

    assert disclosure.abstained
    assert citations == []
    assert "source-valid" in answer


def test_the_briefing_alone_does_not_turn_a_general_question_into_a_refusal(services):
    # The briefing is volunteered rather than asked for, so its presence must
    # not make "how should I study" look like an unsupported claim.
    add_task(services, "now", "Chemistry revision", date(2026, 12, 1))
    use(services, GeneratedAnswer(answer="Work in short blocks with breaks."))

    answer, _, disclosure, _ = services.copilot.answer(
        "alice", "how should I study for exams?", today=TODAY
    )

    assert not disclosure.abstained
    assert answer == "Work in short blocks with breaks."


def test_several_changes_become_several_previews(services, client, auth):
    add_task(services, "late1", "Lab report", date(2026, 8, 20))
    add_task(services, "late2", "Essay draft", date(2026, 8, 25))
    use(services, GeneratedAnswer(
        answer="I'll move both to Friday once you confirm.",
        actions=[
            GeneratedAction(
                operation=ProposalOperation.reschedule, entity_type=EntityType.task,
                record_id="late1", due_date="2026-09-04",
            ),
            GeneratedAction(
                operation=ProposalOperation.reschedule, entity_type=EntityType.task,
                record_id="late2", due_date="2026-09-04",
            ),
        ],
    ))

    body = client.post("/v1/copilot/chat", headers=auth, json={
        "message": "push my overdue work to Friday", "request_id": "multi-0001",
    }).json()

    assert len(body["proposals"]) == 2
    assert {proposal["record_id"] for proposal in body["proposals"]} == {"late1", "late2"}
    assert all(proposal["after"]["due_date"] == "2026-09-04" for proposal in body["proposals"])


def test_the_singular_action_field_is_still_honoured(services):
    generated = GeneratedAnswer(action=GeneratedAction(
        operation=ProposalOperation.create, entity_type=EntityType.task, title="One",
    ))
    assert len(generated.all_actions()) == 1


def test_a_change_repeated_in_both_fields_is_only_proposed_once(services):
    action = GeneratedAction(
        operation=ProposalOperation.create, entity_type=EntityType.task, title="One",
    )
    generated = GeneratedAnswer(actions=[action], action=action)
    assert len(generated.all_actions()) == 1


def test_the_same_change_written_twice_slightly_differently_is_still_one(services):
    # Muse fills both fields on every proposing reply, and a live probe run had
    # them differ only in `body`. Matched on exact equality that became two
    # preview cards for one task.
    generated = GeneratedAnswer(
        actions=[GeneratedAction(
            operation=ProposalOperation.reschedule, entity_type=EntityType.task,
            record_id="a", due_date="2026-09-04",
        )],
        action=GeneratedAction(
            operation=ProposalOperation.reschedule, entity_type=EntityType.task,
            record_id="a", due_date="2026-09-04", title="Lab report",
            body="You're behind on one task. I'll move it to Friday.",
        ),
    )

    merged = generated.all_actions()

    assert len(merged) == 1
    # The plural field wins, so the narration the model put in `body` does not
    # ride along into the record.
    assert merged[0].body is None


def test_two_genuinely_different_changes_both_survive(services):
    generated = GeneratedAnswer(actions=[
        GeneratedAction(
            operation=ProposalOperation.reschedule, entity_type=EntityType.task,
            record_id="a", due_date="2026-09-04",
        ),
        GeneratedAction(
            operation=ProposalOperation.reschedule, entity_type=EntityType.task,
            record_id="b", due_date="2026-09-04",
        ),
    ])
    assert len(generated.all_actions()) == 2


def test_changes_that_cannot_be_prepared_are_counted_not_hidden(services, client, auth):
    use(services, GeneratedAnswer(
        answer="Setting those up now.",
        actions=[
            GeneratedAction(
                operation=ProposalOperation.create, entity_type=EntityType.reminder,
                title="Email advisor",
            ),
            GeneratedAction(
                operation=ProposalOperation.create, entity_type=EntityType.reminder,
                title="Call the library",
            ),
        ],
    ))

    body = client.post("/v1/copilot/chat", headers=auth, json={
        "message": "remind me about two things", "request_id": "unprepared-01",
    }).json()

    assert body["proposals"] == []
    assert "2 of those changes could not be prepared" in body["answer"]


def test_a_step_reaches_the_client_as_its_own_event(services, client, auth):
    add_task(services, "now", "Chemistry revision", TODAY)
    services.copilot.generator = ScriptedStreamingGenerator(
        GeneratedAnswer(tool_requests=[ToolRequest(tool=ToolName.workload)]),
        GeneratedAnswer(answer="Nothing is overloaded."),
    )

    with client.stream("POST", "/v1/copilot/chat/stream", headers=auth, json={
        "message": "am I overloaded?", "request_id": "stream-step-01",
    }) as response:
        body = "".join(response.iter_text())

    assert "event: step" in body
    assert '"tool": "workload"' in body
    assert "event: final" in body


def test_a_long_narration_cannot_hide_behind_the_clarification_flag(services):
    # The exemption is for questions back. Setting the flag on a page of prose
    # about their records would otherwise walk straight past the guard.
    record = add_task(services, "now", "Chemistry revision", TODAY)
    services.indexing.index("alice", EntityType.task, record.record_id, record.revision)
    use(services, GeneratedAnswer(
        answer="You have nine tasks due tomorrow. " * 30, needs_clarification=True,
    ))

    answer, _, disclosure, _ = services.copilot.answer("alice", "chemistry", today=TODAY)

    assert disclosure.abstained
    assert "source-valid" in answer


def test_a_reply_with_nothing_in_it_says_so_rather_than_showing_an_empty_bubble(services):
    use(services, GeneratedAnswer())

    answer, _, _, _ = services.copilot.answer("alice", "anything", today=TODAY)

    assert "couldn't put that together" in answer


def test_a_change_described_in_silence_still_gets_a_sentence(services, client, auth):
    # The prose doubles as the proposal's rationale, so an empty answer would
    # leave a preview card with nothing above it saying why it is there.
    use(services, GeneratedAnswer(actions=[GeneratedAction(
        operation=ProposalOperation.create, entity_type=EntityType.task,
        title="Draft the essay", due_date="2026-09-04",
    )]))

    body = client.post("/v1/copilot/chat", headers=auth, json={
        "message": "add an essay task for Friday", "request_id": "silent-0001",
    }).json()

    assert "Confirm it and I'll apply it" in body["answer"]
    assert body["proposals"][0]["rationale"] == body["answer"]


def test_a_slow_turn_stops_asking_for_lookups_instead_of_running_out_of_time(services):
    # Rounds are sequential model calls, so the round budget alone bounds the
    # worst case at the model timeout times the number of rounds. Past the
    # deadline the assistant is told it has none left and answers with what it
    # has: a thinner answer beats a request the platform kills.
    generator = use(
        services,
        GeneratedAnswer(tool_requests=[ToolRequest(tool=ToolName.workload)]),
        # Still asking for more, and with an answer ready if refused, which is
        # what the round budget alone would have spent a third generation on.
        GeneratedAnswer(
            answer="Here is what I have.",
            tool_requests=[ToolRequest(tool=ToolName.find, query="essay")],
        ),
        GeneratedAnswer(answer="Reached only when the deadline did not bite."),
    )
    services.copilot.max_tool_rounds = 2
    services.copilot.deadline_seconds = 1
    # Under the deadline for the first round, past it for the second.
    slow = iter([0.0, 0.5, 5.0, 5.1])
    services.copilot._clock = lambda: next(slow)

    answer, _, _, _ = services.copilot.answer("alice", "what should I do?", today=TODAY)

    assert answer == "Here is what I have."
    # Two generations, not three: the second round was refused its lookups.
    assert len(generator.prompts) == 2
    assert "TOOLS_AVAILABLE=true" in generator.prompts[0]
    assert "TOOLS_AVAILABLE=false" in generator.prompts[1]


def test_the_deadline_is_recorded_so_a_thin_answer_can_be_explained(services):
    use(
        services,
        GeneratedAnswer(tool_requests=[ToolRequest(tool=ToolName.workload)]),
        GeneratedAnswer(answer="Here is what I have."),
    )
    services.copilot.deadline_seconds = 1
    slow = iter([0.0, 0.5, 5.0, 5.1])
    services.copilot._clock = lambda: next(slow)

    services.copilot.answer("alice", "anything", today=TODAY)

    assert any(
        event.event_type == "generation" and event.metadata.get("stage") == "deadline"
        for event in services.test_sink.events
    )


def test_the_deadline_can_be_switched_off(services):
    generator = use(
        services,
        GeneratedAnswer(tool_requests=[ToolRequest(tool=ToolName.workload)]),
        GeneratedAnswer(answer="Done looking."),
    )
    services.copilot.deadline_seconds = 0
    services.copilot._clock = lambda: 10_000.0

    services.copilot.answer("alice", "anything", today=TODAY)

    assert len(generator.prompts) == 2


# ---------------------------------------------------------------------------
# What a live Muse Spark actually sends back.
# ---------------------------------------------------------------------------


def test_prose_before_the_json_does_not_lose_the_whole_reply():
    # A strict json_schema response format is not the guarantee it looks like:
    # Muse narrates what it is about to look up and then emits the document.
    # Measured on 6 of 8 tool-calling requests, at every reasoning level.
    from app.ai import GeneratedAnswer, json_document

    narrated = (
        "You've got one finished item on the books, I'll pull your September "
        'completions to confirm.{"answer": "", "citation_ids": [], '
        '"needs_clarification": false, "actions": [], "action": null, '
        '"tool_requests": [{"tool": "find", "status": "completed", '
        '"start": "2026-09-01", "end": "2026-09-30", "entity_type": "task", '
        '"query": null, "priority": null, "minutes": null}]}'
    )

    answer = GeneratedAnswer.model_validate(json_document(narrated))

    assert [request.tool.value for request in answer.tool_requests] == ["find"]
    assert answer.tool_requests[0].status == "completed"


def test_a_well_behaved_reply_is_still_parsed_as_it_stands():
    from app.ai import json_document

    assert json_document('{"answer": "Two things today."}') == {"answer": "Two things today."}


def test_a_reply_with_no_json_at_all_is_an_error_not_a_silent_empty():
    from app.ai import json_document

    with pytest.raises(RuntimeError):
        json_document("I am not going to answer that.")


def test_citation_markers_are_taken_out_of_the_prose(services):
    # The client renders the sources as their own linked list underneath, so
    # "[S2]" inline is duplication that reads like a database row.
    record = add_task(services, "now", "Chemistry revision", TODAY)
    services.indexing.index("alice", EntityType.task, record.record_id, record.revision)
    use(services, GeneratedAnswer(
        answer="Chemistry revision is due today at 6 PM [S1].", citation_ids=["S1"],
    ))

    answer, citations, _, _ = services.copilot.answer("alice", "today", today=TODAY)

    assert answer == "Chemistry revision is due today at 6 PM."
    assert [citation.citation_id for citation in citations] == ["S1"]


def test_an_answer_that_only_cited_inline_still_counts_as_grounded(services):
    # Otherwise the guard strikes out a perfectly well-sourced answer because
    # the model wrote its IDs in the prose instead of the list.
    record = add_task(services, "now", "Chemistry revision", TODAY)
    services.indexing.index("alice", EntityType.task, record.record_id, record.revision)
    use(services, GeneratedAnswer(answer="Chemistry revision is due today [S1].", citation_ids=[]))

    answer, citations, disclosure, _ = services.copilot.answer("alice", "today", today=TODAY)

    assert not disclosure.abstained
    assert [citation.citation_id for citation in citations] == ["S1"]
    assert "[S1]" not in answer


def test_a_bracket_that_was_never_issued_is_left_alone(services):
    # It may be the student's own wording quoted back, and inventing a citation
    # out of it would be worse than leaving the text as written.
    use(services, GeneratedAnswer(answer="Call the module [S404] on the handout."))

    answer, _, _, _ = services.copilot.answer("alice", "anything", today=TODAY)

    assert answer == "Call the module [S404] on the handout."


def test_a_question_back_does_not_also_carry_a_change(services):
    # A live run answered "what should I call it?" and attached a create with
    # no title, which cannot become a proposal, so the student would have read
    # the question followed by an apology for a change they never asked for.
    use(services, GeneratedAnswer(
        answer="What should I call it?", needs_clarification=True,
        action=GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.task,
        ),
    ))

    answer, _, _, generated = services.copilot.answer(
        "alice", "add a task for tomorrow", today=TODAY,
    )

    assert answer == "What should I call it?"
    assert generated.all_actions() == []


def test_a_half_finished_lookup_does_not_leave_a_placeholder_change_behind(services):
    # Out of rounds while still asking for lookups, it never finished deciding.
    # A live probe reply carried a create-task literally titled "placeholder".
    use(services, GeneratedAnswer(
        answer="Here is what I have.",
        tool_requests=[ToolRequest(tool=ToolName.find, query="anything")],
        action=GeneratedAction(
            operation=ProposalOperation.create, entity_type=EntityType.task,
            title="placeholder",
        ),
    ))
    services.copilot.max_tool_rounds = 0

    _, _, _, generated = services.copilot.answer("alice", "anything", today=TODAY)

    assert generated.all_actions() == []
