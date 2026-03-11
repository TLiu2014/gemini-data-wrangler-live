import { GoogleGenAI, Modality, type Session } from "@google/genai";
import type { WebSocket } from "@fastify/websocket";
import type { WsMessage } from "../ws.js";
import { getToolDeclarations, handleToolCall } from "./tools.js";
import { resolveApiKey } from "../apiKeyStore.js";

// Google AI Studio (free tier) model ID for Gemini 2.5 Flash Multimodal Live API.
// If this throws "model not found", check AI Studio docs for the latest month suffix.
// Vertex AI GA equivalent: "gemini-live-2.5-flash-native-audio"
const GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

const SYSTEM_INSTRUCTION = `You are a data wrangling assistant inside a visual pipeline editor.
The user talks to you via voice. Always respond in English.
You do NOT have vision — you rely on table schemas and text context the user provides.

You will receive [DATA CONTEXT] messages containing table schemas (table names, column names, and types).
Use these schemas to understand the user's data WITHOUT asking them to describe it.

You have tools to:
- Execute SQL queries against the user's data via DuckDB (running locally in the browser) — this AUTOMATICALLY creates pipeline nodes in the UI, so do NOT also call addReactFlowNode for the same operation.
- Add nodes to the pipeline graph manually (only use addReactFlowNode for non-SQL operations like CSV import)
- Render charts from the data
- Remove transformations (undo)

IMPORTANT RULES:
- When the user asks you to manipulate data, ACT IMMEDIATELY using your tools. Do NOT ask clarifying questions if the schema context gives you enough information.
- For JOINs: inspect the schemas to find matching column names between tables (e.g. customer_id in both). Use standard SQL: CREATE OR REPLACE TABLE result_name AS SELECT ... FROM t1 JOIN t2 ON t1.key = t2.key. Pick sensible defaults (INNER JOIN, select all columns). Only call executeDataTransform — do NOT also call addReactFlowNode (the node is created automatically).
- TOOL USAGE: When you call executeDataTransform with CREATE TABLE, the UI automatically creates a pipeline node (join, filter, select, etc.) based on the SQL. Do NOT call addReactFlowNode for the same transformation. NEVER use addReactFlowNode to create load/csv-import nodes — those are created automatically when the user uploads files. Only use addReactFlowNode for manually adding empty placeholder stages (rare).
- OPERATION VALIDATION: Before executing a data operation, check if it makes sense for the data. For example, UNION requires tables with the same (or compatible) columns. If the user asks for an operation that doesn't fit (e.g. "union" when the tables have different schemas and should be joined), briefly explain why it won't work (one sentence), suggest the correct operation, and ask for confirmation before proceeding. Don't just blindly execute.
- Write simple, straightforward SQL. Do NOT worry about data type serialization, casting, or BigInt issues — the runtime handles type conversions automatically. Never try to cast columns to work around serialization errors.
- If a query returns an error, try a simpler version of the query instead of adding complex type casts.
- When you use executeDataTransform, the SQL runs in DuckDB-WASM in the user's browser. You will receive the query results (row count, columns, sample rows, or errors) as a tool response so you can summarize them.
- Be concise in your spoken responses — the user is watching the UI update in real time. Keep it natural and conversational, like a person.
- Do not say "unknown" about the data. You always have the latest schema context.
- RESULT TABLE NAMING: When creating tables with CREATE TABLE, use descriptive snake_case names that reflect the operation. For example: "customer_orders_join", "filtered_active_customers", "orders_by_region". NEVER overwrite or reuse source table names.
- UNDO / REDO: When the user asks to undo, remove, or redo a transformation, use removeTransform with the table name. Always confirm with the user VERBALLY before calling removeTransform. For redo, remove the old result first, then re-execute the transform.
- LANGUAGE: This app supports English only. If the user speaks in another language (e.g. Chinese/Mandarin), respond briefly in English saying "I only support English for now, please speak in English." and do not attempt to process the non-English request.
- OFF-TOPIC QUESTIONS: If the user asks a general question not related to data wrangling or the current pipeline, answer very briefly (one short sentence) and gently steer back, e.g. "Good question — [short answer]. Now, anything you'd like me to do with the data?"
- DATA UPLOAD: If the user mentions uploading or importing data, tell them to use the file upload area in the sidebar. Do NOT create load or csv-import nodes yourself — those appear automatically when files are uploaded.`;

