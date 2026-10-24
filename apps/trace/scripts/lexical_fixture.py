"""Writes src/engine/fixtures/lexical.json from the backend's own code, so the
browser port in src/engine/copilot.js can be checked for exact parity.

Run from the repository root:
  backend/.venv312/bin/python apps/trace/scripts/lexical_fixture.py
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))

from app.local_embeddings import LocalEmbeddingClient, _tokens, has_lexical_overlap  # noqa: E402
from app.models import NoteContent, ReminderContent, TaskContent  # noqa: E402

client = LocalEmbeddingClient()
TEXTS = [
    "Move my call advisor reminder to October 20 at 11 AM.",
    "What is due this week for the GDP report?",
    "Straße café naïve ﬁnal résumé 2026-10-20 C++ e-mail",
    "please show me what i have to do",
    "Call advisor call advisor CALL",
]


def sparse(vector):
    return {str(i): round(v, 12) for i, v in enumerate(vector) if v}


class _Record:
    def __init__(self, content):
        self.content = content


def record_text(content):
    from app.tools import record_text as rt

    return rt(_Record(content))


records = [
    {"type": "task", "title": "Submit GDP report", "notes": "Upload the team progress report",
     "dueDate": "2026-10-23", "dueTime": "17:00", "priority": "high", "category": "School", "completed": False,
     "content": TaskContent(title="Submit GDP report", notes="Upload the team progress report",
                            due_date="2026-10-23", due_time="17:00", priority="high", category="School")},
    {"type": "note", "title": "Advisor meeting", "body": "Ask about spring registration and the GDP timeline.",
     "content": NoteContent(title="Advisor meeting", body="Ask about spring registration and the GDP timeline.")},
    {"type": "reminder", "title": "Call advisor", "date": "2026-10-20", "time": "11:00", "notes": "",
     "content": ReminderContent(title="Call advisor", date="2026-10-20", time="11:00")},
]

out = {
    "texts": [
        {"text": t, "tokens": _tokens(t), "query": sparse(client.embed_query(t))} for t in TEXTS
    ],
    "records": [],
}
for r in records:
    text = record_text(r["content"])
    out["records"].append({
        **{k: v for k, v in r.items() if k != "content"},
        "text": text,
        "document": sparse(client.embed_document(text, r["title"])),
        "overlap": {t: has_lexical_overlap(t, text) for t in TEXTS},
    })
target = pathlib.Path(__file__).resolve().parents[1] / "src/engine/fixtures/lexical.json"
target.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
print(f"wrote {target}")
