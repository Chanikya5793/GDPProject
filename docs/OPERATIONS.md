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

## Incident and deletion handling

- Disable AI in privacy settings to delete that UID's vectors immediately.
- Use `DELETE /v1/chats` to erase retained encrypted chat exchanges.
- Rotate the MCP secret by creating a new numbered Secret Manager version, changing the
  pinned resource, and deploying; existing MCP sessions become invalid.
- Rotate the KMS key by adding a new DEK key-version migration before changing payload key
  versions. Disabling an old KMS version first makes existing planner ciphertext unreadable.
- Audit documents contain salted UID hashes, event types, outcomes, counts, and entity
  types only—never prompt text, planner bodies, email addresses, or raw UIDs.
