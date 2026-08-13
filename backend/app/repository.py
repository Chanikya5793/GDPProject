import hashlib
import secrets
from copy import deepcopy
from datetime import datetime, timezone
from threading import RLock
from typing import Dict, List, Optional, Protocol, Tuple

from google.cloud import firestore
from pydantic import TypeAdapter

from .crypto import EncryptedPayload, EnvelopeCipher
from .models import (
    ActionProposal,
    EntityType,
    PlannerContent,
    PlannerRecord,
    PrivacySettings,
    RecordUpsertRequest,
)


CONTENT_ADAPTER = TypeAdapter(PlannerContent)


class RevisionConflict(RuntimeError):
    pass


class IdempotencyConflict(RuntimeError):
    pass


class NotFound(RuntimeError):
    pass


class PlannerRepository(Protocol):
    def list_records(self, uid: str, entity_type: EntityType) -> List[PlannerRecord]: ...
    def get_record(self, uid: str, entity_type: EntityType, record_id: str) -> PlannerRecord: ...
    def upsert_record(
        self, uid: str, entity_type: EntityType, record_id: str, request: RecordUpsertRequest
    ) -> PlannerRecord: ...
    def delete_record(
        self, uid: str, entity_type: EntityType, record_id: str, expected_revision: int,
        idempotency_key: str,
    ) -> None: ...
    def get_privacy(self, uid: str) -> PrivacySettings: ...
    def set_privacy(self, uid: str, settings: PrivacySettings) -> PrivacySettings: ...
    def save_proposal(self, uid: str, proposal: ActionProposal) -> ActionProposal: ...
    def get_proposal(self, uid: str, proposal_id: str) -> ActionProposal: ...
    def update_proposal_status(self, uid: str, proposal_id: str, status: str) -> ActionProposal: ...


class MemoryPlannerRepository:
    """Thread-safe contract adapter used by tests; never selected by production startup."""

    def __init__(self) -> None:
        self.records: Dict[Tuple[str, EntityType, str], PlannerRecord] = {}
        self.idempotency: Dict[Tuple[str, str], Tuple[str, Optional[PlannerRecord]]] = {}
        self.privacy: Dict[str, PrivacySettings] = {}
        self.proposals: Dict[Tuple[str, str], ActionProposal] = {}
        self._lock = RLock()

    def list_records(self, uid: str, entity_type: EntityType) -> List[PlannerRecord]:
        return [
            deepcopy(value)
            for (record_uid, kind, _), value in self.records.items()
            if record_uid == uid and kind == entity_type
        ]

    def get_record(self, uid: str, entity_type: EntityType, record_id: str) -> PlannerRecord:
        value = self.records.get((uid, entity_type, record_id))
        if not value:
            raise NotFound(f"{entity_type.value} record not found")
        return deepcopy(value)

    def upsert_record(
        self, uid: str, entity_type: EntityType, record_id: str, request: RecordUpsertRequest
    ) -> PlannerRecord:
        with self._lock:
            if request.content.entity_type != entity_type:
                raise ValueError("Path entity type does not match content entity type")
            request_hash = hashlib.sha256(request.model_dump_json().encode()).hexdigest()
            idem_key = (uid, request.idempotency_key)
            if idem_key in self.idempotency:
                prior_hash, prior_record = self.idempotency[idem_key]
                if prior_hash != request_hash:
                    raise IdempotencyConflict("Idempotency key was already used for another request")
                if prior_record is None:
                    raise IdempotencyConflict("Idempotency key belongs to a delete operation")
                return deepcopy(prior_record)
            key = (uid, entity_type, record_id)
            current = self.records.get(key)
            if current:
                if request.expected_revision != current.revision:
                    raise RevisionConflict("Record changed since it was read")
                revision = current.revision + 1
                created_at = current.created_at
            else:
                if request.expected_revision not in (None, 0):
                    raise RevisionConflict("Cannot create a record with a nonzero revision")
                revision = 1
                created_at = datetime.now(timezone.utc)
            now = datetime.now(timezone.utc)
            result = PlannerRecord(
                record_id=record_id,
                revision=revision,
                content=request.content,
                approved_for_ai=request.approved_for_ai,
                created_at=created_at,
                updated_at=now,
            )
            self.records[key] = result
            self.idempotency[idem_key] = (request_hash, result)
            return deepcopy(result)

    def delete_record(
        self, uid: str, entity_type: EntityType, record_id: str, expected_revision: int,
        idempotency_key: str,
    ) -> None:
        with self._lock:
            idem_key = (uid, idempotency_key)
            request_hash = hashlib.sha256(
                f"delete:{entity_type}:{record_id}:{expected_revision}".encode()
            ).hexdigest()
            if idem_key in self.idempotency:
                prior_hash, prior = self.idempotency[idem_key]
                if prior_hash != request_hash or prior is not None:
                    raise IdempotencyConflict("Idempotency key was already used for another request")
                return
            key = (uid, entity_type, record_id)
            current = self.records.get(key)
            if not current:
                raise NotFound("Record not found")
            if current.revision != expected_revision:
                raise RevisionConflict("Record changed since it was read")
            del self.records[key]
            self.idempotency[idem_key] = (request_hash, None)

    def get_privacy(self, uid: str) -> PrivacySettings:
        return deepcopy(self.privacy.get(uid, PrivacySettings()))

    def set_privacy(self, uid: str, settings: PrivacySettings) -> PrivacySettings:
        self.privacy[uid] = settings
        return deepcopy(settings)

    def save_proposal(self, uid: str, proposal: ActionProposal) -> ActionProposal:
        self.proposals[(uid, proposal.proposal_id)] = proposal
        return deepcopy(proposal)

    def get_proposal(self, uid: str, proposal_id: str) -> ActionProposal:
        proposal = self.proposals.get((uid, proposal_id))
        if not proposal:
            raise NotFound("Proposal not found")
        return deepcopy(proposal)

    def update_proposal_status(self, uid: str, proposal_id: str, status: str) -> ActionProposal:
        proposal = self.get_proposal(uid, proposal_id).model_copy(update={"status": status})
        self.proposals[(uid, proposal_id)] = proposal
        return deepcopy(proposal)


