"""Read-only planner views the assistant can ask for on its own.

Semantic retrieval answers one shape of question: "what did I write about the
chemistry exam". It cannot answer the shapes students actually ask most often.
"What is due today", "how many things am I behind on", "what does my week look
like" are date and count questions, and cosine similarity over five records can
neither count nor filter by day. The assistant used to get those five records
and nothing else, so it either guessed or abstained.

These tools give it the structured views those questions need. Two things keep
them honest. Every record they touch goes through the same privacy gate
retrieval uses -- the assistant is off entirely when the student opted out, an
entity type it was not told to index is invisible, and a record with its own
approval switch off is skipped -- and every record handed to the model is
registered here first, so it comes back with a citation ID the answer can be
checked against.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Protocol, Tuple

from .ai import ToolRequest
from .audit import AuditLogger
from .injection import assess_untrusted_text, safe_excerpt
from .models import (
    Citation,
    EntityType,
    NoteContent,
    PlannerRecord,
    ReminderContent,
    ScheduleContent,
    TaskContent,
)
from .planner import PlannerEngine
from .repository import PlannerRepository


def record_text(record: PlannerRecord, include_attachments: bool = False) -> str:
    """The flat text of a record, as indexed and as quoted back to the model."""
    content = record.content
    parts = [content.title]
    if isinstance(content, TaskContent):
        parts.extend([
            content.notes, f"Due {content.due_date or 'unscheduled'} {content.due_time or ''}",
            f"Priority {content.priority}", f"Category {content.category}",
            "Completed" if content.completed else "Open",
        ])
    elif isinstance(content, NoteContent):
        parts.append(content.body)
        if include_attachments:
            parts.extend(a.text for a in content.attachments if a.approved_for_ai)
    else:
        parts.append(content.model_dump_json(exclude={"entity_type", "title"}))
    return "\n".join(part for part in parts if part)


class RecordSearch(Protocol):
    """Semantic retrieval, as the toolbox needs it. Declared structurally so
    this module does not have to import the service that implements it."""

    def retrieve(self, uid: str, query: str) -> Tuple[List[PlannerRecord], List[Citation]]: ...


# How far "the week ahead" reaches. Past this the briefing stops volunteering
# things, because a student asking what is coming up does not mean next month.
HORIZON_DAYS = 7

# The whole briefing is rebuilt on every turn and travels in the prompt, so it
# is capped. A planner with three hundred open tasks would otherwise crowd out
# the question itself.
DEFAULT_BRIEFING_ITEMS = 40


@dataclass
class ToolOutcome:
    """One tool run: what to show the student, and what the model gets."""

    tool: str
    label: str
    payload: Dict[str, Any]


class Evidence:
    """Hands out the citation IDs for one turn.

    A record cited from the briefing and again from a search has to keep the
    same ID, otherwise the same task appears twice under two names and the
    answer reads as though it found two.
    """

    def __init__(self) -> None:
        self._ids: Dict[Tuple[EntityType, str], str] = {}
        self._citations: List[Citation] = []

    def register(self, record: PlannerRecord, text: str) -> str:
        key = (record.content.entity_type, record.record_id)
        existing = self._ids.get(key)
        if existing:
            return existing
        citation_id = f"S{len(self._citations) + 1}"
        self._ids[key] = citation_id
        self._citations.append(Citation(
            citation_id=citation_id, entity_type=record.content.entity_type,
            record_id=record.record_id, revision=record.revision,
            title=record.content.title, excerpt=safe_excerpt(text),
        ))
        return citation_id

    @property
    def citations(self) -> List[Citation]:
        return list(self._citations)


def _due_date(record: PlannerRecord) -> Optional[date]:
    """The day a record lands on, whatever its type calls that field."""
    content = record.content
    if isinstance(content, TaskContent):
        return content.due_date
    if isinstance(content, ReminderContent):
        return content.date
    if isinstance(content, ScheduleContent):
        return content.starts_at.date()
    return None


def _is_open(record: PlannerRecord) -> bool:
    content = record.content
    return not getattr(content, "completed", False)


class PlannerSession:
    """One turn's privacy-filtered view of a student's planner.

    Built per request rather than per user: the records are read once and then
    shared by the briefing and by every tool the assistant calls, so a
    three-step answer still costs one read of each collection.
    """

    def __init__(
        self, toolbox: "PlannerToolbox", uid: str, today: date, briefing_items: int,
    ):
        self.toolbox = toolbox
        self.uid = uid
        self.today = today
        self.briefing_items = briefing_items
        self.evidence = Evidence()
        # Citations that came from semantic search specifically. The abstain
        # guard keys off these rather than off everything on offer: the
        # briefing is volunteered, so its presence must not turn a general
        # planning question into a refusal.
        self.search_citation_ids: List[str] = []
        self.settings = toolbox.repository.get_privacy(uid)
        if not self.settings.ai_enabled:
            toolbox.audit.record(uid, "retrieval", "denied", {"reason": "opt_out"})
            raise PermissionError("AI is disabled")
        self._records: Optional[List[PlannerRecord]] = None

    @property
    def records(self) -> List[PlannerRecord]:
        """Every record the assistant is allowed to see, read once per turn."""
        if self._records is None:
            visible: List[PlannerRecord] = []
            for entity_type in self.settings.indexed_entity_types:
                visible.extend(
                    record for record in self.toolbox.repository.list_records(self.uid, entity_type)
                    if record.approved_for_ai
                )
            self._records = visible
        return self._records

    def cite(self, record: PlannerRecord) -> str:
        return self.evidence.register(record, record_text(record))

    def summarize(self, record: PlannerRecord) -> Dict[str, Any]:
        """A record as the model sees it: enough to answer with, and a way to cite it."""
        content = record.content
        item: Dict[str, Any] = {
            "citation_id": self.cite(record),
            "type": content.entity_type.value,
            "title": content.title,
        }
        if isinstance(content, TaskContent):
            item.update({
                "due_date": content.due_date.isoformat() if content.due_date else None,
                "due_time": content.due_time, "priority": content.priority,
                "category": content.category, "estimated_minutes": content.estimated_minutes,
                "status": "completed" if content.completed else "open",
            })
            if content.notes:
                item["notes"] = safe_excerpt(content.notes, 160)
        elif isinstance(content, ReminderContent):
            item.update({
                "due_date": content.date.isoformat(), "due_time": content.time,
                "status": "completed" if content.completed else "open",
            })
        elif isinstance(content, ScheduleContent):
            item.update({
                "starts_at": content.starts_at.isoformat(),
                "ends_at": content.ends_at.isoformat(),
            })
        elif isinstance(content, NoteContent):
            item["preview"] = safe_excerpt(content.body, 200)
        return item

    # ------------------------------------------------------------------
    # The briefing: computed every turn, before the model is asked anything.
    # ------------------------------------------------------------------

    def briefing(self) -> Dict[str, Any]:
        records = self.records
        tomorrow = self.today + timedelta(days=1)
        horizon = self.today + timedelta(days=HORIZON_DAYS)
        buckets: Dict[str, List[PlannerRecord]] = defaultdict(list)
        counts: Dict[str, int] = defaultdict(int)

        for record in records:
            content = record.content
            kind = content.entity_type.value
            counts[f"{kind}_total"] += 1
            if isinstance(content, (TaskContent, ReminderContent)):
                if content.completed:
                    counts[f"{kind}_completed"] += 1
                    continue
                counts[f"{kind}_open"] += 1
            day = _due_date(record)
            if isinstance(content, ScheduleContent):
                if self.today <= day <= horizon:  # type: ignore[operator]
                    buckets["schedule_ahead"].append(record)
                continue
            if isinstance(content, NoteContent):
                continue
            if day is None:
                buckets["unscheduled"].append(record)
            elif day < self.today:
                buckets["overdue"].append(record)
            elif day == self.today:
                buckets["due_today"].append(record)
            elif day == tomorrow:
                buckets["due_tomorrow"].append(record)
            elif day <= horizon:
                buckets["due_this_week"].append(record)
            else:
                buckets["due_later"].append(record)

        # Filled in order, so a truncated briefing loses "later" items rather
        # than the overdue ones the student most needs to hear about.
        order = [
            "overdue", "due_today", "due_tomorrow", "schedule_ahead",
            "due_this_week", "unscheduled", "due_later",
        ]
        remaining = self.briefing_items
        sections: Dict[str, List[Dict[str, Any]]] = {}
        truncated = False
        for name in order:
            entries = sorted(
                buckets.get(name, []),
                key=lambda record: (_due_date(record) or date.max, record.content.title),
            )
            if len(entries) > remaining:
                truncated = True
                entries = entries[:remaining]
            if entries:
                sections[name] = [self.summarize(record) for record in entries]
            remaining -= len(entries)
            if remaining <= 0:
                truncated = truncated or any(buckets.get(rest) for rest in order[order.index(name) + 1:])
                break

        capacity = self.toolbox.repository.get_planner_settings(self.uid).max_daily_minutes
        findings = self.toolbox.planner.analyze(
            records, today=self.today, max_daily_minutes=capacity
        )
        minutes_today = sum(
            record.content.estimated_minutes  # type: ignore[union-attr]
            for record in buckets.get("due_today", [])
            if isinstance(record.content, TaskContent)
        )
        briefing: Dict[str, Any] = {
            "today": self.today.isoformat(),
            "counts": dict(counts),
            "daily_capacity_minutes": self.toolbox.planner.capacity(capacity),
            "minutes_due_today": minutes_today,
            "findings": [finding.model_dump(mode="json") for finding in findings],
            **sections,
        }
        if truncated:
            briefing["truncated"] = (
                "Some records were left out to keep this short. Use the find or "
                "agenda tool for anything not listed here."
            )
        if not records:
            briefing["empty"] = "This planner has no records the assistant may read."
        return briefing

    # ------------------------------------------------------------------
    # Tools the assistant can ask for by name.
    # ------------------------------------------------------------------

    def run(self, request: ToolRequest) -> ToolOutcome:
        handler = {
            "search": self._search, "find": self._find, "agenda": self._agenda,
            "workload": self._workload, "open_day": self._open_day,
        }.get(request.tool)
        if handler is None:
            return ToolOutcome(
                tool=str(request.tool), label="Skipped an unknown lookup",
                payload={"error": f"There is no tool called {request.tool!r}."},
            )
        outcome = handler(request)
        self.toolbox.audit.record(self.uid, "tool_call", metadata={
            "tool": outcome.tool, "result_count": int(outcome.payload.get("count", 0)),
        })
        return outcome

    def _search(self, request: ToolRequest) -> ToolOutcome:
        query = (request.query or "").strip()
        if not query:
            return ToolOutcome("search", "Skipped a search with no terms",
                               {"error": "search needs a query.", "count": 0})
        records, _ = self.toolbox.retrieval.retrieve(self.uid, query)
        results = []
        for record in records:
            text = record_text(record)
            results.append({
                **self.summarize(record),
                "untrusted_content": text,
                "injection_suspected": assess_untrusted_text(text).suspicious,
            })
        self.search_citation_ids.extend(item["citation_id"] for item in results)
        return ToolOutcome(
            "search", f"Searched the planner for “{safe_excerpt(query, 60)}”",
            {"query": query, "count": len(results), "results": results},
        )

    def _find(self, request: ToolRequest) -> ToolOutcome:
        start, end = _parse_date(request.start), _parse_date(request.end)
        needle = (request.query or "").strip().lower()
        matches: List[PlannerRecord] = []
        for record in self.records:
            content = record.content
            if request.entity_type and content.entity_type != request.entity_type:
                continue
            if request.status == "open" and not _is_open(record):
                continue
            if request.status == "completed" and _is_open(record):
                continue
            if request.priority and getattr(content, "priority", None) != request.priority:
                continue
            day = _due_date(record)
            if (start or end) and day is None:
                continue
            if start and day and day < start:
                continue
            if end and day and day > end:
                continue
            if needle and needle not in _searchable_text(record).lower():
                continue
            matches.append(record)
        matches.sort(key=lambda record: (_due_date(record) or date.max, record.content.title))
        capped = matches[:50]
        return ToolOutcome(
            "find", _find_label(request, len(matches)),
            {
                "count": len(matches), "returned": len(capped),
                "results": [self.summarize(record) for record in capped],
            },
        )

    def _agenda(self, request: ToolRequest) -> ToolOutcome:
        start = _parse_date(request.start) or self.today
        end = _parse_date(request.end) or start + timedelta(days=HORIZON_DAYS)
        if end < start:
            start, end = end, start
        days: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        total = 0
        for record in self.records:
            day = _due_date(record)
            if day is None or not start <= day <= end:
                continue
            days[day.isoformat()].append(self.summarize(record))
            total += 1
        return ToolOutcome(
            "agenda",
            f"Read the calendar from {start.isoformat()} to {end.isoformat()}",
            {
                "start": start.isoformat(), "end": end.isoformat(), "count": total,
                "days": {key: days[key] for key in sorted(days)},
            },
        )

    def _workload(self, _request: ToolRequest) -> ToolOutcome:
        capacity = self.toolbox.repository.get_planner_settings(self.uid).max_daily_minutes
        findings = self.toolbox.planner.analyze(
            self.records, today=self.today, max_daily_minutes=capacity
        )
        # A finding names record IDs, not citation IDs, so anything it points at
        # is registered here; otherwise the model cannot cite what it reports.
        by_id = {record.record_id: record for record in self.records}
        cited = {}
        for finding in findings:
            for record_id in finding.record_ids:
                record = by_id.get(record_id)
                if record:
                    cited[record_id] = self.summarize(record)
        return ToolOutcome(
            "workload", f"Checked the workload rules ({len(findings)} finding(s))",
            {
                "count": len(findings),
                "capacity_minutes": self.toolbox.planner.capacity(capacity),
                "findings": [finding.model_dump(mode="json") for finding in findings],
                "records": list(cited.values()),
            },
        )

    def _open_day(self, request: ToolRequest) -> ToolOutcome:
        after = _parse_date(request.start) or self.today
        minutes = request.minutes or 30
        capacity = self.toolbox.repository.get_planner_settings(self.uid).max_daily_minutes
        try:
            day = self.toolbox.planner.next_available_day(
                self.records, after=after, required_minutes=minutes,
                max_daily_minutes=capacity,
            )
        except RuntimeError:
            return ToolOutcome(
                "open_day", "Looked for a free day and found none",
                {"count": 0, "error": "No day within a year has room for that."},
            )
        # The days it walked past, and what filled them. A bare date is a claim
        # about the student's planner that cites nothing, and the guard is right
        # to strike that out, so the tool hands back the evidence for its own
        # answer: which days were full, and with what.
        booked: Dict[date, List[PlannerRecord]] = defaultdict(list)
        for record in self.records:
            content = record.content
            if isinstance(content, TaskContent) and not content.completed and content.due_date:
                booked[content.due_date].append(record)
        considered = []
        cursor = after + timedelta(days=1)
        while cursor <= day:
            on_day = booked.get(cursor, [])
            considered.append({
                "date": cursor.isoformat(),
                "booked_minutes": sum(
                    r.content.estimated_minutes for r in on_day  # type: ignore[union-attr]
                ),
                "has_room": cursor == day,
                "records": [self.summarize(record) for record in on_day],
            })
            cursor += timedelta(days=1)
        return ToolOutcome(
            "open_day", f"Found the next day with room: {day.isoformat()}",
            {"count": 1, "after": after.isoformat(), "required_minutes": minutes,
             "capacity_minutes": self.toolbox.planner.capacity(capacity),
             "next_available_day": day.isoformat(), "days_considered": considered},
        )


def _searchable_text(record: PlannerRecord) -> str:
    content = record.content
    parts = [content.title, getattr(content, "notes", ""), getattr(content, "body", "")]
    return " ".join(part for part in parts if part)


def _parse_date(value: Optional[str]) -> Optional[date]:
    """A date from the model, or None. It writes whole datetimes into date
    fields and occasionally writes prose, and neither may reach the student as
    a 500."""
    text = (value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text.partition("T")[0])
    except ValueError:
        return None


def _find_label(request: ToolRequest, count: int) -> str:
    what = request.entity_type.value + "s" if request.entity_type else "records"
    if request.status == "open":
        what = f"open {what}"
    elif request.status == "completed":
        what = f"completed {what}"
    window = ""
    if request.start and request.end:
        window = f" between {request.start} and {request.end}"
    elif request.end:
        window = f" up to {request.end}"
    elif request.start:
        window = f" from {request.start}"
    return f"Looked through {what}{window} ({count} found)"


@dataclass
class PlannerToolbox:
    """Builds a per-turn session. Holds no user state of its own."""

    repository: PlannerRepository
    retrieval: RecordSearch
    planner: PlannerEngine
    audit: AuditLogger
    briefing_items: int = DEFAULT_BRIEFING_ITEMS

    def session(self, uid: str, today: date) -> PlannerSession:
        return PlannerSession(self, uid, today, self.briefing_items)
