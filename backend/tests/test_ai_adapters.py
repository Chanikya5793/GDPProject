import json
from types import SimpleNamespace

from app.ai import GeminiAnswerGenerator, VertexEmbeddingClient


class FakeModels:
    def __init__(self):
        self.embedding_calls = []
        self.generation_calls = []

    def embed_content(self, **kwargs):
        self.embedding_calls.append(kwargs)
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[0.25, 0.75])])

    def generate_content(self, **kwargs):
        self.generation_calls.append(kwargs)
        return SimpleNamespace(text=json.dumps({
            "answer": "Grounded answer", "citation_ids": ["S1"], "action": None,
        }))


class FakeClient:
    def __init__(self):
        self.models = FakeModels()


def test_vertex_embedding_adapter_uses_retrieval_task_types(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr("app.ai.genai.Client", lambda **_kwargs: fake)
    adapter = VertexEmbeddingClient("project", "global", "gemini-embedding-001", 768)
    assert adapter.embed_document("planner text", "Planner title") == [0.25, 0.75]
    assert adapter.embed_query("planner query") == [0.25, 0.75]
    document_config = fake.models.embedding_calls[0]["config"]
    query_config = fake.models.embedding_calls[1]["config"]
    assert document_config.task_type == "RETRIEVAL_DOCUMENT"
    assert document_config.output_dimensionality == 768
    assert document_config.title == "Planner title"
    assert query_config.task_type == "RETRIEVAL_QUERY"


def test_gemini_adapter_requests_strict_structured_grounded_output(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr("app.ai.genai.Client", lambda **_kwargs: fake)
    generated = GeminiAnswerGenerator("project", "global", "gemini-2.5-flash").generate("prompt")
    assert generated.answer == "Grounded answer"
    assert generated.citation_ids == ["S1"]
    call = fake.models.generation_calls[0]
    assert call["model"] == "gemini-2.5-flash"
    assert call["contents"] == "prompt"
    assert call["config"].response_mime_type == "application/json"
    assert "untrusted" in call["config"].system_instruction.lower()
