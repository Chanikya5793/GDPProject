from types import SimpleNamespace

from app.config import Settings
from app.models import AuditEvent
from app.runtime import FirestoreAuditSink, build_production_container


class AuditDocument:
    def __init__(self, events):
        self.events = events

    def create(self, value):
        self.events.append(value)


class AuditCollection:
    def __init__(self):
        self.events = []

    def document(self, _event_id):
        return AuditDocument(self.events)


class FakeFirestore:
    def __init__(self):
        self.audit_collection = AuditCollection()

    def collection(self, name):
        assert name == "privacy_audit"
        return self.audit_collection


def test_firestore_audit_sink_serializes_privacy_safe_event():
    client = FakeFirestore()
    sink = FirestoreAuditSink(client)
    event = AuditEvent(
        event_id="audit-1", uid_hash="hashed-user", event_type="retrieval",
        outcome="success", occurred_at="2026-08-13T00:00:00Z", metadata={"result_count": 1},
    )
    sink.append(event)
    assert client.audit_collection.events[0]["uid_hash"] == "hashed-user"


def test_production_container_wires_cloud_adapters(monkeypatch):
    marker = SimpleNamespace()
    monkeypatch.setattr("app.runtime.firestore.Client", lambda **_kwargs: marker)
    for name in (
        "FirestoreKeyStore", "GoogleKmsKeyWrapper", "EnvelopeCipher",
        "FirestorePlannerRepository", "FirestoreVectorStore", "VertexEmbeddingClient",
        "GeminiAnswerGenerator", "FirestoreAuditSink", "AuditLogger", "PlannerEngine",
        "RetrievalService", "IndexingService", "ProposalService", "CopilotService",
        "McpSessionManager", "McpToolService",
    ):
        monkeypatch.setattr(f"app.runtime.{name}", lambda *_args, **_kwargs: marker)
    monkeypatch.setattr(
        "app.runtime.SecretResolver", lambda: SimpleNamespace(access=lambda _name: b"s" * 32)
    )
    settings = Settings(
        google_cloud_project="gdp", firebase_project_id="gdp",
        kms_key_name="projects/gdp/locations/us/keyRings/planner/cryptoKeys/user-data",
        mcp_session_secret_resource="projects/gdp/secrets/mcp/versions/1",
    )
    container = build_production_container(settings)
    assert container.repository is marker
    assert container.vector_store is marker
    assert container.copilot is marker
    assert container.mcp_tools is marker
