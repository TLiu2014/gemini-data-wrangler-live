# Gemini Data Wrangler Live

Real-time voice and visual AI agent for collaborative data wrangling. Built for the Gemini Live Agent Challenge.

Talk to the AI agent via live voice, and watch it manipulate your data pipeline in real time -- no text chat box needed.

## Tech Stack

- **Frontend:** React + Vite, React Flow, DuckDB-WASM, Recharts
- **Backend:** Node.js + Fastify, WebSockets
- **AI:** Gemini 2.0 Flash via Google ADK (TypeScript)
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

## License

[MIT](LICENSE)