class FirestorePlannerRepository:
    def __init__(self, client: firestore.Client, cipher: EnvelopeCipher):
        self.client = client
        self.cipher = cipher

    def _record_ref(self, uid: str, entity_type: EntityType, record_id: str):
        return self.client.collection("users").document(uid).collection("records").document(
            f"{entity_type.value}:{record_id}"
        )

    def _deserialize(self, uid: str, snapshot) -> PlannerRecord:
        data = snapshot.to_dict()
        content = self.cipher.decrypt(
            uid,
            data["entity_type"],
            data["record_id"],
            data["revision"],
            EncryptedPayload.from_dict(data["encrypted_payload"]),
        )
        return PlannerRecord(
            record_id=data["record_id"],
            revision=data["revision"],
            content=CONTENT_ADAPTER.validate_python(content),
            approved_for_ai=data.get("approved_for_ai", False),
            created_at=data["created_at"],
            updated_at=data["updated_at"],
        )

    def list_records(self, uid: str, entity_type: EntityType) -> List[PlannerRecord]:
        query = (
            self.client.collection("users").document(uid).collection("records")
            .where("entity_type", "==", entity_type.value)
        )
        return [self._deserialize(uid, snapshot) for snapshot in query.stream()]

    def get_record(self, uid: str, entity_type: EntityType, record_id: str) -> PlannerRecord:
        snapshot = self._record_ref(uid, entity_type, record_id).get()
        if not snapshot.exists:
            raise NotFound("Record not found")
        return self._deserialize(uid, snapshot)

    def upsert_record(
        self, uid: str, entity_type: EntityType, record_id: str, request: RecordUpsertRequest
    ) -> PlannerRecord:
        if request.content.entity_type != entity_type:
            raise ValueError("Path entity type does not match content entity type")
        transaction = self.client.transaction()
        ref = self._record_ref(uid, entity_type, record_id)
        idem_ref = self.client.collection("users").document(uid).collection("idempotency").document(
            request.idempotency_key
        )
        request_hash = hashlib.sha256(request.model_dump_json().encode()).hexdigest()

        @firestore.transactional
        def apply(txn):
            idem = idem_ref.get(transaction=txn)
            if idem.exists:
                prior = idem.to_dict()
                if prior["request_hash"] != request_hash:
                    raise IdempotencyConflict("Idempotency key was already used")
                return ref.get(transaction=txn)
            current = ref.get(transaction=txn)
            now = datetime.now(timezone.utc)
            if current.exists:
                data = current.to_dict()
                if request.expected_revision != data["revision"]:
                    raise RevisionConflict("Record changed since it was read")
                revision = data["revision"] + 1
                created_at = data["created_at"]
            else:
                if request.expected_revision not in (None, 0):
                    raise RevisionConflict("Cannot create with a nonzero revision")
                revision = 1
                created_at = now
            encrypted = self.cipher.encrypt(
                uid, entity_type.value, record_id, revision, request.content.model_dump(mode="json")
            )
            txn.set(ref, {
                "uid": uid,
                "record_id": record_id,
                "entity_type": entity_type.value,
                "revision": revision,
                "approved_for_ai": request.approved_for_ai,
                "encrypted_payload": encrypted.to_dict(),
                "created_at": created_at,
                "updated_at": now,
            })
            txn.create(idem_ref, {
                "request_hash": request_hash,
                "operation": "upsert",
                "record_path": ref.path,
                "created_at": now,
            })
            return ref.get(transaction=txn)

        snapshot = apply(transaction)
        return self._deserialize(uid, snapshot)

    def delete_record(
        self, uid: str, entity_type: EntityType, record_id: str, expected_revision: int,
        idempotency_key: str,
    ) -> None:
        transaction = self.client.transaction()
        ref = self._record_ref(uid, entity_type, record_id)
        idem_ref = self.client.collection("users").document(uid).collection("idempotency").document(
            idempotency_key
        )
        request_hash = hashlib.sha256(
            f"delete:{entity_type.value}:{record_id}:{expected_revision}".encode()
        ).hexdigest()

        @firestore.transactional
        def apply(txn):
            idem = idem_ref.get(transaction=txn)
            if idem.exists:
                if idem.to_dict()["request_hash"] != request_hash:
                    raise IdempotencyConflict("Idempotency key was already used")
                return
            current = ref.get(transaction=txn)
            if not current.exists:
                raise NotFound("Record not found")
            if current.to_dict()["revision"] != expected_revision:
                raise RevisionConflict("Record changed since it was read")
            txn.delete(ref)
            txn.create(idem_ref, {
                "request_hash": request_hash,
                "operation": "delete",
                "created_at": datetime.now(timezone.utc),
            })

        apply(transaction)

    def get_privacy(self, uid: str) -> PrivacySettings:
        snapshot = self.client.collection("users").document(uid).collection("settings").document(
            "ai_privacy"
        ).get()
        return PrivacySettings.model_validate(snapshot.to_dict()) if snapshot.exists else PrivacySettings()

    def set_privacy(self, uid: str, settings: PrivacySettings) -> PrivacySettings:
        self.client.collection("users").document(uid).collection("settings").document(
            "ai_privacy"
        ).set(settings.model_dump(mode="json"))
        return settings

    def save_proposal(self, uid: str, proposal: ActionProposal) -> ActionProposal:
        ref = self.client.collection("users").document(uid).collection("proposals").document(
            proposal.proposal_id
        )
        payload = self.cipher.encrypt(
            uid, "proposal", proposal.proposal_id, 1, proposal.model_dump(mode="json")
        )
        ref.create({
            "uid": uid,
            "proposal_id": proposal.proposal_id,
            "status": proposal.status,
            "encrypted_payload": payload.to_dict(),
            "created_at": proposal.created_at,
            "expires_at": proposal.expires_at,
        })
        return proposal

    def get_proposal(self, uid: str, proposal_id: str) -> ActionProposal:
        snapshot = self.client.collection("users").document(uid).collection("proposals").document(
            proposal_id
        ).get()
        if not snapshot.exists:
            raise NotFound("Proposal not found")
        data = snapshot.to_dict()
        payload = self.cipher.decrypt(
            uid, "proposal", proposal_id, 1, EncryptedPayload.from_dict(data["encrypted_payload"])
        )
        payload["status"] = data["status"]
        return ActionProposal.model_validate(payload)

    def update_proposal_status(self, uid: str, proposal_id: str, status: str) -> ActionProposal:
        ref = self.client.collection("users").document(uid).collection("proposals").document(
            proposal_id
        )
        snapshot = ref.get()
        if not snapshot.exists:
            raise NotFound("Proposal not found")
        ref.update({"status": status, "updated_at": firestore.SERVER_TIMESTAMP})
        return self.get_proposal(uid, proposal_id)


def generated_record_id() -> str:
    return secrets.token_urlsafe(18).replace("-", "_")

