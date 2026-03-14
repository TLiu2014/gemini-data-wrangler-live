# Dev Log

## Phase 1: Scaffolding & Plumbing
- Monorepo setup with npm workspaces (`ui`, `server`)
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

## Phase 4: UI Polish & Theme Alignment
- **Light theme** by default (Google colors: #4285f4 primary, #ffffff bg, #f8f9fa surface)
- **Top bar** with Gemini gradient, title "Gemini Data Wrangler Live", settings gear with API key input
- **Auto-connect** — WS connects on page load, no "Connect" button needed
- **Auto-unmute** — mic starts automatically once permission granted + WS connected
- **Mic permission** prompted on page load via `useMicPermission` hook; denied state shows banner
- **Two voice visualizers** — "You" (mic analyser, blue→purple gradient) and "Gemini" (output analyser, purple→blue)
- **Transcript** — Gemini text responses shown below voice waves
- **CSV upload moved** to top of sidebar
- **Resizable sidebar** — drag handle between sidebar and main content (240–500px range)
- **Resizable flow/data split** — horizontal drag handle between React Flow and data pane (15–85%)
- **Table tabs** — scrollable tab bar for multiple DuckDB tables
- **Multi-table support** in `useDuckDB` — each CSV load or query result becomes a tab
- **React Flow theme** — light background, Google-themed stage colors (LOAD=#10b981, JOIN=#3b82f6, FILTER=#f59e0b, etc.)
- **Gradient edges** — SVG linearGradient from source node color to target node color on connecting edges

## Phase 5: Execute Canvas Mode
- **"Execute Canvas" button** added to the canvas toolbar — sends the full pipeline graph state to Gemini
- `sendCanvasExecutionRequest` (async) — creates a temporary execute session with the 09-2025 model, sends a prompt containing:
  - Loaded table names and their schemas
  - List of incomplete stages (executionState "running", no tableName)
  - Pre-computed planned actions with human-readable descriptions per stage type (join, filter, group, sort, select, union)
  - Full graph state JSON for Gemini to reference
- **Execution rules injected into prompt:**
  - ONE single greeting: name loaded tables, state what's being done vs what's already done
  - Process incomplete nodes in dependency order, one at a time
  - Narrate outcome after each tool result
  - Use exact column names from schema (prevents hallucination)
  - SQL error recovery: use DuckDB's "Candidate bindings" to self-correct
  - Final summary starts with "All done" or "Done"
- **Dynamic placeholder** — transcript shows "Analyzing pipeline with [table1, table2]..." while Gemini warms up; updates as stages complete ("Completed join. Working on filter...")
- `describeCanvasStageProgress()` — generates progress text from live graph state; drives placeholder updates on each `onSql` success
- `dedupeExecuteNarration()` — de-duplicates redundant sentences in execute mode narration (Gemini sometimes repeats stage descriptions)
- **Auxiliary content guard** (60s) — prevents schema/context messages from corrupting the execute session's tool-call turn
- `sendCanvasCompletionPrompt` — server-side signal after all stages done; tells Gemini to summarize; targets execute session
- `closeExecuteSession` — clears guard, sends `[PIPELINE UPDATE]` to chat session so it knows stages are complete, then refreshes schemas

## Phase 6: Dual-Model Architecture
- **Split into two models:**
  - `GEMINI_MODEL_CHAT = "gemini-2.5-flash-native-audio-preview-12-2025"` — persistent chat session. Better audio quality. No tool calls (avoids 1008 bug).
  - `GEMINI_MODEL_EXECUTE = "gemini-2.5-flash-native-audio-preview-09-2025"` — on-demand execute session. Full tool-calling support.
- Both sessions managed inside the single `GeminiLiveSession` class as `session` and `executeSession`
- `handleGeminiMessage(msg, fromExecute: boolean)` — routes immediate tool responses to the correct session via `fromExecute` flag
- `sendToolResult` — targets `executeSession ?? session`
- **Execute session stays alive for follow-up conversation** — removed auto-cleanup timer from `sendCanvasCompletionPrompt`. Session persists until next execute request or disconnect, so all follow-up voice during execute mode uses the same 09-2025 model.
- **Audio routing** — `sendAudio()` and `sendScreenshot()` route to `executeSession` when active, fall back to `session`
- **Schema routing** — `sendSchemaContext()` also routes to active execute session
- `inputAudioTranscription: {}` added to execute session config so user speech during follow-ups is transcribed and shown in the transcript

## Phase 7: Audio Playback Controls & Transcript Sync
- **Pause / Resume:**
  - `pausePlayback()` — suspends AudioContext (freezes mid-playback audio)
  - `resumePlayback()` — resumes AudioContext; `nextStartRef` is NOT reset (resetting caused overlap with pre-pause queued chunks)
  - `audioPausedRef` (synchronous ref, not state) — updated immediately in `handlePause` / `handleResume` to avoid React async delay race condition
  - `pausedTextBufferRef` — accumulates `onText` chunks while paused; flushed as a batch on resume
- **Interrupt:**
  - `interruptPlayback()` — closes AudioContext immediately, sets `suppressUntilRef = Infinity`
  - `suppressUntilRef` in `playChunk` — drops all incoming audio chunks while `Date.now() < suppressUntilRef`; `Infinity` means indefinite suppression (a timed window was unreliable — Gemini's stream can resume after 1s)
  - `allowPlayback()` — resets `suppressUntilRef = 0`; called from `onInterrupted` (server-confirmed stop) so the next Gemini response plays normally
  - `suppressTextRef` — mirrors audio suppression for text; set on interrupt click, cleared on `onInterrupted`; prevents transcript from continuing to fill after the user clicks Interrupt
