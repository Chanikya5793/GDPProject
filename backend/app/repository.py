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
    ChatResponse,
    EntityType,
    PlannerContent,
    PlannerRecord,
    PlannerSettings,
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
    def get_planner_settings(self, uid: str) -> PlannerSettings: ...
    def set_planner_settings(self, uid: str, settings: PlannerSettings) -> PlannerSettings: ...
    def get_privacy(self, uid: str) -> PrivacySettings: ...
    def set_privacy(self, uid: str, settings: PrivacySettings) -> PrivacySettings: ...
    def save_proposal(self, uid: str, proposal: ActionProposal) -> ActionProposal: ...
    def get_proposal(self, uid: str, proposal_id: str) -> ActionProposal: ...
    def update_proposal_status(self, uid: str, proposal_id: str, status: str) -> ActionProposal: ...
    def apply_proposal(
        self, uid: str, proposal: ActionProposal, idempotency_key: str
    ) -> ActionProposal: ...
    def get_chat_response(self, uid: str, request_id: str) -> Optional[ChatResponse]: ...
    def save_chat_response(
        self, uid: str, request_id: str, question: str, response: ChatResponse, expires_at: datetime
    ) -> None: ...
    def delete_chats(self, uid: str) -> int: ...


class MemoryPlannerRepository:
    """Thread-safe contract adapter used by tests; never selected by production startup."""

    def __init__(self) -> None:
        self.records: Dict[Tuple[str, EntityType, str], PlannerRecord] = {}
        self.idempotency: Dict[Tuple[str, str], Tuple[str, Optional[PlannerRecord]]] = {}
        self.privacy: Dict[str, PrivacySettings] = {}
        self.planner_settings: Dict[str, PlannerSettings] = {}
        self.proposals: Dict[Tuple[str, str], ActionProposal] = {}
        self.chats: Dict[Tuple[str, str], Tuple[str, ChatResponse, datetime]] = {}
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

    def get_planner_settings(self, uid: str) -> PlannerSettings:
        return deepcopy(self.planner_settings.get(uid, PlannerSettings()))

    def set_planner_settings(self, uid: str, settings: PlannerSettings) -> PlannerSettings:
        self.planner_settings[uid] = settings
        return deepcopy(settings)

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

    def apply_proposal(
        self, uid: str, proposal: ActionProposal, idempotency_key: str
    ) -> ActionProposal:
        with self._lock:
            stored = self.proposals.get((uid, proposal.proposal_id))
            if not stored:
                raise NotFound("Proposal not found")
            if stored.status == "confirmed":
                return deepcopy(stored)
            if stored.status != "pending":
                raise ValueError(f"Proposal is {stored.status}")
            if not proposal.record_id:
                raise ValueError("Proposal has no target record")
            key = (uid, proposal.entity_type, proposal.record_id)
            current = self.records.get(key)
            if proposal.operation.value == "create":
                if current:
                    raise RevisionConflict("Target record already exists")
                assert proposal.after is not None
                self.upsert_record(
                    uid, proposal.entity_type, proposal.record_id,
                    RecordUpsertRequest(
                        content=proposal.after, expected_revision=None,
                        idempotency_key=idempotency_key, approved_for_ai=False,
                    ),
                )
            elif proposal.operation.value == "delete":
                if not current or current.revision != proposal.base_revision:
                    raise RevisionConflict("Record changed after the preview was created")
                self.delete_record(
                    uid, proposal.entity_type, proposal.record_id,
                    proposal.base_revision or 0, idempotency_key,
                )
            else:
                if not current or current.revision != proposal.base_revision:
                    raise RevisionConflict("Record changed after the preview was created")
                assert proposal.after is not None
                self.upsert_record(
                    uid, proposal.entity_type, proposal.record_id,
                    RecordUpsertRequest(
                        content=proposal.after, expected_revision=proposal.base_revision,
                        idempotency_key=idempotency_key,
                        approved_for_ai=current.approved_for_ai,
                    ),
                )
            confirmed = stored.model_copy(update={"status": "confirmed"})
            self.proposals[(uid, proposal.proposal_id)] = confirmed
            return deepcopy(confirmed)

    def get_chat_response(self, uid: str, request_id: str) -> Optional[ChatResponse]:
        value = self.chats.get((uid, request_id))
        if not value:
            return None
        if value[2] <= datetime.now(timezone.utc):
            del self.chats[(uid, request_id)]
            return None
        return deepcopy(value[1])

    def save_chat_response(
        self, uid: str, request_id: str, question: str, response: ChatResponse, expires_at: datetime
    ) -> None:
        self.chats[(uid, request_id)] = (question, deepcopy(response), expires_at)

    def delete_chats(self, uid: str) -> int:
        keys = [key for key in self.chats if key[0] == uid]
        for key in keys:
            del self.chats[key]
        return len(keys)


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
                return None
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
            return None

        apply(transaction)
        snapshot = ref.get()
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

    def get_planner_settings(self, uid: str) -> PlannerSettings:
        snapshot = self.client.collection("users").document(uid).collection("settings").document(
            "planner"
        ).get()
        return PlannerSettings.model_validate(snapshot.to_dict()) if snapshot.exists else PlannerSettings()

    def set_planner_settings(self, uid: str, settings: PlannerSettings) -> PlannerSettings:
        self.client.collection("users").document(uid).collection("settings").document(
            "planner"
        ).set(settings.model_dump(mode="json"))
        return settings

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

    def apply_proposal(
        self, uid: str, proposal: ActionProposal, idempotency_key: str
    ) -> ActionProposal:
        if not proposal.record_id:
            raise ValueError("Proposal has no target record")
        proposal_ref = self.client.collection("users").document(uid).collection(
            "proposals"
        ).document(proposal.proposal_id)
        record_ref = self._record_ref(uid, proposal.entity_type, proposal.record_id)
        idem_ref = self.client.collection("users").document(uid).collection(
            "idempotency"
        ).document(idempotency_key)
        request_hash = hashlib.sha256(
            f"proposal:{proposal.proposal_id}:{proposal.base_revision}".encode()
        ).hexdigest()
        transaction = self.client.transaction()

        @firestore.transactional
        def apply(txn):
            stored_proposal = proposal_ref.get(transaction=txn)
            idem = idem_ref.get(transaction=txn)
            current = record_ref.get(transaction=txn)
            if not stored_proposal.exists:
                raise NotFound("Proposal not found")
            status = stored_proposal.to_dict()["status"]
            if idem.exists:
                if idem.to_dict()["request_hash"] != request_hash:
                    raise IdempotencyConflict("Idempotency key was already used")
                if status != "confirmed":
                    raise IdempotencyConflict("Proposal idempotency state is inconsistent")
                return
            if status != "pending":
                raise ValueError(f"Proposal is {status}")

            now = datetime.now(timezone.utc)
            if proposal.operation.value == "create":
                if current.exists:
                    raise RevisionConflict("Target record already exists")
                assert proposal.after is not None
                revision = 1
                created_at = now
                approved_for_ai = False
            elif proposal.operation.value == "delete":
                if not current.exists or current.to_dict()["revision"] != proposal.base_revision:
                    raise RevisionConflict("Record changed after the preview was created")
                txn.delete(record_ref)
                revision = 0
                created_at = now
                approved_for_ai = False
            else:
                if not current.exists or current.to_dict()["revision"] != proposal.base_revision:
                    raise RevisionConflict("Record changed after the preview was created")
                assert proposal.after is not None
                data = current.to_dict()
                revision = data["revision"] + 1
                created_at = data["created_at"]
                approved_for_ai = data.get("approved_for_ai", False)

            if proposal.operation.value != "delete":
                assert proposal.after is not None
                encrypted = self.cipher.encrypt(
                    uid, proposal.entity_type.value, proposal.record_id, revision,
                    proposal.after.model_dump(mode="json"),
                )
                txn.set(record_ref, {
                    "uid": uid,
                    "record_id": proposal.record_id,
                    "entity_type": proposal.entity_type.value,
                    "revision": revision,
                    "approved_for_ai": approved_for_ai,
                    "encrypted_payload": encrypted.to_dict(),
                    "created_at": created_at,
                    "updated_at": now,
                })
            txn.create(idem_ref, {
                "request_hash": request_hash,
                "operation": "proposal",
                "proposal_id": proposal.proposal_id,
                "created_at": now,
            })
            txn.update(proposal_ref, {"status": "confirmed", "updated_at": now})

        apply(transaction)
        return self.get_proposal(uid, proposal.proposal_id)

    def get_chat_response(self, uid: str, request_id: str) -> Optional[ChatResponse]:
        ref = self.client.collection("users").document(uid).collection("chats").document(request_id)
        snapshot = ref.get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict()
        if data["expires_at"] <= datetime.now(timezone.utc):
            ref.delete()
            return None
        payload = self.cipher.decrypt(
            uid, "chat", request_id, 1, EncryptedPayload.from_dict(data["encrypted_payload"])
        )
        return ChatResponse.model_validate(payload["response"])

    def save_chat_response(
        self, uid: str, request_id: str, question: str, response: ChatResponse, expires_at: datetime
    ) -> None:
        payload = self.cipher.encrypt(
            uid, "chat", request_id, 1,
            {"question": question, "response": response.model_dump(mode="json")},
        )
        self.client.collection("users").document(uid).collection("chats").document(request_id).set({
            "uid": uid,
            "request_id": request_id,
            "encrypted_payload": payload.to_dict(),
            "created_at": firestore.SERVER_TIMESTAMP,
            "expires_at": expires_at,
        })

    def delete_chats(self, uid: str) -> int:
        documents = list(
            self.client.collection("users").document(uid).collection("chats").stream()
        )
        batch = self.client.batch()
        for document in documents:
            batch.delete(document.reference)
        if documents:
            batch.commit()
        return len(documents)


def generated_record_id() -> str:
    return f"ai_{secrets.token_urlsafe(18).replace('-', '_')}"
