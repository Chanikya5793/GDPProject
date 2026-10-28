# Snapshot of Northwest Planner content/record contracts. Verified by contract tests.
from datetime import date, datetime, timezone
from enum import Enum
from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

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


class RecurrenceRule(StrictModel):
    """How often a series repeats, and how many times.

    Bounded by a count rather than an end date because a series is written out
    as real records, so the number of them is the thing that has to stay sane.
    """

    frequency: Literal["daily", "weekly", "monthly"]
    interval: int = Field(default=1, ge=1, le=30)
    count: int = Field(ge=1, le=60)


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
    # "Leave this one where I put it." Auto-balance pulls crowded work onto
    # earlier days and the deadline rule nudges a near date up to high priority;
    # both are usually welcome and occasionally wrong, for the appointment that
    # cannot move or the long read that is deliberately last. False keeps
    # today's behaviour for every record that predates the field.
    keep_scheduled: bool = False
    # Set on every record of a repeat. The id ties the series together so it can
    # be found and removed as one; the rule rides along on each record so a row
    # can say what it is without loading its siblings.
    series_id: Optional[RecordId] = None
    recurrence: Optional[RecurrenceRule] = None


class ReminderContent(StrictModel):
    entity_type: Literal[EntityType.reminder] = EntityType.reminder
    title: Title
    date: date
    time: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    notes: SafeText = ""
    completed: bool = False
    series_id: Optional[RecordId] = None
    recurrence: Optional[RecurrenceRule] = None


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

    @field_validator("starts_at", "ends_at")
    @classmethod
    def aware(cls, value: datetime) -> datetime:
        """Pin every timestamp to UTC.

        A naive and an aware datetime cannot be compared: one of each in the
        same block, or across two stored blocks, raised TypeError out of the
        validator below and out of the planner's sort, which neither pydantic
        nor the API maps to anything but a 500. A bare timestamp is taken as
        UTC, which is what every client sends anyway.
        """
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

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
