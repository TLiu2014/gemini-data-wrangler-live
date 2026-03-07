import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { GeminiLiveSession } from "./agent/gemini-live.js";

export interface WsMessage {
  type:
    | "audio"
    | "screenshot"
    | "action"
    | "sql"
    | "status"
    | "text"
    | "user_text"
    | "schema"
    | "tool_result";
  payload: unknown;
}

export function registerWebSocketRoutes(app: FastifyInstance) {
  app.register(async (fastify) => {
    fastify.get("/ws", { websocket: true }, async (socket: WebSocket) => {
      console.log("Client connected");

      let gemini: GeminiLiveSession | null = null;

      // Start Gemini Live session for this client
      try {
        gemini = new GeminiLiveSession(socket);
        await gemini.connect();
      } catch (err) {
        console.error("Failed to start Gemini session:", err);
        const errMsg: WsMessage = {
          type: "status",
          payload: { gemini: "error", detail: String(err) },
        };
        socket.send(JSON.stringify(errMsg));
      }

      socket.on("message", async (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const msg: WsMessage = JSON.parse(raw.toString());

          switch (msg.type) {
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
