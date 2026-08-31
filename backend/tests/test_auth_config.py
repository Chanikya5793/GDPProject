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


def settings(**overrides):
    base = dict(
        google_cloud_project="p", firebase_project_id="p",
        kms_key_name="projects/p/locations/us/keyRings/r/cryptoKeys/k",
        mcp_session_secret_resource="projects/p/secrets/mcp/versions/1",
    )
    return Settings(**{**base, **overrides})


def test_kms_resource_contract():
    with pytest.raises(ValidationError):
        settings(kms_key_name="not-a-resource")


def test_session_secret_is_required_at_startup():
    # The production container signs MCP sessions and audit entries with this.
    # Missing, it cannot be built at all, and every authenticated request
    # answers 503 while the service still reports healthy — so refuse to boot.
    with pytest.raises(ValidationError):
        settings(mcp_session_secret_resource="")


def test_a_complete_configuration_validates():
    assert settings().mcp_session_secret_resource.endswith("/versions/1")


class SecretClient:
    def access_secret_version(self, request):
        assert request["name"].endswith("/versions/1")
        return SimpleNamespace(payload=SimpleNamespace(data=b"z" * 32))


def test_secret_resolver_requires_pinned_version():
    resolver = SecretResolver(SecretClient())
    assert resolver.access("projects/p/secrets/s/versions/1") == b"z" * 32
    with pytest.raises(ValueError):
        resolver.access("projects/p/secrets/s/versions/latest-nope")
