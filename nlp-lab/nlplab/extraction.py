import re
from datetime import timedelta
from zoneinfo import ZoneInfo

import dateparser

from .language import OPERATIONS, phrase_matches, quoted_ranges

DATE_PATTERN = re.compile(r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}(?:/\d{2,4})?|day after tomorrow|today|tomorrow|yesterday|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+\d+\s+(?:days?|weeks?|hours?|minutes?)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+\d{4})?)\b", re.I)
TIME_PATTERN = re.compile(r"\b(?:at\s+)?(?:(?:\d{1,2}(?::\d{2})?\s*(?:am|pm))|noon|midnight|(?:[01]?\d|2[0-3]):[0-5]\d|(?<=at\s)\d{1,2})\b", re.I)


def dates(text, reference, timezone, excluded):
    def usable(match):
        return not any(a <= match.start() < b for a, b in excluded)
    matches = [m for m in DATE_PATTERN.finditer(text) if usable(m)]
    times = [m for m in TIME_PATTERN.finditer(text) if usable(m) and not any(a.start() <= m.start() < a.end() for a in matches)]
    fields, evidence, reasons = {}, [], []
    local = reference.astimezone(ZoneInfo(timezone))
    if len(matches) > 1 or len(times) > 1:
        reasons.append("Multiple date/time expressions: specify a single intended date and time.")
    if matches:
        match = matches[0]
        phrase = match.group().lower()
        if "/" in phrase:
            reasons.append("Numeric date is ambiguous. Use YYYY-MM-DD or a month name.")
        else:
            parsed = None
            weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
            weekday = phrase.removeprefix("next ")
            if weekday in weekdays:
                delta = (weekdays.index(weekday) - local.weekday()) % 7
                if phrase.startswith("next "):
                    delta = delta or 7
                parsed = local + timedelta(days=delta)
            else:
                parsed = dateparser.parse(phrase, languages=["en"], settings={"RELATIVE_BASE": local.replace(tzinfo=None), "TIMEZONE": timezone, "RETURN_AS_TIMEZONE_AWARE": True, "PREFER_DATES_FROM": "future"})
            if parsed:
                fields["due_date"] = parsed.date().isoformat()
                if re.search(r"\b(hours?|minutes?)\b", phrase):
                    fields["due_time"] = parsed.strftime("%H:%M")
            else:
                reasons.append(f"Could not resolve date: {match.group()}")
        evidence.append({"field": "due_date", "rule_id": "date-expression", "start": match.start(), "end": match.end(), "text": match.group(), "value": fields.get("due_date"), "reference": local.isoformat()})
    if times:
        match = times[0]
        phrase = re.sub(r"^at\s+", "", match.group(), flags=re.I).strip()
        if re.fullmatch(r"\d{1,2}", phrase):
            reasons.append("Time needs AM/PM or an explicit 24-hour HH:MM value.")
        else:
            parsed = dateparser.parse(phrase, languages=["en"], settings={"RELATIVE_BASE": local.replace(tzinfo=None)})
            if parsed:
                fields["due_time"] = parsed.strftime("%H:%M")
            else:
                reasons.append(f"Could not resolve time: {phrase}")
        evidence.append({"field": "due_time", "rule_id": "time-expression", "start": match.start(), "end": match.end(), "text": match.group(), "value": fields.get("due_time")})
    # Detect impossible/malformed temporal input rather than silently dropping it.
    if re.search(r"\bat\s+\d{1,2}:\d{2}\b", text, re.I) and not times:
        reasons.append("Invalid time expression.")
    return fields, evidence, reasons


