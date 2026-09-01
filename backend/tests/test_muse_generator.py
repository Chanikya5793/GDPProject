from __future__ import annotations

import json

import httpx
import pytest

from app.ai import (
    GeminiAnswerGenerator,
    GenerationTimeout,
    MuseAnswerGenerator,
    strict_json_schema,
)
from app.config import Settings
from app.runtime import build_answer_generator

ANSWER = {"answer": "Your report is due Thursday.", "citation_ids": ["S1"]}


class FakeSecrets:
    """Stands in for SecretResolver; records what resource was asked for."""

    def __init__(self, value: bytes = b"muse-test-key\n"):
        self.value = value
        self.requested: list[str] = []

    def access(self, resource_name: str) -> bytes:
        self.requested.append(resource_name)
        return self.value


def muse(handler, model="muse-spark-1.2-contributor", **kwargs):
    transport = httpx.MockTransport(handler)
    return MuseAnswerGenerator(
        api_key="test-key", model=model, client=httpx.Client(transport=transport), **kwargs
    )


def ok(payload=None):
    body = {"choices": [{"message": {"content": json.dumps(payload or ANSWER)}}]}
    return lambda request: httpx.Response(200, json=body)


class TestRequestShape:
    def test_posts_chat_completions_with_bearer_auth_and_model(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["auth"] = request.headers.get("Authorization")
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ANSWER)}}]})

        result = muse(handler).generate("USER_QUESTION=\"when is my report due\"")

        assert result.answer == ANSWER["answer"]
        assert seen["url"] == "https://api.meta.ai/v1/chat/completions"
        assert seen["auth"] == "Bearer test-key"
        assert seen["body"]["model"] == "muse-spark-1.2-contributor"

    def test_requests_schema_constrained_json(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ANSWER)}}]})

        muse(handler).generate("prompt")

        fmt = seen["body"]["response_format"]
        assert fmt["type"] == "json_schema"
        assert fmt["json_schema"]["name"] == "GeneratedAnswer"
        # The schema must forbid extra keys, otherwise strict validation is meaningless.
        assert fmt["json_schema"]["schema"]["additionalProperties"] is False

    def test_every_property_is_listed_as_required(self):
        # Meta refuses a schema whose `required` omits any key in `properties`
        # ("Missing 'citation_ids'"), and pydantic omits every field that has a
        # default. Without this the copilot gets HTTP 400 on every question.
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ANSWER)}}]})

        muse(handler).generate("prompt")

        schema = seen["body"]["response_format"]["json_schema"]["schema"]
        assert set(schema["required"]) == set(schema["properties"])
        assert "citation_ids" in schema["required"]
        assert "action" in schema["required"]

    def test_nested_definitions_are_required_too(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ANSWER)}}]})

        muse(handler).generate("prompt")

        # GeneratedAction is reached through $defs; strict mode checks it as well.
        defs = seen["body"]["response_format"]["json_schema"]["schema"].get("$defs", {})
        for name, definition in defs.items():
            if definition.get("type") == "object" and "properties" in definition:
                assert set(definition["required"]) == set(definition["properties"]), name


class TestStrictJsonSchema:
    def test_adds_missing_properties_to_required(self):
        fixed = strict_json_schema({
            "type": "object",
            "properties": {"a": {"type": "string"}, "b": {"type": "string"}},
            "required": ["a"],
        })
        assert fixed["required"] == ["a", "b"]

    def test_leaves_a_complete_required_list_alone(self):
        fixed = strict_json_schema({
            "type": "object",
            "properties": {"a": {"type": "string"}},
            "required": ["a"],
        })
        assert fixed["required"] == ["a"]

    def test_adds_required_when_it_is_absent_entirely(self):
        fixed = strict_json_schema({"type": "object", "properties": {"a": {"type": "string"}}})
        assert fixed["required"] == ["a"]

    def test_recurses_into_nested_objects_and_lists(self):
        fixed = strict_json_schema({
            "type": "object",
            "properties": {
                "outer": {
                    "type": "object",
                    "properties": {"x": {"type": "string"}, "y": {"type": "string"}},
                    "required": ["x"],
                },
            },
            "anyOf": [
                {"type": "object", "properties": {"z": {"type": "string"}}},
            ],
        })
        assert fixed["properties"]["outer"]["required"] == ["x", "y"]
        assert fixed["anyOf"][0]["required"] == ["z"]

    def test_ignores_objects_without_properties(self):
        # A bare {"type": "object"} is a legal free-form value; inventing an
        # empty required list for it would change its meaning.
        assert strict_json_schema({"type": "object"}) == {"type": "object"}

    def test_leaves_non_object_nodes_untouched(self):
        assert strict_json_schema({"type": "string", "maxLength": 10}) == {
            "type": "string", "maxLength": 10,
        }
        assert strict_json_schema("plain") == "plain"

    def test_does_not_mutate_the_input(self):
        original = {"type": "object", "properties": {"a": {}, "b": {}}, "required": ["a"]}
        strict_json_schema(original)
        assert original["required"] == ["a"]

    def test_sends_the_prompt_as_user_content_under_a_system_instruction(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["messages"] = json.loads(request.content)["messages"]
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ANSWER)}}]})

        muse(handler).generate("PROMPT-BODY")

        roles = [m["role"] for m in seen["messages"]]
        assert roles == ["system", "user"]
        assert seen["messages"][1]["content"] == "PROMPT-BODY"
        assert "untrusted data" in seen["messages"][0]["content"]

    def test_honours_a_custom_base_url(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ANSWER)}}]})

        muse(handler, base_url="https://proxy.example/v1/").generate("prompt")
        assert seen["url"] == "https://proxy.example/v1/chat/completions"


