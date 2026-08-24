from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PLANNER_", extra="ignore")

    environment: str = "development"
    google_cloud_project: str
    google_cloud_location: str = "global"
    firebase_project_id: str
    kms_key_name: str
    firestore_database: str = "(default)"
    gemini_model: str = "gemini-2.5-flash"
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 768
    allowed_origins: List[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    mcp_session_secret_resource: str = ""
    chat_retention_days: int = Field(default=30, ge=0, le=365)
    retrieval_limit: int = Field(default=5, ge=1, le=20)

    @field_validator("kms_key_name")
    @classmethod
    def validate_kms_key(cls, value: str) -> str:
        if not value.startswith("projects/") or "/cryptoKeys/" not in value:
            raise ValueError("kms_key_name must be a full Cloud KMS CryptoKey resource name")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]

