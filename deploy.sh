#!/usr/bin/env bash
# deploy.sh — Build and deploy Gemini Data Wrangler Live to Google Cloud Run
#
# Usage:
#   ./deploy.sh                        # uses defaults below
#   GCP_PROJECT=my-project ./deploy.sh # override project
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Docker running
#   - One-time setup already done (see DEPLOY.md)

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
GCP_PROJECT="${GCP_PROJECT:-your-project-id}"
GCP_REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="gemini-data-wrangler-live"
IMAGE="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/cloud-run-source-deploy/$SERVICE_NAME"

# ── Validate ──────────────────────────────────────────────────────────────────
if [ "$GCP_PROJECT" = "your-project-id" ]; then
  echo "ERROR: Set GCP_PROJECT before running."
  echo "  export GCP_PROJECT=your-actual-project-id"
  exit 1
fi

echo "==> Project : $GCP_PROJECT"
echo "==> Region  : $GCP_REGION"
echo "==> Image   : $IMAGE"
echo ""

# ── Build ─────────────────────────────────────────────────────────────────────
echo "==> Building image (linux/amd64)..."
docker build --platform linux/amd64 -t "$IMAGE" .

# ── Push ──────────────────────────────────────────────────────────────────────
echo "==> Pushing image to Artifact Registry..."
docker push "$IMAGE"

# ── Deploy ────────────────────────────────────────────────────────────────────
echo "==> Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --project "$GCP_PROJECT" \
  --region "$GCP_REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --session-affinity \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 3600

echo ""
echo "==> Done. Service URL:"
gcloud run services describe "$SERVICE_NAME" \
  --project "$GCP_PROJECT" \
  --region "$GCP_REGION" \
  --format "value(status.url)"
