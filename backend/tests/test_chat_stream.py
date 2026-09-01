from __future__ import annotations

import json

import pytest
from conftest import task_request

from app.ai import GeneratedAction, GeneratedAnswer
from app.models import EntityType, ProposalOperation


class StreamingGenerator:
    """A generator that streams, standing in for Muse in the fast path."""

    provider = "fake-stream"
    trains_on_prompts = False
    model = "fake-stream-model"

    def __init__(self, response: GeneratedAnswer, chunks=None, fail_after=None):
        self.response = response
        self.chunks = chunks
        self.fail_after = fail_after
        self.prompts = []
        self.blocking_calls = 0

    def generate(self, prompt: str) -> GeneratedAnswer:
        self.blocking_calls += 1
        self.prompts.append(prompt)
        return self.response

    def generate_stream(self, prompt: str):
        self.prompts.append(prompt)
        pieces = self.chunks if self.chunks is not None else [self.response.answer]
        for index, piece in enumerate(pieces):
            if self.fail_after is not None and index == self.fail_after:
                raise RuntimeError("stream died")
            yield piece
        if self.fail_after == len(pieces):
            raise RuntimeError("stream died")
        yield self.response


def read_events(response):
    """Parse an SSE body into [(event, payload), ...]."""
    events = []
    for block in response.text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        name = None
        data = None
        for line in block.split("\n"):
            if line.startswith("event:"):
                name = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data = json.loads(line[len("data:"):].strip())
        events.append((name, data))
    return events


def deltas(events):
    return "".join(payload["text"] for name, payload in events if name == "delta")


def final_of(events):
    finals = [payload for name, payload in events if name == "final"]
    assert len(finals) == 1, f"expected exactly one final event, got {len(finals)}"
    return finals[0]


def indexed_task(client, auth):
    client.put("/v1/records/task/t1", json=task_request(approved=True), headers=auth)
    client.post(
        "/v1/index/task/t1", json={"approved": True, "expected_revision": 1}, headers=auth
    )


def test_answer_arrives_as_deltas_then_a_final_event(client, services, auth):
    indexed_task(client, auth)
    services.copilot.generator = StreamingGenerator(
        GeneratedAnswer(answer="Start with the report. It is due Thursday.", citation_ids=["S1"]),
        chunks=["Start with ", "the report. ", "It is due Thursday."],
    )
    response = client.post("/v1/copilot/chat/stream", headers=auth, json={
        "message": "what first?", "request_id": "stream-0001",
    })
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = read_events(response)
    assert [name for name, _ in events] == ["delta", "delta", "delta", "final"]
    assert deltas(events) == "Start with the report. It is due Thursday."
    final = final_of(events)
    assert final["answer"] == "Start with the report. It is due Thursday."
    assert [c["citation_id"] for c in final["citations"]] == ["S1"]


def test_a_generator_that_cannot_stream_still_answers(client, services, auth):
    # The default fake has no generate_stream at all, which is the same shape as
    # a provider that does not support it: one final event, no deltas.
    indexed_task(client, auth)
    response = client.post("/v1/copilot/chat/stream", headers=auth, json={
        "message": "what first?", "request_id": "stream-0002",
    })
    assert response.status_code == 200
    events = read_events(response)
    assert [name for name, _ in events] == ["final"]
    assert final_of(events)["answer"] == "Grounded answer"


def test_a_stream_that_dies_before_any_text_falls_back_to_a_blocking_call(
    client, services, auth
):
    indexed_task(client, auth)
    generator = StreamingGenerator(
        GeneratedAnswer(answer="Recovered answer.", citation_ids=["S1"]),
        chunks=["never sent"], fail_after=0,
    )
    services.copilot.generator = generator
    response = client.post("/v1/copilot/chat/stream", headers=auth, json={
        "message": "what first?", "request_id": "stream-0003",
    })
    assert response.status_code == 200
    events = read_events(response)
    assert deltas(events) == ""
    assert final_of(events)["answer"] == "Recovered answer."
    assert generator.blocking_calls == 1


def test_a_stream_that_dies_after_text_reports_an_error_rather_than_contradicting_itself(
    client, services, auth
):
    # Regenerating here would replace prose the student is already reading.
    indexed_task(client, auth)
    generator = StreamingGenerator(
        GeneratedAnswer(answer="unused", citation_ids=["S1"]),
        chunks=["Start with the "], fail_after=1,
    )
    services.copilot.generator = generator
    response = client.post("/v1/copilot/chat/stream", headers=auth, json={
        "message": "what first?", "request_id": "stream-0004",
    })
    assert response.status_code == 200
    events = read_events(response)
    assert deltas(events) == "Start with the "
    assert [name for name, _ in events] == ["delta", "error"]
    assert events[-1][1]["code"] == "generation_failed"
    assert generator.blocking_calls == 0


