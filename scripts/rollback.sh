#!/usr/bin/env bash
set -euo pipefail

: "${GDP_GCP_PROJECT:?Set GDP_GCP_PROJECT}"
: "${GDP_REGION:?Set GDP_REGION}"
: "${GDP_SERVICE:?Set GDP_SERVICE}"
: "${GDP_ROLLBACK_REVISION:?Set GDP_ROLLBACK_REVISION to a verified prior revision}"

gcloud run revisions describe "${GDP_ROLLBACK_REVISION}" \
  --service "${GDP_SERVICE}" --project "${GDP_GCP_PROJECT}" --region "${GDP_REGION}" >/dev/null
gcloud run services update-traffic "${GDP_SERVICE}" \
  --project "${GDP_GCP_PROJECT}" --region "${GDP_REGION}" \
  --to-revisions "${GDP_ROLLBACK_REVISION}=100"
