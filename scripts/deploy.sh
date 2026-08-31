#!/usr/bin/env bash
set -euo pipefail

required=(
  GDP_GCP_PROJECT GDP_REGION GDP_SERVICE GDP_IMAGE_REPOSITORY GDP_SERVICE_ACCOUNT
  GDP_VERTEX_LOCATION GDP_FIREBASE_PROJECT_ID GDP_KMS_KEY_NAME
  GDP_MCP_SECRET_RESOURCE GDP_ALLOWED_ORIGINS GDP_MUSE_SECRET_RESOURCE
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 2
  fi
done

command -v gcloud >/dev/null || { echo "gcloud is required" >&2; exit 2; }
command -v envsubst >/dev/null || { echo "envsubst is required" >&2; exit 2; }

GDP_IMAGE="${GDP_REGION}-docker.pkg.dev/${GDP_GCP_PROJECT}/${GDP_IMAGE_REPOSITORY}/planner-api:$(git rev-parse --short HEAD)"
export GDP_IMAGE

gcloud builds submit backend --project "${GDP_GCP_PROJECT}" --tag "${GDP_IMAGE}"
envsubst < infra/cloudrun/service.yaml.template > /tmp/gdp-planner-cloudrun.yaml
gcloud run services replace /tmp/gdp-planner-cloudrun.yaml \
  --project "${GDP_GCP_PROJECT}" --region "${GDP_REGION}"
gcloud run services add-iam-policy-binding "${GDP_SERVICE}" \
  --project "${GDP_GCP_PROJECT}" --region "${GDP_REGION}" \
  --member=allUsers --role=roles/run.invoker >/dev/null
gcloud run services describe "${GDP_SERVICE}" \
  --project "${GDP_GCP_PROJECT}" --region "${GDP_REGION}" \
  --format='value(status.url,status.latestReadyRevisionName)'
