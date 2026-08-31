import pytest
from cryptography.exceptions import InvalidTag
from google.api_core.exceptions import AlreadyExists

from app.crypto import EnvelopeCipher


class Keys:
    def __init__(self):
        self.values = {}

    def get_wrapped_key(self, uid):
        return self.values.get(uid)

    def put_wrapped_key(self, uid, version, wrapped):
        self.values[uid] = (version, wrapped)


class Wrapper:
    def wrap(self, key):
        return bytes(value ^ 0xAA for value in key)

    def unwrap(self, key):
        return bytes(value ^ 0xAA for value in key)


def test_encrypt_round_trip_and_no_plaintext():
    cipher = EnvelopeCipher(Keys(), Wrapper())
    encrypted = cipher.encrypt("alice", "note", "n1", 1, {"body": "private exam notes"})
    assert "private" not in encrypted.ciphertext
    assert cipher.decrypt("alice", "note", "n1", 1, encrypted) == {"body": "private exam notes"}


@pytest.mark.parametrize("uid,kind,record,revision", [
    ("bob", "note", "n1", 1), ("alice", "task", "n1", 1),
    ("alice", "note", "n2", 1), ("alice", "note", "n1", 2),
])
def test_ciphertext_is_bound_to_aad(uid, kind, record, revision):
    cipher = EnvelopeCipher(Keys(), Wrapper())
    encrypted = cipher.encrypt("alice", "note", "n1", 1, {"body": "secret"})
    with pytest.raises(InvalidTag):
        cipher.decrypt(uid, kind, record, revision, encrypted)


def test_per_user_keys_are_distinct():
    keys = Keys()
    cipher = EnvelopeCipher(keys, Wrapper())
    cipher.encrypt("alice", "note", "n1", 1, {"body": "a"})
    cipher.encrypt("bob", "note", "n1", 1, {"body": "b"})
    assert keys.values["alice"] != keys.values["bob"]


def test_concurrent_first_key_creation_uses_winning_wrapped_key():
    class RacingKeys(Keys):
        def put_wrapped_key(self, uid, version, wrapped):
            self.values[uid] = (version, Wrapper().wrap(b"w" * 32))
            raise AlreadyExists("another request created the key")

    cipher = EnvelopeCipher(RacingKeys(), Wrapper())
    encrypted = cipher.encrypt("alice", "note", "n1", 1, {"body": "safe after race"})
    assert cipher.decrypt("alice", "note", "n1", 1, encrypted)["body"] == "safe after race"