export class GeminiLiveSession {
  private session: Session | null = null;
  private clientSocket: WebSocket;
  private ai: GoogleGenAI;

  constructor(clientSocket: WebSocket) {
    this.clientSocket = clientSocket;
    const apiKey = resolveApiKey();
    if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
    this.ai = new GoogleGenAI({ apiKey });
  }

  async connect(): Promise<void> {
    this.session = await this.ai.live.connect({
      model: GEMINI_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { languageCode: "en-US" },
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        tools: [{ functionDeclarations: getToolDeclarations() }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      } as any,
      callbacks: {
        onopen: () => {
          console.log("Gemini Live session opened");
          this.sendToClient({ type: "status", payload: { gemini: "connected" } });
          // Ask frontend to send current table schemas so Gemini has context
          this.sendToClient({ type: "status", payload: { requestSchemas: true } });
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
    // Model interrupted by user speech — stop playing the current response
    if (msg.serverContent?.interrupted === true) {
      this.sendToClient({ type: "interrupted", payload: {} });
      return;
    }

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

    // Model thinking / reasoning text (not spoken aloud)
    const textParts = msg.serverContent?.modelTurn?.parts?.filter(
      (p: any) => p.text,
    );
    if (textParts?.length) {
      for (const part of textParts) {
        this.sendToClient({ type: "thinking", payload: { text: part.text } });
      }
    }

    // Input transcription (user's speech → text)
    const inputTranscript = msg.serverContent?.inputTranscription?.text
      ?? (msg as any).inputTranscription?.text;
    if (inputTranscript) {
      this.sendToClient({ type: "user_text", payload: { text: inputTranscript } });
    }

    // Output transcription (model's speech → text)
    const outputTranscript = msg.serverContent?.outputTranscription?.text
      ?? (msg as any).outputTranscription?.text;
    if (outputTranscript) {
      this.sendToClient({ type: "text", payload: { text: outputTranscript } });
    }

    // Tool calls from the model
    const toolCalls = msg.toolCall?.functionCalls;
    if (toolCalls?.length) {
      const immediateResponses: any[] = [];
      for (const call of toolCalls) {
        if (call.name === "executeDataTransform" || call.name === "removeTransform") {
          // Defer: send to frontend for execution; frontend will return results via tool_result
          handleToolCall(this.clientSocket, call.name, call.args, call.id);
        } else {
          const result = handleToolCall(this.clientSocket, call.name, call.args);
          immediateResponses.push({ id: call.id, name: call.name, response: result });
        }
      }
      if (immediateResponses.length > 0) {
        this.session?.sendToolResponse({ functionResponses: immediateResponses });
      }
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

  sendSchemaContext(schemas: Record<string, string[]>): void {
    const lines = Object.entries(schemas).map(
      ([table, cols]) => `Table "${table}": ${cols.join(", ")}`,
    );
    const text = `[DATA CONTEXT] The user has loaded the following tables:\n${lines.join("\n")}`;
    console.log("Sending schema context to Gemini:", text);
    try {
      (this.session as any)?.sendClientContent?.({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    } catch (err) {
      console.warn("Failed to send schema context:", err);
    }
  }

  sendToolResult(toolCallId: string, toolName: string, result: Record<string, unknown>): void {
    try {
      this.session?.sendToolResponse({
        functionResponses: [{ id: toolCallId, name: toolName, response: result }],
      });
    } catch (err) {
      console.warn("Failed to send tool result to Gemini:", err);
    }
  }

  sendUiContext(uiContext: unknown): void {
    const text = `UI Navigator update: ${JSON.stringify(uiContext).slice(0, 8000)}`;
    try {
      (this.session as any)?.sendClientContent?.({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: false,
      });
    } catch (err) {
      console.warn("Failed to send UI context to Gemini:", err);
    }
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
