from __future__ import annotations

import hashlib

import pytest
from fastapi.testclient import TestClient

from app.ai import GeneratedAnswer
from app.api import create_app
from app.audit import AuditLogger, MemoryAuditSink
from app.auth import AuthenticatedUser, get_verifier
from app.mcp_api import McpSessionManager, McpToolService
from app.planner import PlannerEngine
from app.proposals import ProposalService
from app.rag import CopilotService, IndexingService, RetrievalService
from app.ratelimit import MemoryRateLimiter, RateLimitPolicy
from app.repository import MemoryPlannerRepository
from app.runtime import Container
from app.vector_store import MemoryVectorStore


class FakeVerifier:
    def verify(self, token: str) -> AuthenticatedUser:
        if not token.startswith("uid:"):
            from fastapi import HTTPException
            raise HTTPException(status_code=401, detail="bad token")
        return AuthenticatedUser(uid=token[4:])


class FakeEmbeddings:
    dimensions = 8

    def _vector(self, text: str):
        values = [0.0] * self.dimensions
        for token in text.lower().split():
            values[int(hashlib.sha256(token.encode()).hexdigest(), 16) % self.dimensions] += 1.0
        return values

    def embed_document(self, text: str, title: str):
        return self._vector(f"{title} {text}")

    def embed_query(self, text: str):
        return self._vector(text)


class FakeGenerator:
    provider = "fake"
    trains_on_prompts = False
    model = "fake-model"

    def __init__(self):
        self.response = GeneratedAnswer(answer="Grounded answer", citation_ids=["S1"])
        self.prompts = []

    def generate(self, prompt: str):
        self.prompts.append(prompt)
        return self.response


@pytest.fixture
def services():
    repository = MemoryPlannerRepository()
    vectors = MemoryVectorStore()
    sink = MemoryAuditSink()
    audit = AuditLogger(sink, b"test-audit-salt")
    embeddings = FakeEmbeddings()
    generator = FakeGenerator()
    planner = PlannerEngine(max_daily_minutes=120)
    retrieval = RetrievalService(repository, vectors, embeddings, audit, limit=5)
    indexing = IndexingService(repository, vectors, embeddings, audit)
    proposals = ProposalService(repository, audit)
    copilot = CopilotService(retrieval, generator, planner, repository, audit)
    # Generous by default so unrelated tests never trip the limiter; the
    # rate-limit tests build their own with a tight policy.
    rate_limiter = MemoryRateLimiter(RateLimitPolicy(requests=1000, window_seconds=3600))
    container = Container(
        repository=repository, vector_store=vectors, indexing=indexing,
        retrieval=retrieval, copilot=copilot, proposals=proposals, planner=planner,
        audit=audit, mcp_sessions=McpSessionManager(b"s" * 32),
        mcp_tools=McpToolService(repository, retrieval, planner, audit),
        rate_limiter=rate_limiter,
    )
    container.test_sink = sink
    container.test_generator = generator
    return container


@pytest.fixture
def client(services):
    app = create_app(services)
    app.dependency_overrides[get_verifier] = lambda: FakeVerifier()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth():
    return {"Authorization": "Bearer uid:alice"}


def task_request(title="Write report", expected_revision=None, key="request-0001", approved=False):
    return {
        "content": {
            "entity_type": "task", "title": title, "due_date": "2026-08-20",
            "priority": "medium", "category": "Homework", "notes": "Use sources",
            "completed": False, "estimated_minutes": 60,
        },
        "expected_revision": expected_revision,
        "idempotency_key": key,
        "approved_for_ai": approved,
    }

