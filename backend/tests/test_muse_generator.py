from __future__ import annotations

import json

import httpx
import pytest

from app.ai import GeminiAnswerGenerator, MuseAnswerGenerator
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
        assert generator.model == "muse-spark-1.2-contributor"
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
