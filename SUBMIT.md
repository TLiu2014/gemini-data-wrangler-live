# Gemini Live Agent Challenge — Submission

## 1. Text Description

### What it does

Gemini Data Wrangler Live is a voice-driven data wrangling tool. Users talk to a Gemini AI agent to explore, join, filter, and visualize CSV data through a visual pipeline editor — no code required.

Upload CSVs, speak naturally ("join these two tables", "filter by active customers", "show me a bar chart"), and watch the pipeline build itself in real time. The agent understands your data schemas, writes SQL behind the scenes, and updates the UI instantly.

### Features

- **Real-time voice interaction** — Bidirectional audio via Gemini 2.5 Flash Native Audio (Live API). You speak, Gemini speaks back and acts simultaneously.
- **Visual pipeline editor** — React Flow graph that auto-builds as transformations are applied. Nodes represent stages (load, join, filter, group, sort). Edges show data lineage.
- **In-browser SQL engine** — DuckDB-WASM runs all queries locally. No data leaves the browser. Supports joins, filters, aggregations, and arbitrary SQL.
- **Schema-aware agent** — Table schemas are sent to Gemini on connect and after each upload, so it knows column names and types without asking.
- **Undo/redo transformations** — Ask Gemini to remove a transformation; it confirms verbally, then drops the table and removes the pipeline node.
- **Chart rendering** — Ask for bar, line, or pie charts. Recharts renders them inline from the active table data.
- **Unified chat log** — Full conversation transcript with collapsible "thinking" sections showing Gemini's reasoning.

### Technologies

| Layer | Technology |
|---|---|
| AI Model | Gemini 2.5 Flash Native Audio (`gemini-2.5-flash-native-audio-preview-09-2025`) |
| SDK | Google GenAI SDK (`@google/genai`) — Live API with function calling |
| Cloud | Google Cloud Run (backend hosting, WebSocket support) |
| Backend | Node.js + Fastify + `@fastify/websocket` |
| Frontend | React 19 + Vite + TypeScript |
| Flow Editor | @xyflow/react v12 (React Flow) |
| SQL Engine | DuckDB-WASM (runs entirely in the browser) |
| Charts | Recharts |

### Findings and learnings

- **Gemini Live API + function calling is powerful for agentic UX.** The model can reason about table schemas and emit tool calls mid-conversation, making the voice-to-action loop feel instantaneous.
- **Deferred tool results** are essential for tools that need UI confirmation (e.g. undo). The server sends the action to the frontend, the frontend confirms with the user, executes, and sends the result back to Gemini via the same WebSocket.
- **DuckDB-WASM BigInt serialization** was a recurring pain point — JavaScript's `JSON.stringify` can't handle BigInt. Coercing to Number in the result parser solved it cleanly.
- **Node timing in React Flow** — calling `connectNode` right after `addNode` fails because React hasn't re-rendered yet. A short `setTimeout` (80ms) lets the new node appear in `nodesRef` before wiring edges.
- **Stage type detection from SQL** requires care — naive `includes("JOIN")` matches table names like `customer_orders_join`. Stripping quoted identifiers and using word-boundary regex (`/\bJOIN\b/i`) fixes this.
- **"1008 Tool Calling" bug in the 12-2025 model** — `gemini-2.5-flash-native-audio-preview-12-2025` has a server-side regression where function calling over WebSockets triggers an immediate disconnect (code 1008: "Operation is not implemented, or supported, or enabled"). The bug fires the moment Gemini tries to return a tool call to the client. Switching to the 09-2025 preview resolves the issue. This is a known, widely reported problem on Google AI forums.

---

## 2. Public Code Repository

**URL:** `https://github.com/TLiu2014/gemini-data-wrangler-live-live`

Spin-up instructions are in the README. Summary:

