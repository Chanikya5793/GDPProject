# Secure copilot operations

## Cloud prerequisites

Use a dedicated Firebase/GCP project. Enable Firebase Email/Password authentication,
Firestore Native mode, Cloud KMS, Secret Manager, Cloud Run, Cloud Build,
and Artifact Registry. Never point these scripts at an unrelated project.

Create a regional KMS key ring and AES-256 software CryptoKey. Create a 32-byte random
MCP session secret in Secret Manager and pin its numeric version in
`GDP_MCP_SECRET_RESOURCE`; `latest` is rejected by the application. Grant the Cloud Run
service account only `roles/datastore.user`,
`roles/cloudkms.cryptoKeyEncrypterDecrypter` on that key, and
`roles/secretmanager.secretAccessor` on that secret.

Create the required Firestore vector index after substituting the project and database:

```sh
gcloud firestore indexes composite create \
  --project "$GDP_GCP_PROJECT" --database='(default)' \
  --collection-group=planner_vectors --query-scope=COLLECTION \
  --field-config=field-path=uid,order=ASCENDING \
  --field-config=field-path=index_version,order=ASCENDING \
  --field-config='field-path=embedding,vector-config={"dimension":"768","flat":"{}"}'
```

The vector is built locally from record words. It is not a hosted embedding.
For an existing installation, create the versioned index and deploy the new
backend, then run the explicit migration below. The new query only reads
`local-lexical-v1` vectors, so old vectors cannot produce false matches. Search
may miss older approved records until the migration completes.

```sh
cd backend
.venv/bin/python -m scripts.reindex_local --project "$GDP_GCP_PROJECT" \
  --kms-key-name "$GDP_KMS_KEY_NAME" --apply
```

The script reindexes approved records for opted-in users and removes legacy
vectors after successful backfill. Use Application Default Credentials with
Firestore and KMS access. Search is lexical after this change; paraphrases that
share no words may need the assistant's exact `find` or `agenda` tools. The
planner briefing still supplies current records to the assistant.
After the new revision is serving, remove `roles/aiplatform.user` from the
runtime service account and disable the Vertex AI API if no other workload in
the GCP project uses it. This repository does not call that API.

Deploy `firestore.rules`; all browser/mobile Firestore access is denied because planner
traffic goes through FastAPI with verified Firebase ID tokens.

## Email verification

The API requires verified email while `PLANNER_REQUIRE_VERIFIED_EMAIL=true`.
Keep this enabled: disabling it allows someone to claim an eligible university
address without proving ownership. The deployed service was checked with this
setting enabled on 2026-10-26.

Both clients request email directly through Firebase Authentication, independently
of Cloud Run. An account can be created successfully while the subsequent email
request fails. The auth contexts retain that failure for the verification banner;
login pages do not consume the register function's returned `notice`. The banner
therefore distinguishes a request accepted by Firebase from a request that failed
or has not been made in the current session. Neither is proof of inbox delivery.
Concurrent sends for the same account/address are coalesced, and a successful
request starts the 60-second resend cooldown. Firebase may impose a longer limit.

The applied custom sender is `noreply@planner.chanakyachowdary.in`. Expected DNS:

| Name | Type | Value |
| --- | --- | --- |
| `planner` | TXT | `v=spf1 include:_spf.firebasemail.com ~all` |
| `planner` | TXT | `firebase=nw-student-planner` |
| `firebase1._domainkey.planner` | CNAME | `mail-planner-chanakyachowdary-in.dkim1._domainkey.firebasemail.com` |
| `firebase2._domainkey.planner` | CNAME | `mail-planner-chanakyachowdary-in.dkim2._domainkey.firebasemail.com` |

Run the read-only diagnostic with existing `gcloud` authentication:

```sh
python3 scripts/diagnose-email-verification.py --project nw-student-planner
```

It prints public sender/DNS configuration, aggregate verified/unverified account
counts, and email-action API response counts. It never sends email or prints
addresses, user IDs, passwords, tokens, action codes, SMTP credentials, or account
records. It supplies the Google quota-project header required by this project.
`dnsInfo.customDomain` is the applied verified domain; `customDomainState` describes
a pending verification. `NOT_STARTED` alone does not mean an applied domain is broken.

For a missing message, distinguish these cases:

1. A rejected send: use the banner's network, rate limit, quota, or expired-session
   guidance. Do not automatically retry and send multiple messages.
2. Accepted request, no message: check Inbox and Junk, then ask university IT for a
   Microsoft 365 message trace or quarantine check using the sender, recipient,
   and request time. API HTTP 200 and valid DNS do not establish delivery or
   prove that university filtering caused the failure. Google default delivery
   does not expose recipient inbox placement through the checked API metrics.
