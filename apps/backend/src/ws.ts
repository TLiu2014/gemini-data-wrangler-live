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
    | "text";
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
