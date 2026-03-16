# Deploying to Google Cloud Run

## Prerequisites

1. [Google Cloud CLI (`gcloud`)](https://cloud.google.com/sdk/docs/install) installed and authenticated
2. A GCP project with billing enabled
3. A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

## One-time setup

```bash
# Set your project ID
export GCP_PROJECT="your-project-id"

gcloud config set project $GCP_PROJECT

# Enable required APIs (no cloudbuild needed for local builds)
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com

# Create Artifact Registry repository
gcloud artifacts repositories create cloud-run-source-deploy \
  --repository-format=docker \
  --location=us-central1

# Authenticate Docker to Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev
```

## API Key Model

**No server-side API key is needed for deployment.** Each user provides their own Gemini API key via the Settings panel in the UI. The key is stored in the browser's `sessionStorage` and sent to the server only as part of the WebSocket handshake — it is used exclusively for that user's session and never persisted server-side.

For local development, you can still set `GOOGLE_API_KEY` in your `.env` file as a fallback (used when the browser sends no key), but this is optional and not recommended for production.

## Deploy

```bash
# Set your project and preferred region
export GCP_PROJECT="your-project-id"
export GCP_REGION="us-central1"
export IMAGE="us-central1-docker.pkg.dev/$GCP_PROJECT/cloud-run-source-deploy/gemini-data-wrangler-live"

# Build image locally (linux/amd64 matches Cloud Run's architecture)
docker build --platform linux/amd64 -t $IMAGE .

# Push to Artifact Registry
docker push $IMAGE

# Deploy from image (no Cloud Build used)
gcloud run deploy gemini-data-wrangler-live \
  --image $IMAGE \
  --project $GCP_PROJECT \
  --region $GCP_REGION \
  --allow-unauthenticated \
  --port 8080 \
  --session-affinity \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 3600
```

Key flags:
- `--image` — deploys a pre-built image, skipping Cloud Build entirely
- `--session-affinity` — keeps WebSocket connections routed to the same instance
- `--timeout 3600` — allows long-lived WebSocket sessions (up to 1 hour)
- `--allow-unauthenticated` — makes the app publicly accessible for the demo

## After deployment

The command outputs a URL like:

```
https://gemini-data-wrangler-live-xxxxxxxxxx-uc.a.run.app
```

Open it in your browser — the full app (UI + backend + WebSocket) runs from this single URL.

**Current deployment:** https://gemini-data-wrangler-live-887509405386.us-central1.run.app/

## Automated deploy script

[`deploy.sh`](./deploy.sh) wraps the build, push, and deploy steps into a single command:

```bash
export GCP_PROJECT="your-project-id"
./deploy.sh
```

## Update

Re-run `./deploy.sh`. The new image is built locally, pushed, and rolled out with zero downtime.

## Local Docker test (optional)

```bash
# Build
docker build -t gemini-data-wrangler-live .

# Run
docker run -p 8080:8080 -e GOOGLE_API_KEY="your-key" gemini-data-wrangler-live

# Open http://localhost:8080
```

## Architecture

```
┌──────────────────────────────────────────────┐
│              Google Cloud Run                 │
│  ┌──────────────────────────────────────────┐ │
│  │          Node.js (Fastify)               │ │
│  │  ├── /ws         → WebSocket             │ │
│  │  ├── /health     → Health check          │ │
│  │  └── /*          → Static UI             │ │
│  │                                          │ │
│  │  GeminiLiveSession (per client)          │ │
│  │  ├── Chat session    (12-2025)           │ │
│  │  │   persistent, voice conversation      │ │
│  │  └── Execute session (09-2025) on-demand │ │
│  │      SQL tool calls, pipeline execution  │ │
│  └───────────────────┬──────────────────────┘ │
│                      │ Gemini Live API         │
│                      ▼                         │
│  ┌──────────────────────────────────────────┐ │
│  │  Google AI Studio (Gemini 2.5 Flash)     │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
         ▲
         │ HTTPS + WSS
         │
┌────────┴────────────────┐
│    Browser               │
│  ├── React UI            │
│  │   (React Flow, etc.)  │
│  └── DuckDB-WASM         │
│      (all SQL in-browser)│
└──────────────────────────┘
```

## Cost

Cloud Run free tier includes 2 million requests/month and 360,000 vCPU-seconds. With `--min-instances 0` the service scales to zero when idle — no cost when not in use.