def extract(text, operation, entity, config, reference, timezone):
    fields, filters, evidence, reasons = {}, {}, [], []
    quotes = quoted_ranges(text)
    # Everything after a body delimiter is content, including dates and verbs.
    body = re.search(r"(?:\b(?:body|notes?|text)\s*(?:to\s+|:\s*)|(?<!\d):\s*)(.+)$", text, re.I)
    protected = list(quotes)
    if body:
        protected.append((body.start(1), body.end(1)))
    temporal, date_evidence, date_reasons = dates(text, reference, timezone, protected)
    reasons += date_reasons
    priority = None
    for match in re.finditer(r"\b(?:(low|medium|high|urgent|normal)\s+priority|priority\s+(?:to\s+)?(low|medium|high|urgent|normal))\b", text, re.I):
        if any(a <= match.start() < b for a, b in protected):
            continue
        priority = {"urgent": "high", "normal": "medium"}.get((match[1] or match[2]).lower(), (match[1] or match[2]).lower())
        evidence.append({"field": "priority", "rule_id": "priority-phrase", "start": match.start(), "end": match.end(), "text": match.group(), "value": priority})
    for rule in config.rules:
        if rule.kind == "priority":
            for match in phrase_matches(text, rule.phrase):
                if not any(a <= match.start() < b for a, b in protected):
                    priority = rule.value
                    evidence.append({"field": "priority", "rule_id": rule.id, "start": match.start(), "end": match.end(), "text": match.group(), "value": priority})
    if priority:
        (filters if operation == "find" else fields)["priority"] = priority
    if operation == "find":
        if "due_date" in temporal and date_evidence:
            before_date = text[:date_evidence[0]["start"]]
            relation = re.search(r"\b(before|after|by)\s*$", before_date, re.I)
            if relation:
                key={"before":"due_before","after":"due_after","by":"due_on_or_before"}[relation[1].lower()]
                temporal[key]=temporal.pop("due_date")
        filters.update(temporal)
        if re.search(r"\b(?:completed|done|finished)\b", text, re.I):
            filters["completed"] = True
        elif re.search(r"\b(?:open|incomplete|unfinished)\b", text, re.I):
            filters["completed"] = False
    elif entity != "note":
        fields.update(temporal)
    elif temporal:
        reasons.append("Notes have no date/time fields. Quote dates that belong in note text.")
    if body:
        value = body[1].strip().strip('"“”')
        fields["body" if entity == "note" else "notes"] = value
        evidence.append({"field": "body" if entity == "note" else "notes", "rule_id": "body-delimiter", "start": body.start(1), "end": body.end(1), "text": body[1], "value": value})

    # Slice off the command prefix and entity marker. These spans are used only
    # to delimit data; titles themselves retain their original spelling/case.
    operation_phrases = [p for phrases in OPERATIONS.values() for p in phrases] + [r.phrase for r in config.rules if r.kind == "operation"]
    entity_phrases = ["task", "reminder", "note", "todo", "to-do"] + [r.phrase for r in config.rules if r.kind == "entity"]
    prefix = re.compile(r"^\s*(?:(?:could|can|would)\s+you\s+|please\s+|i\s+need\s+)*(?:(?:" + "|".join(re.escape(p) for p in sorted(operation_phrases,key=len,reverse=True)) + r")\s+)?(?:(?:for|the|a|an|my|new|off)\s+)*(?:(?:" + "|".join(re.escape(p) for p in sorted(entity_phrases,key=len,reverse=True)) + r")s?\s+)?(?:(?:called|titled|named)\s+)?", re.I)
    start = prefix.match(text).end()
    # Special sentence forms: "Change the title of the task ...".
    special = re.match(r".*?\btitle\s+of\s+(?:the\s+|my\s+)?(?:task|reminder|note)\s+", text, re.I)
    if special:
        start = special.end()
    end = len(text)
    if body:
        end = min(end, body.start())
    for item in date_evidence + evidence:
        if item.get("field") in ("due_date", "due_time", "priority") and item["start"] >= start:
            end = min(end, item["start"])
    change = re.search(r"\s+(?:title\s+to|to)\s+(.+)$", text[start:end], re.I) if operation == "update" else None
    if change:
        target_end = start + change.start()
        value_start = start + change.start(1)
        value = text[value_start:end].strip().strip('"“”')
        fields["title"] = value
        evidence.append({"field": "title", "rule_id": "title-update", "start": value_start, "end": end, "text": text[value_start:end], "value": value})
        end = target_end
    elif operation == "update" and re.search(r"\btitle\s+to\b", text[start:], re.I):
        reasons.append("Provide the new title after 'title to'.")
    fragment = text[start:end]
    fragment = re.sub(r"(?:^|\s+)(?:(?:as\s+)?(?:done|completed)|(?:due|on|at|to|by|before|after|with|for|in))\s*$", "", fragment, flags=re.I)
    fragment = fragment.strip().strip('"“”').strip()
    if operation == "create" and re.match(r"\s*remind\s+me\s+to\b",text,re.I):
        fragment = re.sub(r"^to\s+", "", fragment, flags=re.I)
    if operation == "find":
        fragment = re.sub(r"^(?:(?:my|the|all|open|completed|done|finished|incomplete|unfinished)\s+)*(?:tasks?|reminders?|notes?)\b\s*", "", fragment, flags=re.I).strip()
    if operation == "find" and fragment.lower() in ("", "all", "all tasks", "all reminders", "all notes"):
        fragment = ""
    if operation == "update":
        fragment = re.sub(r"\s+(?:priority|body|notes?|title)(?:\s+to)?\s*$", "", fragment, flags=re.I).strip()
    target = None
    if operation == "create":
        if fragment:
            fields["title"] = fragment
        if entity == "note":
            fields.setdefault("body", "")
    else:
        target = fragment or None
        if operation == "find" and target:
            filters["query"] = target
    if fragment:
        location = text.find(fragment, start)
        evidence.append({"field": "title" if operation == "create" else "target", "rule_id": "command-content", "start": location, "end": location+len(fragment), "text": fragment, "value": fragment})
    return fields, filters, target, evidence, date_evidence, reasons
