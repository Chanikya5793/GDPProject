from functools import lru_cache
from typing import List, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .planner import DEFAULT_MAX_DAILY_MINUTES


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PLANNER_", extra="ignore")

    environment: str = "development"
    google_cloud_project: str
    google_cloud_location: str = "global"
    firebase_project_id: str
    kms_key_name: str
    firestore_database: str = "(default)"
    answer_provider: Literal["vertex", "muse"] = "vertex"
    gemini_model: str = "gemini-2.5-flash"
    muse_base_url: str = "https://api.meta.ai/v1"
    muse_model: str = "muse-spark-1.2-contributor"
    muse_api_key_resource: str = ""
    muse_timeout_seconds: int = Field(default=60, ge=5, le=300)
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 768
    allowed_origins: List[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    mcp_session_secret_resource: str = ""
    chat_retention_days: int = Field(default=30, ge=0, le=365)
    retrieval_limit: int = Field(default=5, ge=1, le=20)
    max_daily_minutes: int = Field(default=DEFAULT_MAX_DAILY_MINUTES, ge=15, le=1440)
    chat_rate_limit_requests: int = Field(default=20, ge=1, le=1000)
    chat_rate_limit_window_seconds: int = Field(default=3600, ge=1, le=86400)

    @model_validator(mode="after")
    def require_muse_key(self) -> "Settings":
        # Fail at startup rather than on the first user question.
        if self.answer_provider == "muse" and not self.muse_api_key_resource:
            raise ValueError(
                "muse_api_key_resource is required when answer_provider is 'muse'"
            )
        return self

    @model_validator(mode="after")
    def require_session_secret(self) -> "Settings":
        # build_production_container signs MCP sessions and audit entries with
        # this, unconditionally. Left empty, the container cannot be built and
        # every authenticated request answers 503 with no hint as to why, while
        # the service itself reports healthy. Fail on boot, as the Muse key does.
        if not self.mcp_session_secret_resource:
            raise ValueError("mcp_session_secret_resource is required")
        return self

    @field_validator("kms_key_name")
    @classmethod
    def validate_kms_key(cls, value: str) -> str:
        if not value.startswith("projects/") or "/cryptoKeys/" not in value:
            raise ValueError("kms_key_name must be a full Cloud KMS CryptoKey resource name")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]

