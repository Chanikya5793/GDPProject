from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

Operation = Literal["create", "find", "update", "complete", "reschedule", "delete", "unsupported"]
Entity = Literal["task", "reminder", "note"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Rule(Strict):
    id: str = Field(pattern=r"^[a-z0-9_-]{1,60}$")
    kind: Literal["operation", "entity", "priority", "abbreviation"]
    # Literal phrases only: the UI never executes Python or user-supplied regex.
    phrase: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=100)

    @field_validator("phrase")
    @classmethod
    def nonempty_phrase(cls, value):
        if not value.strip():
            raise ValueError("Phrase must contain text")
        return value.strip().lower()


class Configuration(Strict):
    name: str = Field(default="Default hybrid", min_length=1, max_length=100)
    mode: Literal["rules", "model", "hybrid"] = "hybrid"
    classifier: Literal["logistic", "naive_bayes", "svm"] = "logistic"
    min_confidence: float = Field(default=0.70, ge=0.5, le=1)
    min_margin: float = Field(default=0.15, ge=0, le=1)
    rules: list[Rule] = Field(default_factory=list, max_length=200)

    @field_validator("rules")
    @classmethod
    def valid_rules(cls, rules):
        ids = set()
        allowed = {
            "operation": {"create", "find", "update", "complete", "reschedule", "delete"},
            "entity": {"task", "reminder", "note"},
            "priority": {"low", "medium", "high"},
        }
        for rule in rules:
            if rule.id in ids:
                raise ValueError("Rule IDs must be unique")
            ids.add(rule.id)
            if rule.kind == "abbreviation" and any(char.isspace() for char in rule.phrase):
                raise ValueError("An abbreviation phrase must be a single token")
            if rule.kind in allowed and rule.value not in allowed[rule.kind]:
                raise ValueError(f"Invalid value for {rule.kind}")
        return rules


class AnalyzeRequest(Strict):
    text: str = Field(min_length=1, max_length=4000)
    reference_datetime: datetime
    timezone: str = "America/Chicago"
    dataset_id: str = "sample"
    configuration_id: str | None = None
    configuration: Configuration | None = None
    selected_record_id: str | None = None
    model_id: str | None = None

    @field_validator("text")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Request must contain text")
        return value

    @field_validator("reference_datetime")
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Reference datetime must include a UTC offset")
        return value

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Unknown IANA timezone")
        return value


class Command(Strict):
    operation: Operation
    entity_type: Entity | None = None
    target: str | None = None
    record_id: str | None = None
    fields: dict[str, Any] = Field(default_factory=dict)
    filters: dict[str, Any] = Field(default_factory=dict)


class Stage(Strict):
    id: str
    label: str
    status: Literal["completed", "warning", "skipped", "failed"] = "completed"
    input: Any = None
    output: Any = None
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    elapsed_ms: float = 0


class Correction(Strict):
    run_id: str
    operation: Operation
    entity_type: Entity | None = None
    fields: dict[str, Any] = Field(default_factory=dict)
    filters: dict[str, Any] = Field(default_factory=dict)
    target: str | None = None
    spans: list[dict[str, Any]] = Field(default_factory=list)
    expected_status: Literal["ready", "needs_clarification", "unsupported"] = "ready"
    approved: bool = True
    family: str | None = Field(default=None, max_length=100)


class TrainRequest(Strict):
    name: str = Field(default="Reviewed corpus experiment", min_length=1, max_length=100)


class SnapshotImport(Strict):
    name: str = Field(min_length=1, max_length=100)
    records: list[dict[str, Any]] = Field(max_length=5000)
