# Secure copilot operations

## Cloud prerequisites

Use a dedicated Firebase/GCP project. Enable Firebase Email/Password authentication,
Firestore Native mode, Vertex AI, Cloud KMS, Secret Manager, Cloud Run, Cloud Build,
and Artifact Registry. Never point these scripts at an unrelated project.

Create a regional KMS key ring and AES-256 software CryptoKey. Create a 32-byte random
MCP session secret in Secret Manager and pin its numeric version in
`GDP_MCP_SECRET_RESOURCE`; `latest` is rejected by the application. Grant the Cloud Run
service account only `roles/datastore.user`, `roles/aiplatform.user`,
`roles/cloudkms.cryptoKeyEncrypterDecrypter` on that key, and
`roles/secretmanager.secretAccessor` on that secret.

Create the required Firestore vector index after substituting the project and database:

```sh
gcloud firestore indexes composite create \
  --project "$GDP_GCP_PROJECT" --database='(default)' \
  --collection-group=planner_vectors --query-scope=COLLECTION \
  --field-config=field-path=uid,order=ASCENDING \
  --field-config='field-path=embedding,vector-config={"dimension":"768","flat":"{}"}'
```

Deploy `firestore.rules`; all browser/mobile Firestore access is denied because planner
traffic goes through FastAPI with verified Firebase ID tokens.

## Deploy

Populate the variables validated by `scripts/deploy.sh`, authenticate `gcloud` with the
intended GDP project, and run the script from the repository root. It builds an immutable
commit-tagged image, replaces the Cloud Run service, and prints the URL and ready revision.
The script makes the HTTPS endpoint publicly invokable so browser/mobile Firebase bearer
tokens can reach FastAPI; every planner/MCP route still rejects requests unless FastAPI
verifies that token. `/healthz` is public and initializes the production dependency graph.
Configure the web/mobile API base URL to that HTTPS URL, build the web app, then deploy
Firebase Hosting separately with `firebase deploy --only hosting,firestore:rules`.

Smoke-test `/healthz`, authenticated CRUD, opt-in indexing, source-linked chat, a stale
proposal rejection, MCP session/UID rejection, index deletion, and a second UID that must
retrieve zero first-user records. Do not promote traffic without that acceptance matrix.

## Rollback

List known-good revisions with `gcloud run revisions list --service "$GDP_SERVICE"`, set
`GDP_ROLLBACK_REVISION`, and run `scripts/rollback.sh`. The script verifies that exact
revision before moving 100% of traffic. Data schema v1 is backward-compatible; do not
destroy Firestore or wrapped DEKs during rollback.

## Answer generation provider

Generation runs on Meta Muse Spark via the OpenAI-compatible Chat Completions protocol.
`PLANNER_ANSWER_PROVIDER` selects the backend:

- `muse` (deployed default) — `PLANNER_MUSE_MODEL`, default `muse-spark-1.2-contributor`,
  against `PLANNER_MUSE_BASE_URL`.
- `vertex` — the original `gemini-2.5-flash` path, kept so the provider can be rolled
  back without a code change.

**Embeddings never move.** Meta's API has no embeddings endpoint, so `VertexEmbeddingClient`
and `gemini-embedding-001` still serve indexing and query embedding regardless of this
setting. Google Cloud remains a hard dependency; only generation is portable.

### The API key

Supplied through Secret Manager, never through the environment or a file in the repo.
`PLANNER_MUSE_API_KEY_RESOURCE` must be a version-pinned resource
(`projects/*/secrets/*/versions/N`) — the same `SecretResolver` guard the MCP session
secret uses. Startup fails fast if the provider is `muse` and no resource is set, so a
missing key surfaces on deploy rather than on a user's first question.

```bash
printf '%s' "$MUSE_KEY" | gcloud secrets create muse-api-key --data-file=- --project "$GDP_GCP_PROJECT"
gcloud secrets add-iam-policy-binding muse-api-key \
  --member="serviceAccount:$GDP_SERVICE_ACCOUNT" --role=roles/secretmanager.secretAccessor \
  --project "$GDP_GCP_PROJECT"
export GDP_MUSE_SECRET_RESOURCE=projects/$GDP_GCP_PROJECT/secrets/muse-api-key/versions/1
```

