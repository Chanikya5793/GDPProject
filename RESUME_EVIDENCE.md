# GDPProject secure copilot evidence

Recorded 2026-08-13 on branch `feature/secure-rag-copilot`. “Verified” below means
exercised in this checkout. It does not mean deployed or physically device-tested.

## Exact implemented architecture

1. React/Vite and Expo 56 use Firebase Authentication and send fresh Firebase ID tokens
   to one FastAPI API: `src/lib/firebase.js`, `src/context/AuthContext.jsx`,
   `src/api/client.js`, `mobile/lib/firebase.ts`, `mobile/contexts/AuthContext.tsx`, and
   `mobile/api/client.ts`.
2. FastAPI verifies revoked/expired tokens and derives UID server-side. Strict Pydantic
   models reject extra fields: `backend/app/auth.py`, `backend/app/models.py`, and
   `backend/app/api.py`.
3. Planner content is stored under `users/{uid}` as encrypted Firestore payloads;
   proposals and retained chats use the same envelope cipher: `backend/app/repository.py`
   and `backend/app/crypto.py`.
4. Approved records are embedded by Vertex AI `gemini-embedding-001`; embeddings plus
   record coordinates are stored in `planner_vectors`. Firestore KNN always prefilters by
   authenticated UID: `backend/app/ai.py`, `backend/app/rag.py`, and
   `backend/app/vector_store.py`.
5. Gemini 2.5 Flash receives retrieved records inside explicit untrusted-data boundaries
   and a separate deterministic rule result. A response with no valid retrieved citation
   abstains: `backend/app/injection.py`, `backend/app/planner.py`,
   `backend/app/ai.py`, and `backend/app/rag.py`.
6. Generated changes become typed, expiring proposals. Create, delete, complete, update,
   and reschedule operations show `before`/`after`, require explicit confirmation, verify
   the previewed revision, use idempotency keys, and atomically write the Firestore record
   mutation plus confirmed proposal state: `backend/app/proposals.py`,
   `backend/app/repository.py`, `src/context/AiContext.jsx`,
   `src/components/AiSidebar.jsx`, and `mobile/app/(tabs)/copilot.tsx`.
7. The MCP JSON-RPC endpoint exposes six read-only tools: tasks, reminders, note titles,
   calendar windows, workload summaries, and planner search. A Secret Manager-backed HMAC
   session binds UID and expiry; UID/user_id arguments are rejected: `backend/app/mcp_api.py`,
   `backend/app/api.py`, `backend/app/secrets.py`, and `backend/app/runtime.py`.

## Encryption and key management

- Cloud payloads use AES-256-GCM with UID, entity type, record ID, and revision as AAD.
  Each UID receives a random 256-bit DEK. Firestore stores only the Cloud KMS-wrapped DEK
  and key version; concurrent first-use key creation adopts the winning key:
  `backend/app/crypto.py` and `backend/tests/test_crypto.py`.
- Planner record, proposal, and retained-chat bodies are ciphertext. Operational metadata
  (UID, record coordinates, revision/status, approval, timestamps/expiry) remains visible
  to the server for authorization and lifecycle operations: `backend/app/repository.py`.
- Vector documents contain UID, record coordinates/revision, and embedding, never source
  plaintext: `backend/app/vector_store.py`.
- Web offline state uses AES-256-GCM and a per-UID non-extractable WebCrypto key persisted
  in IndexedDB; ciphertext is in localStorage: `src/security/cryptoStore.js` and
  `src/security/cryptoStore.test.js`.
