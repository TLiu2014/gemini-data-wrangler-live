# Gemini Data Wrangler Live

Real-time voice and visual AI agent for collaborative data wrangling. Built for the Gemini Live Agent Challenge.

Talk to the AI agent via live voice, and watch it manipulate your data pipeline in real time — no text chat box, no typing required.

## Features

- **Real-time voice interaction** — Bidirectional audio via Gemini 2.5 Flash Native Audio (Live API). You speak, Gemini speaks back and acts simultaneously.
- **Execute Canvas mode** — Click "Execute Canvas" to hand Gemini the whole pipeline. It analyzes incomplete stages, fills them in automatically with SQL, narrates what it's doing, and stays on the same 09-2025 session for all follow-up conversation.
- **Visual pipeline editor** — React Flow graph that auto-builds as transformations are applied. Nodes represent stages (load, join, filter, group, sort, select, union). Edges show data lineage.
- **In-browser SQL engine** — DuckDB-WASM runs all queries locally. No data leaves the browser.
- **Schema-aware agent** — Table schemas are injected into Gemini on connect and after each upload. Strict rules prevent column name hallucination; SQL error recovery uses candidate bindings from DuckDB errors.
- **Pause / Resume** — Freeze Gemini's audio mid-response without interrupting the session. The transcript also pauses and resumes in sync.
- **Interrupt** — Stop Gemini's current response immediately with one click. Audio and text both suppress until the server confirms the stop.
- **Undo transformations** — Ask Gemini to remove a transformation; it confirms verbally, then drops the table and removes the pipeline node.
- **Chart rendering** — Ask for bar, line, or pie charts; Recharts renders them inline from the active table.
- **Unified chat log** — Full conversation transcript with collapsible "thinking" sections.

## Tech Stack

| Layer | Technology |
|---|---|
| AI (chat) | Gemini 2.5 Flash Native Audio `gemini-2.5-flash-native-audio-preview-12-2025` |
| AI (execute) | Gemini 2.5 Flash Native Audio `gemini-2.5-flash-native-audio-preview-09-2025` |
| SDK | Google GenAI SDK (`@google/genai`) — Live API with function calling |
| Backend | Node.js + Fastify + `@fastify/websocket` |
| Frontend | React 19 + Vite + TypeScript |
| Flow Editor | @xyflow/react (React Flow) |
| SQL Engine | DuckDB-WASM (runs entirely in the browser) |
| Charts | Recharts |
| Deploy | Google Cloud Run |

## Prerequisites

- Node.js >= 20
- npm >= 10
- A [Google AI API key](https://aistudio.google.com/apikey)

## Setup

```bash
git clone https://github.com/TLiu2014/gemini-data-wrangler-live.git
cd gemini-data-wrangler-live
npm install
cp .env.example .env
# Edit .env and add your GOOGLE_API_KEY
```

## Running

```bash
npm start
```

Starts both the backend (http://localhost:3001) and frontend (http://localhost:5173) concurrently.

Open http://localhost:5173, upload a CSV, and start talking.

## Project Structure

```
server/
  src/
    index.ts              Server entry point (Fastify, static files, health check)
    ws.ts                 WebSocket route — message routing, session lifecycle
    apiKeyStore.ts        Encrypted API key persistence
    agent/
      gemini-live.ts      Dual-model Gemini Live session (chat + execute sessions)
      tools.ts            Tool declarations & handlers (executeDataTransform, etc.)

ui/
  src/
    App.tsx               Main component — layout, state, message handling
    sampleData.ts         Sample CSV datasets for demo mode
    components/
      TopBar.tsx          Header with settings
      Sidebar.tsx         Voice controls, file upload, chat log, audio visualizers
      FlowPane.tsx        React Flow pipeline canvas
      DataTable.tsx       DuckDB query results table
      ChartView.tsx       Recharts visualization
      AudioVisualizer.tsx Waveform bars (mic & Gemini output)
      FileUpload.tsx      Drag-and-drop CSV upload
      TableTabs.tsx       Tab bar for multiple loaded tables
      StageConfigDialog.tsx  Modal for editing stage parameters
    hooks/
      useWebSocket.ts     WebSocket client + message dispatch
      useAudioCapture.ts  Mic input — 16kHz PCM via getUserMedia
      useAudioPlayback.ts Model audio output — 24kHz PCM via AudioContext
                          Supports pause, resume, interrupt, suppress-until-clear
      useDuckDB.ts        DuckDB-WASM database hook
      useMicPermission.ts Browser mic permission management
      useScreenCapture.ts UI snapshots every 2s for Gemini vision context
```

## Dual-Model Architecture

Two Gemini Live sessions run from the same server-side class:

- **Chat session** (`12-2025`) — persistent, handles all voice conversation. Has superior audio quality. Does not use tool calling (avoids the 1008 bug).
- **Execute session** (`09-2025`) — created on-demand when the user clicks "Execute Canvas". Handles all tool calls (SQL execution). Stays alive for the entire execute-mode conversation so model never switches mid-session. Closed when a new execute request fires or the user disconnects.

## Known Issues

### Gemini Model: "1008 Tool Calling" Bug

`gemini-2.5-flash-native-audio-preview-12-2025` has a server-side regression where function calling over WebSockets triggers an immediate disconnect with close code **1008** ("Operation is not implemented, or supported, or enabled").

**Workaround:** The chat session uses 12-2025 (no tool calls needed for voice chat). The execute session uses 09-2025, which does not have this bug and handles all tool-call-heavy pipeline execution.

## License

[MIT](LICENSE)
