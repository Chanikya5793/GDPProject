from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Protocol, Tuple

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore, kms


class KeyStore(Protocol):
    def get_wrapped_key(self, uid: str) -> Tuple[str, bytes] | None: ...
    def put_wrapped_key(self, uid: str, key_version: str, wrapped_key: bytes) -> None: ...


class KeyWrapper(Protocol):
    def wrap(self, plaintext_key: bytes) -> bytes: ...
    def unwrap(self, wrapped_key: bytes) -> bytes: ...


class GoogleKmsKeyWrapper:
    def __init__(self, key_name: str, client: kms.KeyManagementServiceClient | None = None):
        self.key_name = key_name
        self.client = client or kms.KeyManagementServiceClient()

    def wrap(self, plaintext_key: bytes) -> bytes:
        return self.client.encrypt(
            request={"name": self.key_name, "plaintext": plaintext_key}
        ).ciphertext

    def unwrap(self, wrapped_key: bytes) -> bytes:
        return self.client.decrypt(
            request={"name": self.key_name, "ciphertext": wrapped_key}
        ).plaintext


class FirestoreKeyStore:
    def __init__(self, client: firestore.Client):
        self.client = client

    def get_wrapped_key(self, uid: str) -> Tuple[str, bytes] | None:
        snapshot = self.client.collection("user_keys").document(uid).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict()
        return str(data["key_version"]), bytes(data["wrapped_key"])

    def put_wrapped_key(self, uid: str, key_version: str, wrapped_key: bytes) -> None:
        self.client.collection("user_keys").document(uid).create(
            {
                "uid": uid,
                "key_version": key_version,
                "wrapped_key": wrapped_key,
                "created_at": firestore.SERVER_TIMESTAMP,
            }
        )


@dataclass(frozen=True)
class EncryptedPayload:
    algorithm: str
    key_version: str
    nonce: str
    ciphertext: str

    def to_dict(self) -> Dict[str, str]:
        return {
            "algorithm": self.algorithm,
            "key_version": self.key_version,
            "nonce": self.nonce,
            "ciphertext": self.ciphertext,
        }

    @classmethod
    def from_dict(cls, value: Dict[str, str]) -> "EncryptedPayload":
        return cls(**value)


class EnvelopeCipher:
    """AES-256-GCM payload encryption with one KMS-wrapped DEK per user.

    The UID, record coordinates, and revision are authenticated as AAD, which
    prevents ciphertext from being copied between users or record versions.
    """

    def __init__(self, key_store: KeyStore, key_wrapper: KeyWrapper):
        self.key_store = key_store
        self.key_wrapper = key_wrapper
        self._cache: Dict[str, Tuple[str, bytes]] = {}

    def _get_user_key(self, uid: str) -> Tuple[str, bytes]:
        cached = self._cache.get(uid)
        if cached:
            return cached
        stored = self.key_store.get_wrapped_key(uid)
        if stored:
            key_version, wrapped = stored
            result = (key_version, self.key_wrapper.unwrap(wrapped))
        else:
            key_version = "v1"
            plaintext = AESGCM.generate_key(bit_length=256)
            try:
                self.key_store.put_wrapped_key(uid, key_version, self.key_wrapper.wrap(plaintext))
                result = (key_version, plaintext)
            except AlreadyExists:
                raced = self.key_store.get_wrapped_key(uid)
                if not raced:
                    raise
                raced_version, raced_wrapped = raced
                result = (raced_version, self.key_wrapper.unwrap(raced_wrapped))
        self._cache[uid] = result
        return result

    @staticmethod
    def aad(uid: str, entity_type: str, record_id: str, revision: int) -> bytes:
        return f"planner:v1:{uid}:{entity_type}:{record_id}:{revision}".encode()

    def encrypt(
        self, uid: str, entity_type: str, record_id: str, revision: int, value: Dict[str, Any]
    ) -> EncryptedPayload:
        key_version, key = self._get_user_key(uid)
        nonce = os.urandom(12)
        plaintext = json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
        ciphertext = AESGCM(key).encrypt(
            nonce, plaintext, self.aad(uid, entity_type, record_id, revision)
        )
        return EncryptedPayload(
            algorithm="AES-256-GCM",
            key_version=key_version,
            nonce=base64.b64encode(nonce).decode(),
            ciphertext=base64.b64encode(ciphertext).decode(),
        )

    def decrypt(
        self,
        uid: str,
        entity_type: str,
        record_id: str,
        revision: int,
        payload: EncryptedPayload,
    ) -> Dict[str, Any]:
        key_version, key = self._get_user_key(uid)
        if payload.key_version != key_version or payload.algorithm != "AES-256-GCM":
            raise ValueError("Unsupported or unavailable encryption key version")
        plaintext = AESGCM(key).decrypt(
            base64.b64decode(payload.nonce),
            base64.b64decode(payload.ciphertext),
            self.aad(uid, entity_type, record_id, revision),
        )
        return json.loads(plaintext)
