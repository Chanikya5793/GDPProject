from __future__ import annotations

import hashlib
from dataclasses import dataclass

from google.cloud import firestore

from .ai import GeminiAnswerGenerator, VertexEmbeddingClient
from .audit import AuditLogger, AuditSink
from .config import Settings
from .crypto import EnvelopeCipher, FirestoreKeyStore, GoogleKmsKeyWrapper
from .mcp_api import McpSessionManager, McpToolService
from .planner import PlannerEngine
from .proposals import ProposalService
from .rag import CopilotService, IndexingService, RetrievalService
from .ratelimit import FirestoreRateLimiter, RateLimiter, RateLimitPolicy
from .repository import FirestorePlannerRepository, PlannerRepository
from .secrets import SecretResolver
from .vector_store import FirestoreVectorStore, VectorStore


class FirestoreAuditSink(AuditSink):
    def __init__(self, client: firestore.Client):
        self.collection = client.collection("privacy_audit")

    def append(self, event) -> None:
        # No prompts, record text, email addresses, or raw UIDs are logged.
        self.collection.document(event.event_id).create(event.model_dump(mode="json"))


@dataclass
class Container:
    repository: PlannerRepository
    vector_store: VectorStore
    indexing: IndexingService
    retrieval: RetrievalService
    copilot: CopilotService
    proposals: ProposalService
    planner: PlannerEngine
    audit: AuditLogger
    mcp_sessions: McpSessionManager
    mcp_tools: McpToolService
    rate_limiter: RateLimiter


def build_production_container(settings: Settings) -> Container:
    client = firestore.Client(project=settings.google_cloud_project, database=settings.firestore_database)
    cipher = EnvelopeCipher(
        FirestoreKeyStore(client), GoogleKmsKeyWrapper(settings.kms_key_name)
    )
    repository = FirestorePlannerRepository(client, cipher)
    vector_store = FirestoreVectorStore(client)
    embeddings = VertexEmbeddingClient(
        settings.google_cloud_project, settings.google_cloud_location,
        settings.embedding_model, settings.embedding_dimensions,
    )
    generator = GeminiAnswerGenerator(
        settings.google_cloud_project, settings.google_cloud_location, settings.gemini_model
    )
    secret = SecretResolver().access(settings.mcp_session_secret_resource)
    audit = AuditLogger(FirestoreAuditSink(client), hashlib.sha256(secret + b":audit").digest())
    planner = PlannerEngine()
    retrieval = RetrievalService(repository, vector_store, embeddings, audit, settings.retrieval_limit)
    indexing = IndexingService(repository, vector_store, embeddings, audit)
    proposals = ProposalService(repository, audit)
    copilot = CopilotService(retrieval, generator, planner, repository, audit)
    rate_limiter = FirestoreRateLimiter(
        client,
        RateLimitPolicy(
            settings.chat_rate_limit_requests, settings.chat_rate_limit_window_seconds
        ),
    )
    return Container(
        repository=repository, vector_store=vector_store, indexing=indexing,
        retrieval=retrieval, copilot=copilot, proposals=proposals, planner=planner,
        audit=audit, mcp_sessions=McpSessionManager(secret),
        mcp_tools=McpToolService(repository, retrieval, planner, audit),
        rate_limiter=rate_limiter,
    )

