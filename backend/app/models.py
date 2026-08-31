from datetime import date, datetime
from enum import Enum
from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

SafeText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100_000)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
RecordId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")]
IdempotencyKey = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class EntityType(str, Enum):
    task = "task"
    reminder = "reminder"
    note = "note"
    schedule = "schedule"


class TaskContent(StrictModel):
    entity_type: Literal[EntityType.task] = EntityType.task
    title: Title
    due_date: Optional[date] = None
    due_time: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    priority: Literal["low", "medium", "high"] = "medium"
    category: SafeText = "Other"
    notes: SafeText = ""
    completed: bool = False
    estimated_minutes: int = Field(default=30, ge=5, le=1440)


class ReminderContent(StrictModel):
    entity_type: Literal[EntityType.reminder] = EntityType.reminder
    title: Title
    date: date
    time: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    notes: SafeText = ""
    completed: bool = False


class AttachmentText(StrictModel):
    attachment_id: RecordId
    filename: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    text: SafeText
    approved_for_ai: bool = False


class NoteContent(StrictModel):
    entity_type: Literal[EntityType.note] = EntityType.note
    title: Title
    body: SafeText = ""
    tag_ids: List[RecordId] = Field(default_factory=list, max_length=100)
    attachments: List[AttachmentText] = Field(default_factory=list, max_length=20)


class ScheduleContent(StrictModel):
    entity_type: Literal[EntityType.schedule] = EntityType.schedule
    title: Title
    starts_at: datetime
    ends_at: datetime
    notes: SafeText = ""

    @model_validator(mode="after")
    def ends_after_start(self) -> "ScheduleContent":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


PlannerContent = Union[TaskContent, ReminderContent, NoteContent, ScheduleContent]


class RecordUpsertRequest(StrictModel):
    content: PlannerContent = Field(discriminator="entity_type")
    expected_revision: Optional[int] = Field(default=None, ge=0)
    idempotency_key: IdempotencyKey
    approved_for_ai: bool = False


class RecordDeleteRequest(StrictModel):
    expected_revision: int = Field(ge=1)
    idempotency_key: IdempotencyKey


class PlannerRecord(StrictModel):
    record_id: RecordId
    revision: int = Field(ge=1)
    content: PlannerContent = Field(discriminator="entity_type")
    approved_for_ai: bool
    created_at: datetime
    updated_at: datetime


class MigrationItem(StrictModel):
    legacy_key: Annotated[str, StringConstraints(pattern=r"^nw_[a-z_]+$")]
    legacy_id: Union[str, int]
    content: PlannerContent = Field(discriminator="entity_type")
    approved_for_ai: bool = False


class MigrationRequest(StrictModel):
    migration_id: IdempotencyKey
    items: List[MigrationItem] = Field(max_length=5000)


class MigrationResult(StrictModel):
    migration_id: str
    imported: int
    skipped: int
    record_ids: List[str]


class PrivacySettings(StrictModel):
    # The assistant is on by default, so a new planner works without configuration.
    # This is a deliberate product decision, not an oversight: record text is sent
    # to the configured provider, and the deployed tier trains on prompts, so the
    # Settings screen states the provider and that fact, and every record carries
    # its own opt-out.
    ai_enabled: bool = True
    indexed_entity_types: List[EntityType] = Field(
        default_factory=lambda: [
            EntityType.task, EntityType.reminder, EntityType.note, EntityType.schedule,
        ]
    )
    index_attachments: bool = False
    retain_chat: bool = False
    chat_retention_days: int = Field(default=0, ge=0, le=365)


class AiProviderInfo(StrictModel):
    """Read-only description of who processes approved records, so the client can
    tell the user accurately instead of hardcoding a provider name."""

    provider: str
    model: str
    trains_on_prompts: bool


class PlannerSettings(StrictModel):
    """Per-user planner tuning. `max_daily_minutes` of None means "defer to the
    deployment default", so a user who never touches it follows the service."""

    max_daily_minutes: Optional[int] = Field(default=None, ge=15, le=1440)


class IndexRequest(StrictModel):
    approved: Literal[True]
    expected_revision: int = Field(ge=1)


class Citation(StrictModel):
    citation_id: str
    entity_type: EntityType
    record_id: str
    revision: int
    title: str
    excerpt: str


class RetrievalDisclosure(StrictModel):
    attempted: bool
    result_count: int
    entity_types: List[EntityType]
    abstained: bool
    reason: Optional[str] = None


class ProposalOperation(str, Enum):
    create = "create"
    delete = "delete"
    complete = "complete"
    reschedule = "reschedule"
    update = "update"


class ActionProposal(StrictModel):
    proposal_id: str
    operation: ProposalOperation
    entity_type: EntityType
    record_id: Optional[str] = None
    base_revision: Optional[int] = Field(default=None, ge=1)
    before: Optional[PlannerContent] = Field(default=None, discriminator="entity_type")
    after: Optional[PlannerContent] = Field(default=None, discriminator="entity_type")
    rationale: str
    status: Literal["pending", "confirmed", "rejected", "cancelled", "failed"] = "pending"
    created_at: datetime
    expires_at: datetime


class ChatTurn(StrictModel):
    """One earlier message in the same conversation."""

    role: Literal["user", "assistant"]
    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]


class ChatRequest(StrictModel):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)]
    request_id: IdempotencyKey
    timezone: Annotated[str, StringConstraints(min_length=1, max_length=100)] = "UTC"
    # Sent by the client rather than kept server-side, so a conversation works
    # without turning on chat retention. Capped because the whole thing is
    # replayed into the prompt on every turn.
    history: List[ChatTurn] = Field(default_factory=list, max_length=20)


class ChatResponse(StrictModel):
    answer: str
    citations: List[Citation]
    retrieval: RetrievalDisclosure
    proposals: List[ActionProposal] = Field(default_factory=list)


class ConfirmProposalRequest(StrictModel):
    idempotency_key: IdempotencyKey
    expected_base_revision: Optional[int] = Field(default=None, ge=1)


class RejectProposalRequest(StrictModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""


class DeterministicRecommendation(StrictModel):
    kind: Literal["deadline", "overload", "conflict", "priority", "reschedule"]
    record_ids: List[str]
    severity: Literal["info", "warning", "critical"]
    rule_id: str
    facts: Dict[str, Any]
    suggested_operation: Optional[ProposalOperation] = None


class AuditEvent(StrictModel):
    event_id: str
    uid_hash: str
    event_type: Literal[
        "indexing", "retrieval", "generation", "mcp_access", "proposal_created",
        "proposal_confirmed", "proposal_rejected", "failure", "privacy_changed", "deletion",
        "rate_limited",
    ]
    outcome: Literal["success", "denied", "failed", "abstained"]
    occurred_at: datetime
    metadata: Dict[str, Union[str, int, bool]] = Field(default_factory=dict)

