from __future__ import annotations

import re

from google.cloud import secretmanager


class SecretResolver:
    def __init__(self, client: secretmanager.SecretManagerServiceClient | None = None):
        self.client = client or secretmanager.SecretManagerServiceClient()

    def access(self, resource_name: str) -> bytes:
        if not re.fullmatch(r"projects/[^/]+/secrets/[^/]+/versions/[1-9]\d*", resource_name):
            raise ValueError("Secret Manager resource must pin an explicit version")
        response = self.client.access_secret_version(request={"name": resource_name})
        return bytes(response.payload.data)
