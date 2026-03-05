import { GoogleGenAI, Modality, type Session } from "@google/genai";
import type { WebSocket } from "@fastify/websocket";
import type { WsMessage } from "../ws.js";
import { getToolDeclarations, handleToolCall } from "./tools.js";

const GEMINI_MODEL = "gemini-2.0-flash-live-001";

const SYSTEM_INSTRUCTION = `You are a data wrangling assistant inside a visual pipeline editor.
The user talks to you via voice. You can see their screen.
You have tools to:
- Add nodes to the pipeline graph (CSV import, filter, transform, output)
- Execute SQL queries against the user's data via DuckDB
- Render charts from the data
When the user asks you to manipulate data or the pipeline, use your tools.
Be concise in your spoken responses — the user is watching the UI update in real time.`;

export class GeminiLiveSession {
  private session: Session | null = null;
  private clientSocket: WebSocket;
  private ai: GoogleGenAI;

  constructor(clientSocket: WebSocket) {
    this.clientSocket = clientSocket;
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
    this.ai = new GoogleGenAI({ apiKey });
  }

  async connect(): Promise<void> {
    this.session = await this.ai.live.connect({
      model: GEMINI_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        tools: [{ functionDeclarations: getToolDeclarations() }],
      },
      callbacks: {
        onopen: () => {
          console.log("Gemini Live session opened");
          this.sendToClient({ type: "status", payload: { gemini: "connected" } });
        },
        onmessage: (msg) => {
          this.handleGeminiMessage(msg);
        },
        onerror: (err) => {
          console.error("Gemini Live error:", err);
          this.sendToClient({ type: "status", payload: { gemini: "error", detail: String(err) } });
        },
        onclose: () => {
          console.log("Gemini Live session closed");
          this.sendToClient({ type: "status", payload: { gemini: "disconnected" } });
        },
      },
    });
  }

  private handleGeminiMessage(msg: any): void {
    // Audio response from the model
    const audioParts = msg.serverContent?.modelTurn?.parts?.filter(
      (p: any) => p.inlineData?.mimeType?.startsWith("audio/"),
    );
    if (audioParts?.length) {
      for (const part of audioParts) {
        this.sendToClient({
          type: "audio",
          payload: {
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          },
        });
      }
    }

    // Text response (for debugging / fallback)
    const textParts = msg.serverContent?.modelTurn?.parts?.filter(
      (p: any) => p.text,
    );
    if (textParts?.length) {
      for (const part of textParts) {
        this.sendToClient({ type: "text", payload: { text: part.text } });
      }
    }

    // Tool calls from the model
    const toolCalls = msg.toolCall?.functionCalls;
    if (toolCalls?.length) {
      const responses = toolCalls.map((call: any) => {
        const result = handleToolCall(this.clientSocket, call.name, call.args);
        return { id: call.id, name: call.name, response: result };
      });
      this.session?.sendToolResponse({ functionResponses: responses });
    }
  }

  sendAudio(base64Audio: string): void {
    this.session?.sendRealtimeInput({
      media: { mimeType: "audio/pcm;rate=16000", data: base64Audio },
    });
  }

  sendScreenshot(base64Image: string): void {
    this.session?.sendRealtimeInput({
      media: { mimeType: "image/jpeg", data: base64Image },
    });
  }

  disconnect(): void {
    this.session?.close();
    this.session = null;
  }

  private sendToClient(msg: WsMessage): void {
    if (this.clientSocket.readyState === 1) {
      this.clientSocket.send(JSON.stringify(msg));
    }
  }
}
