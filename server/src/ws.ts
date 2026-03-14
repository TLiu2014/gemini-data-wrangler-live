import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { GeminiLiveSession } from "./agent/gemini-live.js";
import { resolveApiKey, validateApiKey } from "./apiKeyStore.js";

export interface WsMessage {
  type:
    | "init"
    | "audio"
    | "screenshot"
    | "action"
    | "sql"
    | "status"
    | "text"
    | "user_text"
    | "thinking"
    | "interrupted"
    | "schema"
    | "tool_result"
    | "canvas_execute"
    | "canvas_complete"
    | "connect_intro";
  payload: unknown;
}

export function registerWebSocketRoutes(app: FastifyInstance) {
  app.register(async (fastify) => {
    fastify.get("/ws", { websocket: true }, async (socket: WebSocket) => {
      console.log("Client connected");

      let gemini: GeminiLiveSession | null = null;

      // Helper to start the Gemini session with the resolved API key.
      // Called from the "init" message handler below.
      async function startGeminiSession(clientApiKey: string) {
        // Client key takes precedence; fall back to server env var (localhost dev).
        const apiKey = clientApiKey || resolveApiKey();
        if (!apiKey) {
          socket.send(JSON.stringify({
            type: "status",
            payload: { gemini: "error", detail: "No API key provided. Enter your Gemini API key in Settings." },
          } satisfies WsMessage));
          return;
        }
        try {
          gemini = new GeminiLiveSession(socket, apiKey);
          await gemini.connect();
        } catch (err) {
          console.error("Failed to start Gemini session:", err);
          socket.send(JSON.stringify({
            type: "status",
            payload: { gemini: "error", detail: String(err) },
          } satisfies WsMessage));
        }
      }

      socket.on("message", async (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const msg: WsMessage = JSON.parse(raw.toString());

          switch (msg.type) {
            case "init": {
              // First message from client — carries the user's API key for this session.
              const payload = msg.payload as { apiKey?: string };
              const clientKey = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
              // Validate only if the client sent a key (empty means "use server env var")
              if (clientKey && !validateApiKey(clientKey)) {
                socket.send(JSON.stringify({
                  type: "status",
                  payload: { gemini: "error", detail: "Invalid API key format. Check your key in Settings." },
                } satisfies WsMessage));
                return;
              }
              await startGeminiSession(clientKey);
              break;
            }
            case "audio": {
              const payload = msg.payload as { data: string };
              gemini?.sendAudio(payload.data);
              break;
            }

            case "screenshot": {
              const payload = msg.payload as { data: string };
              gemini?.sendScreenshot(payload.data);
              break;
            }

            case "schema": {
              const payload = msg.payload as { schemas: Record<string, string[]> };
              gemini?.sendSchemaContext(payload.schemas);
              break;
            }

            case "tool_result": {
              const payload = msg.payload as {
                toolCallId: string;
                toolName: string;
                result: Record<string, unknown>;
              };
              gemini?.sendToolResult(payload.toolCallId, payload.toolName, payload.result);
              break;
            }

            case "canvas_execute": {
              const payload = msg.payload as { graphState: unknown; schemas?: Record<string, string[]> };
              await gemini?.sendCanvasExecutionRequest(payload.graphState, payload.schemas);
              break;
            }

            case "canvas_complete": {
              gemini?.sendCanvasCompletionPrompt();
              break;
            }

            case "connect_intro": {
              const payload = msg.payload as {
                tables?: string[];
                graphState?: unknown;
              };
              gemini?.sendConnectIntro(payload.tables, payload.graphState);
              break;
            }

            case "status": {
              const payload = msg.payload as { uiContext?: unknown };
              if (payload?.uiContext) {
                gemini?.sendUiContext(payload.uiContext);
              }
              break;
            }

            default:
              console.log("Unhandled message type:", msg.type);
          }
        } catch (err) {
          console.error("Bad WS message:", err);
        }
      });

      socket.on("close", () => {
        console.log("Client disconnected");
        gemini?.disconnect();
        gemini = null;
      });

      const welcome: WsMessage = {
        type: "status",
        payload: { connected: true },
      };
      socket.send(JSON.stringify(welcome));
    });
  });
}
