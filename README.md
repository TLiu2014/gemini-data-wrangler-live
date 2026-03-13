# Gemini Data Wrangler Live

Real-time voice and visual AI agent for collaborative data wrangling. Built for the Gemini Live Agent Challenge.

Talk to the AI agent via live voice, and watch it manipulate your data pipeline in real time -- no text chat box needed.

## Tech Stack

- **Frontend:** React + Vite, React Flow, DuckDB-WASM, Recharts
- **Backend:** Node.js + Fastify, WebSockets
- **AI:** Gemini 2.5 Flash Native Audio (`gemini-2.5-flash-native-audio-preview-09-2025`) via Google GenAI SDK
- **Deploy:** Google Cloud Run

## Prerequisites

- Node.js >= 20
- npm >= 10
- A [Google AI API key](https://aistudio.google.com/apikey)

## Setup

```bash
# Clone the repo
git clone https://github.com/TLiu2014/gemini-data-wrangler-live.git
cd gemini-data-wrangler-live

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env and add your GOOGLE_API_KEY
```

## Running

```bash
npm start
```

This starts both the backend (http://localhost:3001) and frontend (http://localhost:5173) concurrently.

Open http://localhost:5173 in your browser, click **Connect**, and start talking.

## Project Structure

```
server/            Node.js + Fastify WebSocket server
  src/
    index.ts        Server entry point
    ws.ts           WebSocket message routing
    agent/
      tools.ts      Gemini ADK tool definitions
ui/                React + Vite SPA
  src/
    App.tsx         Main 3-pane layout
    hooks/
      useWebSocket.ts   WebSocket client hook
    components/
      Sidebar.tsx       Voice controls + audio visualizer
      FlowPane.tsx      React Flow data pipeline canvas
      DataTable.tsx     DuckDB query results table
```

## Known Issues

### Gemini Model: "1008 Tool Calling" Bug

The newer `gemini-2.5-flash-native-audio-preview-12-2025` model has a known server-side regression where function calling (tools) over WebSockets causes an abrupt disconnect with WebSocket close code **1008**: _"Operation is not implemented, or supported, or enabled."_ This happens when Gemini attempts to send a tool call response back to the client.

**Workaround:** This project uses `gemini-2.5-flash-native-audio-preview-09-2025`, which does not have this bug. The model ID is configured in `server/src/agent/gemini-live.ts`. If Google releases a newer preview that fixes the regression, update the `GEMINI_MODEL` constant.

## License

[MIT](LICENSE)
