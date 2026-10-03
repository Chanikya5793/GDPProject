"""Replace legacy hosted embeddings with locally generated lexical vectors.

Run after creating the versioned Firestore vector index. This uses Application
Default Credentials and must be invoked explicitly with --apply.
"""

from __future__ import annotations

import argparse

from google.cloud import firestore

from app.crypto import EnvelopeCipher, FirestoreKeyStore, GoogleKmsKeyWrapper
from app.local_embeddings import LocalEmbeddingClient
from app.models import EntityType
from app.repository import FirestorePlannerRepository
from app.tools import record_text
from app.vector_store import INDEX_VERSION, FirestoreVectorStore


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--kms-key-name", required=True)
    parser.add_argument("--database", default="(default)")
    parser.add_argument("--apply", action="store_true", help="write new vectors and delete old ones")
    args = parser.parse_args()
    if not args.apply:
        parser.error("pass --apply to run the migration")

    client = firestore.Client(project=args.project, database=args.database)
    repository = FirestorePlannerRepository(
        client, EnvelopeCipher(FirestoreKeyStore(client), GoogleKmsKeyWrapper(args.kms_key_name))
    )
    store = FirestoreVectorStore(client)
    embeddings = LocalEmbeddingClient()
    old_documents = list(store.collection.stream())
    uids = {document.id.split(":", 1)[0] for document in old_documents}
    # list_documents, not stream: a user document exists only as the parent of
    # its records and settings, and stream() skips such missing parents.
    uids.update(reference.id for reference in client.collection("users").list_documents())
    indexed = 0
    for uid in sorted(uids):
        privacy = repository.get_privacy(uid)
        if not privacy.ai_enabled:
            continue
        for entity_type in EntityType:
            if entity_type not in privacy.indexed_entity_types:
                continue
            for record in repository.list_records(uid, entity_type):
                if not record.approved_for_ai:
                    continue
                text = record_text(record, include_attachments=privacy.index_attachments)
                store.index(uid, record, embeddings.embed_document(text, record.content.title))
                indexed += 1

    removed = 0
    for document in old_documents:
        # A backfilled record may have reused this document ID. Check the
        # current value, not the pre-migration snapshot, before deleting.
        if (document.reference.get().to_dict() or {}).get("index_version") != INDEX_VERSION:
            document.reference.delete()
            removed += 1
    print(f"Indexed {indexed} approved records; removed {removed} legacy vectors")


if __name__ == "__main__":
    main()