3. Link failure: open the newest message, then check the exact Firebase error.
   Never include the action code or full verification URL in logs or tickets.
4. Verified profile, API still refuses: the clients force a fresh ID token on
   every successful verified-profile check, including sessions restored with the
   verified flag already true. Late checks are discarded after an account switch.

The web app has a button-confirmed action handler (`src/pages/AuthAction.jsx`). It
is present in the public Pages build, but Firebase still uses its default hosted
handler. On 2026-10-26, an attempt to set
`https://chanikya5793.github.io/GDPProject/` as `notification.sendEmail.callbackUri`
was rejected with `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`; the live callback remained
`https://nw-student-planner.firebaseapp.com/__/auth/action`. The custom handler is
not active just because its code is deployed. A recipient-side security scanner
consuming a link is a hypothesis until a message trace or link evidence confirms
it. Escalate the template restriction through Firebase support; changing a client
continue URL does not replace the email action handler.

See `docs/EMAIL_VERIFICATION_DIAGNOSIS.html` for the 2026-10-26 evidence, source
repairs, and remaining delivery checks. Merging the fix ships the web changes via
Pages CI. Mobile changes require a new native/TestFlight release. No backend
redeploy is required by these client changes.

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

Rollback reaches back five builds, not further. Both Artifact Registry
repositories run a cleanup policy that keeps the five most recent images and
deletes anything older than fourteen days, so revisions beyond that window
still appear in `gcloud run revisions list` but their image is gone and they
cannot be started. Five builds has been weeks of history in practice; if a
release needs a longer guarantee, tag that image and add a Keep policy for the
tag before it ages out.

## Cost

The project runs on Blaze but is meant to sit inside the no-cost quotas.
Firestore and Authentication are well under theirs. Everything that has ever
appeared on the bill came from Cloud Run, so that is where to look first.

The one real trap is `min-instances`. A warm instance removes the cold start
and bills 1 vCPU and 1 GiB around the clock, which was Rs 341 of a Rs 393
month in September 2026 -- about 97% of the project's spend, under the SKU
"Services Min Instance Memory". It is set to 0 in
`infra/cloudrun/service.yaml.template` and stated again in
`.github/workflows/deploy-backend.yml`, because that workflow deploys from
source and keeps the service's existing configuration: a value that lives only
in the template never actually ships. Do not raise it without deciding that the
idle bill is worth paying.

What pays for the cold start instead, none of which bills for idle time:
startup CPU boost, bytecode precompiled into the image, a single uvicorn
worker, the cloud clients built in the lifespan hook rather than on the first
request, and both clients pinging `/v1/signup-policy` as they start.

A budget of Rs 100 a month on billing account 01616A-5366CE-505D58 alerts at
50, 90 and 100%. Deliberately alerts only. Firebase also offers a
service-level spend cap, which pauses the service when it trips -- that would
take the planner down mid semester over a few rupees, so it is left unset.

The remaining few rupees are not worth chasing. One KMS key version is a flat
monthly charge and is the price of envelope encryption. The build buckets and
Artifact Registry now expire their own contents. Secret Manager holds two
versions against a free six.

`/healthz` is reachable only from inside the container. Google's frontend
answers it with its own 404 and never forwards it, so the startup and liveness
probes work while an external check of that path does not. Use
`/v1/signup-policy` for anything outside.

## Answer generation provider

Generation runs only on Meta Muse Spark through the OpenAI-compatible Chat
Completions protocol. `PLANNER_MUSE_MODEL` defaults to
`muse-spark-1.3-contributor` against `PLANNER_MUSE_BASE_URL`. Search vectors
are generated inside the API process. Google Cloud remains in use for Firebase,
Firestore, KMS, Secret Manager, and Cloud Run.

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

`muse-spark-1.3-contributor` is discounted **in exchange for permission to train on
prompts and completions**.

A prompt here is not just the user's question. It carries approved records in the
planner briefing and `record_text` for retrieved records, including task titles,
notes, note bodies, and approved attachment text.
On the contributor tier that content is available to Meta for training.

This is a deliberate choice. It is disclosed to users in Settings, sourced from
`GET /v1/ai-info` so the wording cannot drift from the deployed model, and every
`generation` audit event records `provider` and `trains_on_prompts`. Switching to
The contributor tier's lower service-wide rate limit is worth watching under load.

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
signed-in caller cannot loop the endpoint and run up Muse Spark spend.

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