class TestFailureHandling:
    def test_http_error_does_not_echo_the_response_body(self):
        # The body quotes the prompt back, and the prompt carries planner records.
        secret = "PRIVATE-PLANNER-NOTE"
        handler = lambda request: httpx.Response(400, json={"error": {"message": secret}})  # noqa: E731

        with pytest.raises(RuntimeError) as excinfo:
            muse(handler).generate("prompt")

        assert secret not in str(excinfo.value)
        assert "400" in str(excinfo.value)

    def test_missing_choices_raises(self):
        handler = lambda request: httpx.Response(200, json={"choices": []})  # noqa: E731
        with pytest.raises(RuntimeError):
            muse(handler).generate("prompt")

    def test_empty_content_raises(self):
        handler = lambda request: httpx.Response(  # noqa: E731
            200, json={"choices": [{"message": {"content": ""}}]}
        )
        with pytest.raises(RuntimeError):
            muse(handler).generate("prompt")

    def test_an_api_key_is_required(self):
        with pytest.raises(ValueError):
            MuseAnswerGenerator(api_key="", model="muse-spark-1.2")


class TestTierDisclosure:
    def test_contributor_model_reports_that_prompts_train_the_model(self):
        assert muse(ok(), model="muse-spark-1.2-contributor").trains_on_prompts is True

    def test_standard_model_reports_that_prompts_do_not_train_the_model(self):
        assert muse(ok(), model="muse-spark-1.2").trains_on_prompts is False

    def test_vertex_never_trains_on_prompts(self):
        assert GeminiAnswerGenerator.trains_on_prompts is False
        assert GeminiAnswerGenerator.provider == "vertex"


def settings(**overrides):
    base = dict(
        google_cloud_project="p", firebase_project_id="f",
        kms_key_name="projects/p/locations/us/keyRings/r/cryptoKeys/k",
        mcp_session_secret_resource="projects/p/secrets/mcp/versions/1",
    )
    return Settings(**{**base, **overrides})


class TestProviderSelection:
    def test_defaults_to_vertex(self):
        assert settings().answer_provider == "vertex"

    def test_muse_provider_requires_a_key_resource_at_startup(self):
        # Better to fail on boot than on the first user question.
        with pytest.raises(ValueError):
            settings(answer_provider="muse")

    def test_builds_a_muse_generator_from_the_secret_resource(self):
        resource = "projects/p/secrets/muse/versions/3"
        secrets = FakeSecrets()
        generator = build_answer_generator(
            settings(answer_provider="muse", muse_api_key_resource=resource), secrets
        )

        assert isinstance(generator, MuseAnswerGenerator)
        assert generator.provider == "muse"
        # The default tier, which Meta actually serves. -contributor was withdrawn
        # and answers model_not_found, which took the whole assistant down.
        assert generator.model == "muse-spark-1.2"
        # The key comes from Secret Manager, never from the environment.
        assert secrets.requested == [resource]

    def test_key_whitespace_is_stripped_before_it_reaches_the_auth_header(self):
        seen = {}
        secrets = FakeSecrets(b"  padded-key\n")
        generator = build_answer_generator(
            settings(
                answer_provider="muse",
                muse_api_key_resource="projects/p/secrets/muse/versions/1",
            ),
            secrets,
        )

        def handler(request: httpx.Request) -> httpx.Response:
            seen["auth"] = request.headers.get("Authorization")
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ANSWER)}}]})

        generator.client = httpx.Client(transport=httpx.MockTransport(handler))
        generator.generate("prompt")
        assert seen["auth"] == "Bearer padded-key"


class TestTimeout:
    def test_a_slow_model_raises_a_named_timeout(self):
        # Surfaced as its own type so the endpoint can answer 504 with something
        # a student can act on, rather than a bare 500.
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("too slow", request=request)

        with pytest.raises(GenerationTimeout):
            muse(handler).generate("prompt")

    def test_other_transport_errors_are_not_mistaken_for_a_timeout(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        with pytest.raises(httpx.ConnectError):
            muse(handler).generate("prompt")


class TestReasoningEffort:
    def test_the_request_asks_for_reduced_reasoning(self):
        # Most of the wait was hidden reasoning: 475 tokens on a trivial prompt at
        # the default, and 6 to 11 seconds on a planner question.
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ANSWER)}}]})

        muse(handler).generate("prompt")
        assert seen["body"]["reasoning_effort"] == "low"

    def test_the_level_is_configurable(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ANSWER)}}]})

        muse(handler, reasoning_effort="high").generate("prompt")
        assert seen["body"]["reasoning_effort"] == "high"