def test_the_final_answer_overrides_streamed_text_when_the_citation_guard_trips(
    client, services, auth
):
    # The guard can only run once the whole document is parsed, by which point
    # the ungrounded text has already gone out. The client is told to render the
    # final answer, so this asserts the final event actually carries the
    # replacement rather than the streamed prose.
    indexed_task(client, auth)
    services.copilot.generator = StreamingGenerator(
        GeneratedAnswer(answer="You have four tasks due tomorrow.", citation_ids=["S9"]),
        chunks=["You have four ", "tasks due tomorrow."],
    )
    response = client.post("/v1/copilot/chat/stream", headers=auth, json={
        "message": "what is due?", "request_id": "stream-0005",
    })
    events = read_events(response)
    assert deltas(events) == "You have four tasks due tomorrow."
    final = final_of(events)
    assert final["answer"] != "You have four tasks due tomorrow."
    assert "source-valid" in final["answer"]
    assert final["citations"] == []
    assert final["retrieval"]["abstained"] is True


def test_a_proposal_is_built_and_carried_on_the_final_event(client, services, auth):
    indexed_task(client, auth)
    services.copilot.generator = StreamingGenerator(
        GeneratedAnswer(
            answer="I'll mark the report done once you confirm.", citation_ids=["S1"],
            action=GeneratedAction(
                operation=ProposalOperation.complete, entity_type=EntityType.task,
                record_id="t1",
            ),
        ),
        chunks=["I'll mark the report ", "done once you confirm."],
    )
    response = client.post("/v1/copilot/chat/stream", headers=auth, json={
        "message": "mark the report done", "request_id": "stream-0006",
    })
    final = final_of(read_events(response))
    assert len(final["proposals"]) == 1
    assert final["proposals"][0]["after"]["completed"] is True
    assert final["proposals"][0]["status"] == "pending"


def test_ai_disabled_is_a_403_not_a_stream_carrying_an_error(client, auth):
    # Priming the generator before the body starts is what keeps this a status
    # code; once bytes are flowing the response is already committed to 200.
    client.put("/v1/privacy", json={
        "ai_enabled": False, "indexed_entity_types": [], "index_attachments": False,
        "retain_chat": False, "chat_retention_days": 0,
    }, headers=auth)
    response = client.post("/v1/copilot/chat/stream", headers=auth, json={
        "message": "what first?", "request_id": "stream-0007",
    })
    assert response.status_code == 403


def test_a_retained_answer_is_replayed_without_regenerating(client, services, auth):
    client.put("/v1/privacy", json={
        "ai_enabled": True, "indexed_entity_types": ["task"], "index_attachments": False,
        "retain_chat": True, "chat_retention_days": 7,
    }, headers=auth)
    indexed_task(client, auth)
    body = {"message": "when is it due?", "request_id": "stream-0008"}
    first = final_of(read_events(client.post("/v1/copilot/chat/stream", headers=auth, json=body)))
    second_response = client.post("/v1/copilot/chat/stream", headers=auth, json=body)
    events = read_events(second_response)
    assert [name for name, _ in events] == ["final"]
    assert final_of(events) == first
    assert len(services.test_generator.prompts) == 1


def test_the_rate_limit_applies_to_the_streaming_route(client, services, auth):
    from app.ratelimit import MemoryRateLimiter, RateLimitPolicy

    services.rate_limiter = MemoryRateLimiter(RateLimitPolicy(requests=1, window_seconds=3600))
    body = {"message": "hello", "request_id": "stream-0009"}
    assert client.post("/v1/copilot/chat/stream", headers=auth, json=body).status_code == 200
    second = client.post(
        "/v1/copilot/chat/stream", headers=auth,
        json={"message": "hello again", "request_id": "stream-0010"},
    )
    assert second.status_code == 429


@pytest.mark.parametrize("text", [
    "Quotes \"like this\" and a newline\nplus a tab\there.",
    "An emoji \U0001F600 mid sentence.",
])
def test_awkward_characters_survive_the_round_trip(client, services, auth, text):
    services.copilot.generator = StreamingGenerator(GeneratedAnswer(answer=text))
    response = client.post("/v1/copilot/chat/stream", headers=auth, json={
        "message": "say it", "request_id": f"stream-odd-{len(text)}",
    })
    events = read_events(response)
    assert deltas(events) == text
    assert final_of(events)["answer"] == text