### Contributor tier: prompts are training data

`muse-spark-1.2-contributor` is discounted **in exchange for permission to train on
prompts and completions**. The standard-tier models (`muse-spark-1.1`, `muse-spark-1.2`)
carry the opposite guarantee.

A prompt here is not just the user's question. It carries `record_text` for every
retrieved record — task titles and notes, note bodies, and approved attachment text.
On the contributor tier that content is available to Meta for training.

This is a deliberate choice. It is disclosed to users in Settings, sourced from
`GET /v1/ai-info` so the wording cannot drift from the deployed model, and every
`generation` audit event records `provider` and `trains_on_prompts`. Switching to
`muse-spark-1.2` flips all three automatically. Note the contributor tier also drops the
service-wide limit from 3,000 to 100 requests/min, well above the per-user chat budget
below but worth watching under load.

## Planner daily capacity

The planner rules engine calls a day overloaded when its tasks' `estimated_minutes`
exceed a capacity. That capacity resolves in two steps:

1. `PLANNER_MAX_DAILY_MINUTES` (default 360) is the deployment-wide default.
2. A user may override it for themselves via `GET`/`PUT /v1/planner-settings`, stored
   at `users/{uid}/settings/planner`. `max_daily_minutes: null` means "no preference",
   so that user follows the deployment default.

The engine holds only the default; the per-user value is passed into `analyze()` and
`next_available_day()` per call, so one process serves users with different capacities
without any shared mutable state.

Both clients expose this: the web app under Planner Preferences and the Expo app under
Planner. Each writes to the same `/v1/planner-settings` endpoint, so the value follows the
user across devices.

Note the unit difference: this capacity is **minutes of estimated work**, while the
clients' "Max Tasks Per Day" counts **tasks**. They are deliberately separate
judgements — the copilot reasons about effort, the Tasks page about how crowded a day
looks. A day can trip one and not the other.

## Copilot rate limiting

`POST /v1/copilot/chat` is metered per authenticated UID with a token bucket, so a
signed-in caller cannot loop the endpoint and run up Vertex/Gemini spend.

- `PLANNER_CHAT_RATE_LIMIT_REQUESTS` (default 20) is both the bucket capacity and the
  per-window allowance, so a user may burst up to 20 and then settles into the
  sustained rate.
- `PLANNER_CHAT_RATE_LIMIT_WINDOW_SECONDS` (default 3600) is the refill window.

Counters live at `users/{uid}/limits/copilot_chat` and are updated in a Firestore
transaction. That matters because Cloud Run runs several workers per instance and
scales out: a process-local counter would give each worker its own budget, so the
effective limit would be N times the configured one.

Over-budget requests get `429` with a `Retry-After` header and `"code":
"rate_limited"`, and are recorded as a `rate_limited` audit event carrying only the
hashed UID — never the prompt.

Only the chat endpoint is metered. Record CRUD and `/mcp` tool calls are unmetered;
if MCP tool traffic starts driving generation cost, meter it the same way.

To change the budget, edit the two values in `infra/cloudrun/service.yaml.template`
and redeploy. They are literal values, not `envsubst` placeholders, because an unset
variable would render an empty string and fail startup validation.

## Incident and deletion handling

- Disable AI in privacy settings to delete that UID's vectors immediately.
- Use `DELETE /v1/chats` to erase retained encrypted chat exchanges.
- Rotate the MCP secret by creating a new numbered Secret Manager version, changing the
  pinned resource, and deploying; existing MCP sessions become invalid.
- Rotate the KMS key by adding a new DEK key-version migration before changing payload key
  versions. Disabling an old KMS version first makes existing planner ciphertext unreadable.
- Audit documents contain salted UID hashes, event types, outcomes, counts, and entity
  types only—never prompt text, planner bodies, email addresses, or raw UIDs.
