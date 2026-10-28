import hashlib
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .schemas import Configuration
from .seed import sample_records, seed_examples


def uid(prefix):
    return prefix + "-" + uuid.uuid4().hex


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()[:16]


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.models_dir = self.root / "models"
        self.models_dir.mkdir(exist_ok=True)
        self.path = self.root / "lab.sqlite3"
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS items (kind TEXT, id TEXT, data TEXT NOT NULL, PRIMARY KEY(kind,id))")
            db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        if not self.get("datasets", "sample"):
            self.put("datasets", "sample", {"id": "sample", "name": "Sample planner", "version": "sample-v1", "records": sample_records()})
        if not self.setting("seed_version"):
            with self.connect() as db:
                db.executemany("INSERT OR IGNORE INTO items VALUES ('examples',?,?)", [(row["id"], json.dumps(row)) for row in seed_examples()])
            self.set_setting("seed_version", "synthetic-v1")
        if not self.setting("active_config"):
            config = {"id": "config-default", "created_at": now(), **Configuration().model_dump()}
            self.put("configs", config["id"], config)
            self.set_setting("active_config", config["id"])

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            with db:
                yield db
        finally:
            db.close()

    def put(self, kind, key, data):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO items VALUES (?,?,?)", (kind, key, json.dumps(data, default=str)))
        return data

    def get(self, kind, key):
        with self.connect() as db:
            row = db.execute("SELECT data FROM items WHERE kind=? AND id=?", (kind, key)).fetchone()
        return json.loads(row[0]) if row else None

    def all(self, kind):
        with self.connect() as db:
            rows = db.execute("SELECT data FROM items WHERE kind=? ORDER BY rowid DESC", (kind,)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def setting(self, key):
        with self.connect() as db:
            row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def set_setting(self, key, value):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, value))

    def configuration(self, config_id=None):
        row = self.get("configs", config_id or self.setting("active_config"))
        if not row:
            raise KeyError("Configuration not found")
        return Configuration.model_validate({key: value for key, value in row.items() if key not in ("id", "created_at")}), row["id"]

    def dataset_version(self):
        return digest(sorted(self.all("examples"), key=lambda row: row["id"]))
