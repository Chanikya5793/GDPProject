# Northwest Planner secure copilot

GDPProject is an offline-capable planner with Firebase Authentication, encrypted web and
mobile storage, and a user-scoped FastAPI RAG copilot. Planner mutations remain ordinary
deterministic application operations: Gemini may explain records and produce a typed
proposal, but only an explicit confirmation with the previewed revision can apply it.

## Architecture

- React/Vite web and Expo 56 mobile clients obtain Firebase ID tokens and call the same API.
- Web offline data uses non-extractable AES-GCM keys in IndexedDB; mobile uses
  XChaCha20-Poly1305 with a 256-bit key held by Expo SecureStore.
- FastAPI validates strict Pydantic contracts and derives UID only from the verified token.
- Firestore payloads use per-user AES-256-GCM DEKs wrapped by Cloud KMS. Record coordinates
  and revision are authenticated as additional data.
- Vertex `gemini-embedding-001` embeddings are stored without plaintext in Firestore vector
  documents. Every KNN query has a mandatory UID prefilter.
- Gemini 2.5 Flash receives only approved retrieved records inside explicit untrusted-data
  boundaries. Responses must cite retrieved record IDs/revisions or abstain.
- Six read-only JSON-RPC MCP tools use an authenticated, UID-bound signed session. UID is
  never a tool argument.

## Local setup

Copy `.env.example`, `backend/.env.example`, and `mobile/.env.example` to their untracked
`.env` counterparts and fill them with one dedicated Firebase/GCP project. Use Application
Default Credentials with the least-privilege permissions in `docs/OPERATIONS.md`.

```sh
npm ci
npm run dev

cd backend
python3.12 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/uvicorn app.main:app --reload

cd ../mobile
npm ci
npm run start
```

The legacy `nw_tasks`, `nw_reminders`, and `nw_notes` localStorage values are not silently
uploaded. After login, the web UI shows an explicit migration preview/action. Stable IDs
and idempotency keys make retry safe, and plaintext legacy keys are removed only after the
server accepts the migration.

## Verification

```sh
npm run test:coverage
npm run build
mobile/node_modules/.bin/tsc --noEmit -p mobile/tsconfig.json
cd backend && .venv/bin/ruff check app tests evals
cd backend && .venv/bin/pytest --cov=app --cov-branch --cov-report=term
cd backend && .venv/bin/python evals/run_eval.py
```

The versioned evaluation has 30 retrieval/abstention/action queries and includes a second
UID corpus. `RESUME_EVIDENCE.md` records measured local results and clearly separates them
from live Vertex, Cloud Run, web-browser, simulator, and physical-device validation.

Deployment and rollback procedures are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

---

Built by **Chanakya Thotakura** — [chanakyachowdary.in](https://chanakyachowdary.in) · [Case study](https://chanakyachowdary.in/#/work/northwest-planner)