- Mobile offline state uses XChaCha20-Poly1305. Its random 256-bit key is stored with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` in Expo SecureStore: `mobile/api/storage.ts` and
  `mobile/app.json`.
- The MCP signing secret must be a pinned numeric Secret Manager version; `latest` is
  rejected: `backend/app/secrets.py`, `backend/app/config.py`, and
  `backend/tests/test_auth_config.py`.

## Authentication and user-isolation proof

- No request model or MCP tool accepts an authority-bearing UID. CRUD, retrieval, vector
  deletion, proposals, chats, and MCP calls receive UID from `CurrentUser`:
  `backend/app/auth.py`, `backend/app/api.py`, and `backend/app/mcp_api.py`.
- Cross-UID record reads return not found; vector search prefilters UID and rejects any
  mismatched result; MCP sessions cannot be replayed by another UID:
  `backend/tests/test_api.py`, `backend/tests/test_rag.py`,
  `backend/tests/test_security.py`, and `backend/tests/test_mcp_tools.py`.
- Firestore client rules deny every direct read/write, forcing clients through verified
  FastAPI authorization: `firestore.rules`.
- Verified locally against in-memory contract adapters. Firebase Auth, Firestore rules,
  and the Firestore vector index were not exercised in a live GDP cloud project.

## Migration and privacy controls

- Web migration is explicit, stable-ID/idempotency based, defaults every imported record
  to not approved for AI, and removes plaintext legacy keys only after a successful server
  response: `src/components/MigrationBanner.jsx`,
  `src/migration/localStorageMigration.js`, and
  `src/migration/localStorageMigration.test.js`.
- Mobile migration copies sensitive AsyncStorage values into encrypted storage before
  deleting plaintext: `mobile/api/storage.ts` and `mobile/app/settings.tsx`.
- Users control global AI opt-out, indexed entity types, attachment text, chat retention,
  index deletion, and retained-chat deletion. Complete opt-out deletes vectors and retained
  chats; removing an entity type deletes that vector partition: `src/pages/Settings.jsx`,
  `backend/app/api.py`, `backend/app/vector_store.py`, and `backend/tests/test_api.py`.
- Only globally allowed entity types plus individually approved records can be indexed;
  attachment text needs both global and per-attachment approval: `backend/app/rag.py`,
  `backend/app/models.py`, and `src/pages/Notes.jsx`.

## Audit design

Indexing, retrieval, generation, MCP access, proposal creation/confirmation/rejection,
privacy changes, deletions, failures, and abstention outcomes are structured events.
They contain a salted UID hash and bounded metadata, never raw UID, email, prompts, or
planner text: `backend/app/audit.py`, `backend/app/models.py`, and
`backend/app/runtime.py`.

## Tests, coverage, and measured retrieval results

Commands executed in this checkout:

- Backend: `80 passed`; branch-aware total coverage `75.28%` with the configured 75% gate.
  Sources: `backend/pyproject.toml` and `backend/tests/`.
- Web: `9 passed`; measured aggregate imported-module coverage was 33.22% statements,
  19.31% branches, 38.04% functions, and 32.81% lines. Security storage measured 92.98%
  statements; migration measured 87.5%. Sources: `vite.config.js`,
  `src/security/cryptoStore.test.js`, `src/migration/localStorageMigration.test.js`, and
  `src/components/AiSidebar.test.jsx`.
- Lint: backend Ruff passed; web ESLint passed with zero errors and three existing React
  hook dependency warnings in Calendar/Dashboard.

Versioned evaluation source: `backend/evals/golden_v1.json`. Evaluator and immutable result:
`backend/evals/run_eval.py`, `backend/tests/test_evaluation.py`, and
`backend/evals/results_v1.json`.

| Metric | Measured result |
| --- | ---: |
| Queries | 30 |
| Answerable queries | 25 |
| Hit@1 | 1.0000 |
| Hit@3 | 1.0000 |
| Hit@5 | 1.0000 |
| MRR | 1.0000 |
| Citation validity | 1.0000 |
| Abstention accuracy | 1.0000 |
| Action-proposal validity | 1.0000 |
| Cross-user leakage | 0 records / 0.0000 |

These are deterministic offline contract-evaluation results over the versioned corpus,
not a live Vertex embedding quality claim. The production Vertex adapter and task types
are contract-tested in `backend/tests/test_ai_adapters.py`.

## Deployment and runtime status

- Implemented: non-root Python 3.12 image with health check (`backend/Dockerfile`), local
  composition (`compose.yaml`), Cloud Run service template
  (`infra/cloudrun/service.yaml.template`), least-privilege/Secret Manager/vector-index
  operations (`docs/OPERATIONS.md`), guarded deploy/rollback scripts (`scripts/deploy.sh`
  and `scripts/rollback.sh`), Firebase Hosting/deny-all Firestore configuration
  (`firebase.json` and `firestore.rules`), and CI (`.github/workflows/ci.yml`).
- Static validation passed for shell syntax, JSON, YAML, env contracts, and the application
  test/build commands.
- Not deployed: this checkout has no dedicated GDP Firebase/GCP target, `gcloud` is absent,
  and Docker is absent. No Cloud Run revision, Hosting release, live KMS ciphertext,
  Secret Manager access, Firestore vector index, or live Gemini response is claimed.

## Web and mobile validation status

- Web: ESLint zero errors, 9 tests passed, and Vite production build succeeded. The output
  emitted a 506.53 kB chunk warning. No configured Firebase account was available for a
  signed-in browser acceptance run.
- Mobile: Expo 56 TypeScript compiled with no errors and Metro produced a 4.6 MB iOS Hermes
  export from 1,659 modules. No simulator/physical-device login, SecureStore persistence,
  offline replay, or live copilot request was executed.
- Production dependency audit: web reports zero known vulnerabilities after non-breaking
  fixes. Mobile still reports 23 transitive Expo/Metro toolchain advisories (15 high,
  8 moderate); npm's suggested forced fixes downgrade Expo/React Native and were not used.

## Remaining unverified boundaries

1. Provision a dedicated GDP Firebase/GCP project, create the vector index/KMS key/secret,
   grant the documented service-account roles, and run the deployment and rollback smoke
   tests.
2. Run the 30-query corpus through live Vertex embeddings/Gemini and record a separate
   production result; the committed perfect scores are intentionally labeled offline.
3. Run two real Firebase users against live Firestore to reconfirm zero cross-user leakage,
   atomic transaction behavior, rules, index deletion, TTL cleanup, and revoked-token checks.
4. Complete browser, iOS simulator, and physical-device acceptance for login, explicit
   migration, offline edits/replay, SecureStore, citations, cancellation, privacy deletion,
   and proposal confirmation/rejection.
5. Upgrade the Expo toolchain when upstream ships non-breaking fixes for the remaining
   transitive audit findings. The web's non-extractable IndexedDB key is browser-protected,
   not guaranteed to be backed by an OS hardware keystore; mobile is the platform-secure
   implementation.

## Résumé bullets supported by this evidence

- Built and contract-tested a strict Python FastAPI planning backend integrating Firebase
  token auth, per-user AES-256-GCM envelope encryption with Cloud KMS/Secret Manager
  adapters, Vertex AI embeddings, Gemini generation, UID-filtered vector RAG, six
  UID-bound read-only MCP tools, and exact-record citations—80 tests at 75.28% branch-aware
  coverage.
- Replaced canned web/mobile assistants with encrypted offline planner clients and a
  source-linked copilot that explains deterministic workload/conflict rules, abstains
  without evidence, and requires atomic revision-checked confirmation before schedule
  changes; a 30-query offline golden evaluation measured 1.00 Hit@1/3/5, MRR, citation,
  abstention, and proposal validity with zero cross-user leakage.
