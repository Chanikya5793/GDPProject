"""Turning "every Friday" into the days it actually means.

The planner has no notion of a repeat, so the assistant faked one: it wrote a
single reminder with "Recurring weekly on Fridays" in its notes, which is not a
recurrence, it is one reminder with a sentence in it. A student would find that
out three weeks later.

A series here is real records, one per date, sharing a ``series_id``. That is
the shape everything else in the planner already understands: the briefing
buckets them, the workload rules count them, retrieval indexes them, and each
one can be completed or moved on its own without a per-occurrence exception
model. The cost is that a series is finite and has to be written out, which is
what ``MAX_OCCURRENCES`` and ``HORIZON_DAYS`` bound.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import List

from .models import RecurrenceRule

# One confirmation writes this many records at most. Weekly for a year is 52,
# so this covers a full academic year with room, while keeping a misread
# "every day forever" from turning into an unbounded write.
MAX_OCCURRENCES = 60

# Nothing is scheduled further out than this, whatever the count says. A
# planner that reaches into the year after next is noise, not planning.
HORIZON_DAYS = 400


def _add_months(start: date, months: int) -> date:
    """The same day-of-month, months later, clamped to a month that has it.

    The 31st of January repeated monthly has to land somewhere in February;
    the last day of the month is what a person means by it.
    """
    total = start.month - 1 + months
    year = start.year + total // 12
    month = total % 12 + 1
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))


def expand(rule: RecurrenceRule, start: date) -> List[date]:
    """Every date in the series, first occurrence included, in order.

    The first date is the one asked for, so "every Friday starting today"
    includes today rather than beginning a week late.
    """
    horizon = start + timedelta(days=HORIZON_DAYS)
    dates: List[date] = []
    for index in range(min(rule.count, MAX_OCCURRENCES)):
        if rule.frequency == "daily":
            occurrence = start + timedelta(days=index * rule.interval)
        elif rule.frequency == "weekly":
            occurrence = start + timedelta(weeks=index * rule.interval)
        else:
            occurrence = _add_months(start, index * rule.interval)
        if occurrence > horizon:
            break
        dates.append(occurrence)
    return dates


def describe(rule: RecurrenceRule) -> str:
    """The rule as a person says it, for a preview the student has to judge."""
    every = {
        "daily": "day", "weekly": "week", "monthly": "month",
    }[rule.frequency]
    cadence = f"every {every}" if rule.interval == 1 else f"every {rule.interval} {every}s"
    return f"{cadence}, {rule.count} times"
