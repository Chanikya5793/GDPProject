from app.local_embeddings import DIMENSIONS, LocalEmbeddingClient
from app.vector_store import INDEX_VERSION, FirestoreVectorStore


def test_local_vectors_are_deterministic_and_match_record_words():
    client = LocalEmbeddingClient()
    document = client.embed_document("Study chemistry for Friday", "Chemistry revision")
    query = client.embed_query("chemistry revision")
    unrelated = client.embed_query("pay rent")

    assert len(document) == DIMENSIONS
    assert document == client.embed_document("Study chemistry for Friday", "Chemistry revision")
    assert sum(a * b for a, b in zip(document, query)) > 0
    assert sum(a * b for a, b in zip(document, unrelated)) == 0


def test_stopword_only_query_has_no_search_vector():
    assert not any(LocalEmbeddingClient().embed_query("What is on my?"))


def test_firestore_search_requires_uid_and_local_index_version():
    class Query:
        def __init__(self):
            self.filters = []

        def where(self, field, operator, value):
            self.filters.append((field, operator, value))
            return self

        def find_nearest(self, **_kwargs):
            return self

        def stream(self):
            return []

    class Client:
        query = Query()

        def collection(self, _name):
            return self.query

    client = Client()
    FirestoreVectorStore(client).search("alice", [1.0] * DIMENSIONS, 5)
    assert client.query.filters == [
        ("uid", "==", "alice"), ("index_version", "==", INDEX_VERSION),
    ]
