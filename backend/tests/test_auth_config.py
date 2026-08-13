from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.auth import bearer_token
from app.config import Settings
from app.secrets import SecretResolver


def test_bearer_token_parsing():
    assert bearer_token("Bearer abc") == "abc"
    with pytest.raises(HTTPException):
        bearer_token("Basic abc")


def test_kms_resource_contract():
    with pytest.raises(ValidationError):
        Settings(
            google_cloud_project="p", firebase_project_id="p", kms_key_name="not-a-resource"
        )


class SecretClient:
    def access_secret_version(self, request):
        assert request["name"].endswith("/versions/1")
        return SimpleNamespace(payload=SimpleNamespace(data=b"z" * 32))


def test_secret_resolver_requires_pinned_version():
    resolver = SecretResolver(SecretClient())
    assert resolver.access("projects/p/secrets/s/versions/1") == b"z" * 32
    with pytest.raises(ValueError):
        resolver.access("projects/p/secrets/s/versions/latest-nope")
