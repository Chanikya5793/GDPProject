from functools import lru_cache
from typing import List, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .planner import DEFAULT_MAX_DAILY_MINUTES
from .proposals import DEFAULT_PROPOSAL_TTL_HOURS


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
    muse_model: str = "muse-spark-1.2"
    muse_api_key_resource: str = ""
    # Muse Spark spends most of its output on hidden reasoning, and it does all of
    # it before emitting the first answer token, so this sets how long the student
    # waits before anything appears. A trivial prompt burned 475 reasoning tokens
    # at the default; "low" cut answers to 6 to 11 seconds.
    #
    # History. It was moved down to "minimal" on 2026-09-01: during a Muse
    # slowdown "low" timed out on 3 of 4 requests against the then 60-second
    # ceiling while "minimal" completed 4 of 4 in 6.7 to 10.4 seconds. The cost
    # was tone -- "minimal" leaked citation IDs and markdown into prose and
    # preferred raw timestamps ("2026-08-31 22:22") over the plainer wording
    # ("Aug 31 at 10:22 PM").
    #
    # Raised to "medium" on 2026-09-02, after 36 live requests across all four
    # levels on three shapes of turn. Median seconds per generation:
    #
    #     turn             minimal   low   medium   high
    #     briefing only        1.4   4.6      8.9   11.2
    #     needs a lookup       1.9   2.7      3.4    3.3
    #     asks for changes     2.7   4.7      6.8   12.9
    #
    # Nothing came near the timeout, so the earlier climb-down was a symptom of
    # a provider slowdown rather than a property of the levels. Tool choice was
    # correct at every level once the parser stopped losing narrated replies,
    # so this is not bought with accuracy alone: "medium" was the only level
    # that never proposed an unasked-for change on a plain question ("low" and
    # "high" each did on 1 of 3), and it reads better than the lower two, which
    # answer in bulleted fragments. "high" costs roughly double the wall clock
    # for no measured gain. The timeout that forced the earlier climb-down is
    # raised alongside this rather than left to bite again, and
    # `agent_deadline_seconds` stops a slow turn from multiplying the ceiling
    # by the number of rounds.
    muse_reasoning_effort: Literal["minimal", "low", "medium", "high"] = "medium"
    # Per model call, not per turn. Kept under the platform request timeout in
    # infra/cloudrun/service.yaml.template, which has to stay above it so a slow
    # generation surfaces as this app's own explained 504 rather than a bare
    # platform 500.
    muse_timeout_seconds: int = Field(default=120, ge=5, le=300)
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 768
    allowed_origins: List[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    mcp_session_secret_resource: str = ""
    chat_retention_days: int = Field(default=30, ge=0, le=365)
    retrieval_limit: int = Field(default=5, ge=1, le=20)
    # How many extra generations the assistant may spend looking things up
    # before it has to answer. Every turn already arrives with a briefing and a
    # search, so most questions never use one; 0 turns the loop off entirely.
    agent_tool_rounds: int = Field(default=2, ge=0, le=4)
    # How long a turn may already have spent before the assistant is refused
    # another round of lookups. Rounds are sequential model calls, so without
    # this the worst case is the model timeout multiplied by the round budget,
    # and a slow provider turns a good answer into a dead request. Past it the
    # assistant is told it has no lookups left and answers with what it has.
    # 0 removes the deadline.
    agent_deadline_seconds: int = Field(default=90, ge=0, le=600)
    # Records the briefing may list before it starts truncating. It travels in
    # the prompt on every turn, so this is a token budget.
    briefing_items: int = Field(default=40, ge=0, le=200)
    # How long a previewed change stays confirmable. Thirty minutes was shorter
    # than the conversation it belonged to, so a student returning to a thread
    # found every change in it dead. Safe to be generous: a confirmation carries
    # the revision it was previewed from, so a record edited meanwhile is
    # refused rather than overwritten.
    proposal_ttl_hours: int = Field(default=DEFAULT_PROPOSAL_TTL_HOURS, ge=1, le=720)
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

