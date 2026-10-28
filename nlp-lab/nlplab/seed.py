"""Deterministic synthetic bootstrap corpus; never presented as human-reviewed data."""
from datetime import datetime, timezone

REFERENCE = "2026-10-27T12:00:00-05:00"
TITLES = ["Chemistry report", "Pay rent", "Buy groceries", "Read chapter seven", "Advisor meeting"]
OPERATIONS = {
    "create": ["Create a {e} called {t}{d}", "Add a {e} titled {t}{d}", "Please create a {e} named {t}{d}", "Make a {e} called {t}{d}", "Can you add a {e} titled {t}{d}", "I need a {e} called {t}{d}", "Please add a new {e} named {t}{d}", "Could you create a {e} titled {t}{d}"],
    "find": ["Find the {e} {t}", "Show my {e} {t}", "Search for the {e} {t}", "Look up the {e} {t}", "Please find my {e} {t}", "Can you show the {e} {t}", "Locate the {e} {t}", "Could you find the {e} {t}"],
    "update": ["Update the {e} {t} title to Revised {t}", "Rename the {e} {t} to Revised {t}", "Please update my {e} {t} title to Revised {t}", "Change the title of the {e} {t} to Revised {t}", "Can you rename my {e} {t} to Revised {t}", "Edit the {e} {t} title to Revised {t}", "Set the {e} {t} title to Revised {t}", "Could you update the {e} {t} title to Revised {t}"],
    "delete": ["Delete the {e} {t}", "Remove my {e} {t}", "Please delete the {e} {t}", "Erase the {e} {t}", "Can you remove the {e} {t}", "Discard my {e} {t}", "Please erase the {e} {t}", "Could you delete my {e} {t}"],
    "complete": ["Complete the {e} {t}", "Finish my {e} {t}", "Mark the {e} {t} as done", "Mark my {e} {t} completed", "Please complete the {e} {t}", "Can you finish the {e} {t}", "Check off my {e} {t}", "Could you complete the {e} {t}"],
    "reschedule": ["Reschedule the {e} {t}{d}", "Move my {e} {t}{d}", "Postpone the {e} {t}{d}", "Please reschedule my {e} {t}{d}", "Can you move the {e} {t}{d}", "Shift my {e} {t}{d}", "Please postpone the {e} {t}{d}", "Could you reschedule the {e} {t}{d}"],
}


def sample_records():
    records = []
    for entity in ("task", "reminder", "note"):
        for i, title in enumerate(TITLES):
            content = {"entity_type": entity, "title": title}
            if entity == "task":
                content.update(due_date="2026-10-30", due_time="15:00", priority="medium", notes="Original details", category="Study", completed=False, estimated_minutes=45, keep_scheduled=False)
            elif entity == "reminder":
                content.update(date="2026-10-30", time="15:00", notes="Original details", completed=False)
            else:
                content.update(body="Original note content", tag_ids=["study"], attachments=[])
            records.append({"record_id": f"{entity}-{i+1}", "revision": 3, "content": content, "approved_for_ai": False, "created_at": "2026-10-01T12:00:00Z", "updated_at": "2026-10-20T12:00:00Z"})
    return records


def seed_examples():
    rows = []
    for op, templates in OPERATIONS.items():
        for entity in ("task", "reminder", "note"):
            if entity == "note" and op in ("complete", "reschedule"):
                continue
            for family, template in enumerate(templates):
                for i, title in enumerate(TITLES):
                    date_phrase = " tomorrow at 3pm" if entity != "note" and op in ("create", "reschedule") else ""
                    text = template.format(e=entity, t=title, d=date_phrase)
                    # Include a limited, explicit set of typo variants without altering names.
                    if family == 6:
                        text = text.replace("create", "cretae").replace("delete", "delte").replace("reschedule", "reshedule")
                    fields = {}
                    if op == "create":
                        fields["title"] = title
                        if entity == "note":
                            fields["body"] = ""
                    if op == "update":
                        fields["title"] = "Revised " + title
                    if date_phrase:
                        fields.update(due_date="2026-10-28", due_time="15:00")
                    target = title if op != "create" else None
                    spans = [{"field": "title" if op == "create" else "target", "start": text.index(title), "end": text.index(title) + len(title), "text": title}]
                    if date_phrase:
                        at = text.index("tomorrow")
                        spans.append({"field": "date", "start": at, "end": at + 8, "text": "tomorrow"})
                    rows.append({"id": f"seed-{op}-{entity}-{family}-{i}", "text": text, "operation": op, "entity_type": entity, "fields": fields, "filters": {}, "target": target, "spans": spans, "expected_status": "ready", "reference_datetime": REFERENCE, "timezone": "America/Chicago", "dataset_id": "sample", "selected_record_id": None, "family": f"{op}-{entity}-pattern-{family}", "split": "test" if family == 7 else "validation" if family == 6 else "train", "approved": True, "origin": "synthetic-template", "human_reviewed": False})
    negatives = [
        ("Don't delete the task {t}", "delete", "task", "needs_clarification"),
        ("Do not complete the reminder {t}", "complete", "reminder", "needs_clarification"),
        ("Create a reminder called {t}", "create", "reminder", "needs_clarification"),
        ("Reschedule the task {t}", "reschedule", "task", "needs_clarification"),
        ("Complete the note {t}", "complete", "note", "unsupported"),
        ("Move the note {t} tomorrow", "reschedule", "note", "unsupported"),
        ("Delete the task {t} and create a note called Budget", "delete", "task", "needs_clarification"),
        ("Repeat the task {t} every week", "unsupported", "task", "unsupported"),
    ]
    unrelated = ["What is the weather in Lisbon?", "Who won the hockey championship?", "Book a flight to Nairobi", "Tell me a joke", "Send an email to Alex", "Explain quantum gravity", "Play some music", "Translate this paragraph"]
    for group in range(4):
        split = ["train", "train", "validation", "test"][group]
        for i, title in enumerate(TITLES):
            for j, (template, op, entity, status) in enumerate(negatives):
                # 4 groups * 5 titles * 8 patterns = 160 safety cases. A family
                # stays entirely in one split, even when wording is identical.
                if group >= 2 and j >= 4:
                    text, op, entity, status = unrelated[j-4 + (group-2)*4], "unsupported", None, "unsupported"
                else:
                    text = template.format(t=title)
                rows.append({"id": f"negative-{group}-{i}-{j}", "text": text, "operation": op, "entity_type": entity, "fields": {}, "filters": {}, "target": None, "spans": [], "expected_status": status, "reference_datetime": REFERENCE, "timezone": "America/Chicago", "dataset_id": "sample", "family": f"safety-{j}" if j < 4 else f"safety-{j}-{group}", "split": "train" if j < 4 else split, "approved": True, "origin": "synthetic-template", "human_reviewed": False})
    # Deduplicate equal utterances so no train/test text overlap is possible.
    # Replace duplicate safety rows with distinct out-of-domain commands.
    seen = set()
    for n, row in enumerate(rows):
        if row["text"].lower() in seen:
            row.update(text=f"Explain unrelated topic number {n} about {TITLES[n % 5]}", operation="unsupported", entity_type=None, fields={}, target=None, spans=[], expected_status="unsupported", family=f"unrelated-{n // 5}-{row['split']}")
        seen.add(row["text"].lower())
        if row["operation"] == "find":
            row["filters"] = {"query": row["target"]}
    assert len(rows) == 800
    return rows
