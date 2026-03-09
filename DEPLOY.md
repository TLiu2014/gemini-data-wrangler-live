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

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

## Deploy

```bash
# Set your project and preferred region
export GCP_PROJECT="your-project-id"
export GCP_REGION="us-central1"
export GOOGLE_API_KEY="your-gemini-api-key"

# Build and deploy in one command
gcloud run deploy gemini-data-wrangler-live \
  --project $GCP_PROJECT \
  --region $GCP_REGION \
  --source . \
  --set-env-vars "GOOGLE_API_KEY=$GOOGLE_API_KEY" \
  --allow-unauthenticated \
  --port 8080 \
  --session-affinity \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 3600
```

Key flags:
- `--source .` — uses Cloud Build to build the Docker image from the Dockerfile
- `--session-affinity` — keeps WebSocket connections routed to the same instance
- `--timeout 3600` — allows long-lived WebSocket sessions (up to 1 hour)
- `--allow-unauthenticated` — makes the app publicly accessible for the demo

## After deployment

The command outputs a URL like:

```
https://gemini-data-wrangler-live-xxxxxxxxxx-uc.a.run.app
```

Open it in your browser — the full app (UI + backend + WebSocket) runs from this single URL.

## Update

Re-run the same `gcloud run deploy` command. Cloud Build rebuilds the image and rolls out the new revision with zero downtime.

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
┌──────────────────────────────────────────┐
│            Google Cloud Run              │
│  ┌─────────────────────────────────────┐ │
│  │   Node.js (Fastify)                 │ │
│  │   ├── /ws         → WebSocket       │ │
│  │   ├── /health     → Health check    │ │
│  │   └── /*          → Static UI       │ │
│  └──────────┬──────────────────────────┘ │
│             │ Gemini Live API            │
│             ▼                            │
│  ┌─────────────────────┐                 │
│  │  Google AI Studio   │                 │
│  │  (Gemini 2.5 Flash) │                 │
│  └─────────────────────┘                 │
└──────────────────────────────────────────┘
         ▲
         │ HTTPS + WSS
         │
┌────────┴────────┐
│    Browser      │
│  ├── React UI   │
│  └── DuckDB-WASM│
└─────────────────┘
```

## Cost

Cloud Run free tier includes 2 million requests/month and 360,000 vCPU-seconds. With `--min-instances 0` the service scales to zero when idle — no cost when not in use.
