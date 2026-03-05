# Dev Log

## Phase 1: Scaffolding & Plumbing
- Monorepo setup with npm workspaces (`apps/frontend`, `apps/backend`)
- Backend: Fastify + `@fastify/websocket` server on port 3001
- Frontend: React + Vite + TypeScript with Vite proxy for `/ws`
- WebSocket message protocol (`WsMessage` type) shared between FE/BE
- UI layout: 3-pane dark theme — sidebar (audio controls), top (React Flow canvas), bottom (data table)
- React Flow initialized with a starter node
- ADK tool stubs (`addReactFlowNode`, `executeDataTransform`, `renderChart`) with typed action interfaces
- `useWebSocket` hook for connection management and message send/receive
- `.env` / `.env.example` for Gemini API key config
- `npm start` runs both FE and BE via `concurrently`

## Phase 2: Live Voice Agent (Gemini Live API)
- `GeminiLiveSession` class — connects to `gemini-2.0-flash-live-001` via `@google/genai`
  - System instruction for data wrangling context
  - Audio response modality
  - Function calling with 3 tool declarations
  - Routes tool calls back to frontend as WebSocket actions
- `useAudioCapture` hook — mic access via `getUserMedia`, captures 16kHz mono PCM, base64-encodes and sends via WS
- `useAudioPlayback` hook — decodes 24kHz PCM from Gemini, queues seamless playback via `AudioContext`
- `AudioVisualizer` component — canvas frequency bar chart driven by `AnalyserNode`
- `useScreenCapture` hook — captures UI snapshots as JPEG every 2s, streams to backend alongside audio
- Sidebar: mic toggle button, live visualizer, connection status
- `FlowPane` exposes `addNode()` via `useImperativeHandle` for agent-driven graph updates
- Backend `ws.ts`: each WS client gets its own Gemini session; audio/screenshot routed through

## Phase 3: DuckDB-WASM, Data Table & Charts
- `useDuckDB` hook — initializes DuckDB-WASM (CDN bundles), manages DB lifecycle
  - `loadCSV(file)` — registers CSV file buffer, creates table, shows first 100 rows
  - `executeQuery(sql)` — runs arbitrary SQL, parses Arrow results into `{columns, rows}`
- `FileUpload` component — drag-and-drop or browse for CSV files
- `DataTable` component — displays query results with row/column count, sticky headers, error state
- `ChartView` component — renders Recharts bar/line/pie charts from current data
  - Dark-themed tooltips and axes
  - Driven by `RENDER_CHART` agent actions
- Sidebar: file upload section, shows loaded table name badge
- `App.tsx`: full wiring — `onSql` → `executeQuery`, `RENDER_CHART` → chart state, CSV upload auto-adds flow node
