from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Protocol, Tuple

from google.cloud import firestore
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from .models import EntityType, PlannerRecord


@dataclass(frozen=True)
class VectorHit:
    entity_type: EntityType
    record_id: str
    revision: int
    distance: float


class VectorStore(Protocol):
    def index(self, uid: str, record: PlannerRecord, embedding: List[float]) -> None: ...
    def search(self, uid: str, embedding: List[float], limit: int) -> List[VectorHit]: ...
    def delete_record(self, uid: str, entity_type: EntityType, record_id: str) -> None: ...
    def delete_user(self, uid: str) -> int: ...


class FirestoreVectorStore:
    """Firestore KNN with a mandatory UID prefilter on every query."""

    def __init__(self, client: firestore.Client):
        self.client = client
        self.collection = client.collection("planner_vectors")

    @staticmethod
    def document_id(uid: str, entity_type: EntityType, record_id: str) -> str:
        return f"{uid}:{entity_type.value}:{record_id}"

    def index(self, uid: str, record: PlannerRecord, embedding: List[float]) -> None:
        self.collection.document(self.document_id(uid, record.content.entity_type, record.record_id)).set({
            "uid": uid,
            "entity_type": record.content.entity_type.value,
            "record_id": record.record_id,
            "revision": record.revision,
            "embedding": Vector(embedding),
            "updated_at": firestore.SERVER_TIMESTAMP,
        })

    def search(self, uid: str, embedding: List[float], limit: int) -> List[VectorHit]:
        query = self.collection.where("uid", "==", uid).find_nearest(
            vector_field="embedding",
            query_vector=Vector(embedding),
            distance_measure=DistanceMeasure.COSINE,
            limit=limit,
            distance_result_field="vector_distance",
        )
        hits = []
        for snapshot in query.stream():
            data = snapshot.to_dict()
            if data.get("uid") != uid:
                raise RuntimeError("Vector store violated UID isolation")
            hits.append(VectorHit(
                entity_type=EntityType(data["entity_type"]),
                record_id=data["record_id"], revision=data["revision"],
                distance=float(data.get("vector_distance", 0.0)),
            ))
        return hits

    def delete_record(self, uid: str, entity_type: EntityType, record_id: str) -> None:
        self.collection.document(self.document_id(uid, entity_type, record_id)).delete()

    def delete_user(self, uid: str) -> int:
        documents = list(self.collection.where("uid", "==", uid).stream())
        batch = self.client.batch()
        for document in documents:
            batch.delete(document.reference)
        if documents:
            batch.commit()
        return len(documents)


class MemoryVectorStore:
    def __init__(self) -> None:
        self.vectors: Dict[Tuple[str, EntityType, str], Tuple[int, List[float]]] = {}

    def index(self, uid: str, record: PlannerRecord, embedding: List[float]) -> None:
        self.vectors[(uid, record.content.entity_type, record.record_id)] = (
            record.revision, list(embedding)
        )

    @staticmethod
    def _cosine_distance(left: List[float], right: List[float]) -> float:
        dot = sum(a * b for a, b in zip(left, right))
        left_norm = math.sqrt(sum(a * a for a in left))
        right_norm = math.sqrt(sum(b * b for b in right))
        if not left_norm or not right_norm:
            return 1.0
        return 1.0 - dot / (left_norm * right_norm)

    def search(self, uid: str, embedding: List[float], limit: int) -> List[VectorHit]:
        hits = [
            VectorHit(kind, record_id, revision, self._cosine_distance(embedding, vector))
            for (record_uid, kind, record_id), (revision, vector) in self.vectors.items()
            if record_uid == uid
        ]
        return sorted(hits, key=lambda hit: hit.distance)[:limit]

    def delete_record(self, uid: str, entity_type: EntityType, record_id: str) -> None:
        self.vectors.pop((uid, entity_type, record_id), None)

    def delete_user(self, uid: str) -> int:
        keys = [key for key in self.vectors if key[0] == uid]
        for key in keys:
            del self.vectors[key]
        return len(keys)