```bash
git clone https://github.com/TLiu2014/gemini-data-wrangler-live-live.git
cd gemini-data-wrangler-live-live
cp .env.example .env        # add your GOOGLE_API_KEY
npm install
npm run dev                  # opens at http://localhost:5173
```

---

## 3. Proof of Google Cloud Deployment

### What to record

Make a short screen recording (30–60 seconds) showing the backend running on Google Cloud Run. Walk through these pages:

#### Step 1: Cloud Run service dashboard

1. Open [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **Cloud Run** (hamburger menu > Cloud Run, or search "Cloud Run")
3. Click the **gemini-data-wrangler-live** service
4. Show the **Service details** page — it displays:
   - Service URL (`https://gemini-data-wrangler-live-xxxxxxxxxx-uc.a.run.app`)
   - Region (e.g. `us-central1`)
   - Last deployed revision and status (green check = healthy)

#### Step 2: Revision details

1. Click the **Revisions** tab
2. Click the latest revision
3. Show:
   - Container image (built from our Dockerfile)
   - Port: `8080`
   - Environment variables: `GOOGLE_API_KEY` is set

#### Step 3: Logs (proof it's running)

1. Click the **Logs** tab (or go to Cloud Logging)
2. Show recent log entries — you should see:
   - `Backend listening on http://0.0.0.0:8080`
   - `Gemini Live session opened` (if a session was active)
   - HTTP request logs for `/health`, `/ws`, and static file serving

#### Step 4: Live app

1. Open the service URL in a new browser tab
2. Show the app loads and is functional (upload a CSV, toggle mic, talk to Gemini)
3. Point out the URL bar showing `*.run.app` — confirming it's hosted on Cloud Run

### How to deploy (if not yet deployed)

See [DEPLOY.md](./DEPLOY.md) for full instructions. Quick version:

```bash
gcloud run deploy gemini-data-wrangler-live \
  --project YOUR_PROJECT \
  --region us-central1 \
  --source . \
  --set-env-vars "GOOGLE_API_KEY=your-key" \
  --allow-unauthenticated \
  --port 8080 \
  --session-affinity \
  --timeout 3600
```

---

## 4. Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   Google Cloud Run                       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │            Node.js / Fastify Server               │  │
│  │                                                   │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────┐  │  │
│  │  │ /ws      │  │ /health      │  │ /*         │  │  │
│  │  │ WebSocket│  │ Health check │  │ Static UI  │  │  │
│  │  └────┬─────┘  └──────────────┘  └────────────┘  │  │
│  │       │                                           │  │
│  │       │  Gemini Live API (bidirectional stream)   │  │
│  │       │  ┌─────────────────────────────────────┐  │  │
│  │       └──│  Google GenAI SDK (@google/genai)   │  │  │
│  │          │  • Audio streaming (PCM 16kHz)      │  │  │
│  │          │  • Function calling (tools)         │  │  │
│  │          │  • Input/output transcription        │  │  │
│  │          └──────────────┬──────────────────────┘  │  │
│  └─────────────────────────┼─────────────────────────┘  │
│                            │                             │
└────────────────────────────┼─────────────────────────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │   Google AI Studio     │
                │   Gemini 2.5 Flash     │
                │   Native Audio Model   │
                └────────────────────────┘

         ▲ HTTPS + WSS
         │
┌────────┴──────────────────────────────────────┐
│                  Browser                       │
│                                                │
│  ┌──────────────┐  ┌───────────────────────┐  │
│  │  React UI    │  │  DuckDB-WASM          │  │
│  │  • React Flow│  │  • In-browser SQL     │  │
│  │  • Recharts  │  │  • CSV import/query   │  │
│  │  • Audio I/O │  │  • Zero server trips  │  │
│  └──────────────┘  └───────────────────────┘  │
│                                                │
│  Voice ←→ WebSocket ←→ Gemini Live API         │
│  CSV data never leaves the browser             │
└────────────────────────────────────────────────┘
```

---

## 5. Demo Video

_(Recorded separately — not included in this document.)_
