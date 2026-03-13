import { GoogleGenAI, Modality, type Session } from "@google/genai";
import type { WebSocket } from "@fastify/websocket";
import type { WsMessage } from "../ws.js";
import { getToolDeclarations, handleToolCall } from "./tools.js";
import { resolveApiKey } from "../apiKeyStore.js";

// Dual-model setup:
// • CHAT model  — used for the persistent voice session. 12-2025 has superior audio
//   quality but a known "1008 Tool Calling" bug (function calling over WebSockets
//   triggers close code 1008). Voice chat rarely needs tool calls so this is acceptable.
// • EXECUTE model — spun up on-demand for canvas execution, which relies heavily on
//   tool calls (executeDataTransform). 09-2025 does NOT have the 1008 bug.
const GEMINI_MODEL_CHAT = "gemini-2.5-flash-native-audio-preview-12-2025";
const GEMINI_MODEL_EXECUTE = "gemini-2.5-flash-native-audio-preview-09-2025";


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
- EXACT COLUMN NAMES: Before writing ANY SQL, check the [DATA CONTEXT] schemas for the exact column names. NEVER guess or invent column names — only use columns that are explicitly listed. Common mistakes to avoid: "date" (should be "order_date"), "name" (should be "customer_name" or "product_name" — check the schema), "region" (may not exist — check first).
- SQL ERROR RECOVERY: If a query returns an error, read the error message carefully. If it says "column not found" with "Candidate bindings", use one of those candidate columns instead and retry immediately. Do NOT repeat the same wrong column name. For other errors, try a simpler version of the query.
- When you use executeDataTransform, the SQL runs in DuckDB-WASM in the user's browser. You will receive the query results (row count, columns, sample rows, or errors) as a tool response so you can summarize them.
- Be concise in your spoken responses — the user is watching the UI update in real time. Keep it natural and conversational, like a person.
- Do not say "unknown" about the data. You always have the latest schema context.
- RESULT TABLE NAMING: When creating tables with CREATE TABLE, use descriptive snake_case names that reflect the operation. For example: "customer_orders_join", "filtered_active_customers", "orders_by_region". NEVER overwrite or reuse source table names.
- UNDO / REDO: When the user asks to undo, remove, or redo a transformation, use removeTransform with the table name. Always confirm with the user VERBALLY before calling removeTransform. For redo, remove the old result first, then re-execute the transform.
- LANGUAGE: The user speaks English only. All input and output is in English. If the transcription looks like a non-English language, it's a misrecognition from background noise or a brief interruption — just say something casual like "Sorry, I didn't catch that — could you say that again?" Do NOT mention other languages or say "I only support English."
- OFF-TOPIC QUESTIONS: If the user asks a general question not related to data wrangling or the current pipeline, answer very briefly (one short sentence) and gently steer back, e.g. "Good question — [short answer]. Now, anything you'd like me to do with the data?"
- DATA UPLOAD: If the user mentions uploading or importing data, tell them to use the file upload area in the sidebar. Do NOT create load or csv-import nodes yourself — those appear automatically when files are uploaded.

APP UI AWARENESS — The user can ask about features or how to do things. You should guide them to the correct UI control. Here is what's available:

Left sidebar (top to bottom):
• "Data Source" file upload area — drag-and-drop or click to upload CSV files. A LOAD node appears automatically for each file.
• Agent status indicator — shows whether you (Gemini) are connected, connecting, or disconnected.
• Audio visualizers — two waveform bars showing the user's mic level and your (Gemini's) audio level.
• "Connect" / "Disconnect" button — manually connect or disconnect the voice session (only visible if auto-connect is off in Settings).
• "Mute" / "Unmute" button — toggle the user's microphone on or off.
• "Interrupt" button — cuts off your current speech so the user can take their turn. Only active while you are speaking.
• "Pause" / "Resume" button — pauses your audio output without interrupting (you keep talking silently). "Resume" replays from where it left off.
• "Export" button — exports the entire chat conversation as a Markdown file download. Only active when there are messages.
• Chat log — scrollable transcript of the conversation (both user and Gemini messages). Each Gemini message may have a "Show thinking" toggle.

Canvas toolbar (above the pipeline graph):
• "Add Stage" button — opens a dropdown to pick a stage type (Filter, Join, Union, Group, Select, Sort, Custom SQL), then opens a configuration dialog.
• "Execute Canvas" button — sends the current pipeline to you (Gemini) so you can analyze it and fill in any incomplete stages automatically.

Top bar:
• Settings gear icon — opens a panel to set the API key, toggle auto-connect, toggle "start mic muted", enable sample data/flow, and switch the layout between top-bottom and left-right.

Pipeline graph interactions:
• Double-click a stage node — opens the configuration dialog to edit or change the stage type.
• Drag between node handles — connects nodes with edges.
• Delete key on a selected node — removes it from the pipeline.

When the user asks about the app's features, how to do something, or what you can do, treat it as a HELP conversation — NOT an off-topic question. Be friendly and helpful: explain the feature clearly (2-3 sentences is fine), then ask if they have any other questions about the app or if they'd like to start working with their data. Do NOT rush them back to data transformation. For example: "Sure! The Export button is in the left sidebar — it saves our entire conversation as a Markdown file you can keep for reference. Want to know about anything else in the app, or shall we dive into your data?"`;

export class GeminiLiveSession {
  private session: Session | null = null;
  private executeSession: Session | null = null;
  private executeCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private clientSocket: WebSocket;
  private ai: GoogleGenAI;
  private auxiliaryClientContentGuardUntil = 0;
  private executePlannedActions: string[] = [];

  private static readonly CANVAS_GUARD_MS = 60000;
  private static readonly EXECUTE_CLEANUP_DELAY_MS = 15_000;

  constructor(clientSocket: WebSocket) {
    this.clientSocket = clientSocket;
    const apiKey = resolveApiKey();
    if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
    this.ai = new GoogleGenAI({ apiKey });
  }

  async connect(): Promise<void> {
    this.session = await this.ai.live.connect({
      model: GEMINI_MODEL_CHAT,
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
          this.handleGeminiMessage(msg, false);
        },
        onerror: (err) => {
          console.error("Gemini Live error (guard active: %s):", this.isAuxiliaryClientContentGuarded(), err);
          this.sendToClient({ type: "status", payload: { gemini: "error", detail: String(err) } });
        },
        onclose: (ev) => {
          console.log("Gemini Live session closed (guard active: %s, code: %s, reason: %s)",
            this.isAuxiliaryClientContentGuarded(),
            (ev as any)?.code ?? "?",
            (ev as any)?.reason ?? (ev as any)?.message ?? "?");
          this.sendToClient({ type: "status", payload: { gemini: "disconnected" } });
        },
      },
    });
  }

  private isDisplayableEnglishTranscript(text: string | undefined | null): text is string {
    if (!text) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;

    // Suppress obvious non-English-script mistranscriptions in the visible chat log.
    if (/[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3000-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\u1100-\u11FF]/.test(trimmed)) {
      return false;
    }

    const lettersOnly = trimmed.replace(/[^A-Za-z]/g, "");
    return lettersOnly.length > 0;
  }

  private handleGeminiMessage(msg: any, fromExecute: boolean): void {
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
    // Forward all non-empty transcription to the client — let the client decide
    // what to display.  Filtering here drops partial chunks and causes missing words.
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
        const targetSession = fromExecute ? this.executeSession : this.session;
        targetSession?.sendToolResponse({ functionResponses: immediateResponses });
      }
    }
  }

  sendAudio(base64Audio: string): void {
    this.session?.sendRealtimeInput({
      media: { mimeType: "audio/pcm;rate=16000", data: base64Audio },
    });
  }

  sendScreenshot(base64Image: string): void {
    if (this.isAuxiliaryClientContentGuarded()) {
      return;
    }
    this.session?.sendRealtimeInput({
      media: { mimeType: "image/jpeg", data: base64Image },
    });
  }

  sendSchemaContext(schemas: Record<string, string[]>): void {
    if (this.isAuxiliaryClientContentGuarded()) {
      console.log("Skipping schema context during active canvas turn");
      return;
    }

    const lines = Object.entries(schemas).map(
      ([table, cols]) => `Table "${table}": ${cols.join(", ")}`,
    );
    const text = `[DATA CONTEXT] The user has loaded the following tables:\n${lines.join("\n")}\nIMPORTANT: Use ONLY the exact column names listed above in your SQL. Do NOT invent columns that are not listed.`;
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
    const targetSession = this.executeSession ?? this.session;
    try {
      targetSession?.sendToolResponse({
        functionResponses: [{ id: toolCallId, name: toolName, response: result }],
      });
    } catch (err) {
      console.warn("Failed to send tool result to Gemini:", err);
    }
  }

  async sendCanvasExecutionRequest(graphState: unknown, schemas?: Record<string, string[]>): Promise<void> {
    this.beginAuxiliaryClientContentGuard();
    this.closeExecuteSession();

    // Build compact schema lines
    let schemaLines = "";
    if (schemas && Object.keys(schemas).length > 0) {
      const lines = Object.entries(schemas).map(
        ([table, cols]) => `  ${table}: ${cols.join(", ")}`,
      );
      schemaLines = `\nLoaded tables:\n${lines.join("\n")}`;
    }

    // Pre-parse graph state for a human-readable summary so Gemini can narrate specifics
    const state = graphState as { nodes: { id: string; stageType: string; label: string; tableName: string | null; stageConfig: any; executionState: string | null }[]; edges: { source: string; target: string }[] };
    const loadedTableNames = state.nodes
      .filter((n) => n.tableName && ["load", "start"].includes(n.stageType.toLowerCase()))
      .map((n) => n.tableName!);
    const incompleteNodes = state.nodes
      .filter((n) => n.executionState === "running" && !n.tableName);
    const incompleteStageTypes = incompleteNodes.map((n) => n.stageType.toLowerCase());
    const plannedActions = incompleteNodes.map((node) => {
      const stageType = node.stageType.toLowerCase();
      const config = node.stageConfig ?? {};
      switch (stageType) {
        case "join":
          if (config.leftTable && config.rightTable) {
            const joinKey = config.leftKey && config.rightKey
              ? ` using ${config.leftKey} = ${config.rightKey}`
              : "";
            return `complete the join between ${config.leftTable} and ${config.rightTable}${joinKey}`;
          }
          return "complete the join stage";
        case "filter":
          if (config.table && config.column) {
            return `complete the filter on ${config.table}.${config.column}`;
          }
          return "complete the filter stage";
        case "group":
          if (config.groupTable) {
            return `complete the grouping step for ${config.groupTable}`;
          }
          return "complete the group stage";
        case "select":
          if (config.selectTable) {
            return `complete the select step for ${config.selectTable}`;
          }
          return "complete the select stage";
        case "sort":
          if (config.sortTable && config.sortColumn) {
            return `complete the sort on ${config.sortTable}.${config.sortColumn}`;
          }
          return "complete the sort stage";
        case "union":
          if (Array.isArray(config.unionTables) && config.unionTables.length > 0) {
            return `complete the union of ${config.unionTables.join(" and ")}`;
          }
          return "complete the union stage";
        default:
          return `complete the ${stageType} stage`;
      }
    });
    this.executePlannedActions = plannedActions;

    let pipelineSummary = "Pipeline summary: ";
    if (loadedTableNames.length > 0) {
      pipelineSummary += `${loadedTableNames.length} loaded table${loadedTableNames.length > 1 ? "s" : ""} (${loadedTableNames.join(", ")})`;
    } else {
      pipelineSummary += "no loaded tables";
    }
    if (incompleteStageTypes.length > 0) {
      pipelineSummary += `, ${incompleteStageTypes.length} incomplete stage${incompleteStageTypes.length > 1 ? "s" : ""} to execute: ${incompleteStageTypes.join(", ")}`;
    }
    const plannedActionsText = plannedActions.length > 0
      ? `Planned work:\n- ${plannedActions.join("\n- ")}`
      : "Planned work: nothing to execute.";

    // Compact JSON (no pretty-printing) to stay within Gemini Live per-turn limits
    const stateJson = JSON.stringify(graphState);

    const prompt = `[CANVAS EXECUTION REQUEST]
The user clicked "Execute Canvas".${schemaLines}

${pipelineSummary}
${plannedActionsText}

Pipeline graph state (nodes with executionState "running" and no tableName need to be executed):
${stateJson}

You are in EXECUTE mode. Act proactively — execute the incomplete stages without waiting for the user to tell you what to do. You may ask clarifying questions if genuinely needed.

Your task:
1. Start with ONE single greeting (do NOT split into multiple responses). In that greeting: name the loaded tables (${loadedTableNames.join(", ") || "none"}), list the incomplete stages (${incompleteStageTypes.join(", ") || "none"}), and say exactly what the status is at the moment you first speak. If work is still in progress, use explicit wording like "I'm doing the join stage now" or "I'm completing the filter stage now." If the work has already finished by the time you first speak, say that explicitly, for example "The join stage is done." Keep it to 2-3 sentences. Do NOT say "hello" or greet separately before this.
2. Then process ONE incomplete node at a time (executionState "running" and tableName null). Before each, briefly say what you're doing (e.g. "Adding the join now."), then call executeDataTransform with the SQL. Wait for the result before moving to the next.
3. After EACH tool result comes back, briefly narrate the outcome (e.g. "The join produced 10 rows. Now applying the filter.").
4. Use each node's stageConfig.resultName as the CREATE TABLE name. If stageConfig is null or has no resultName, generate a descriptive snake_case name based on the stage type and connected tables (e.g. "customers_orders_join").
5. Process in dependency order — upstream nodes first.
6. Always respond in English only.
7. INCOMPLETE STAGE CONFIGS: If a node's stageConfig has empty or missing fields (e.g. a filter with no column/value, a join with no keys), do NOT generate SQL with empty strings. Instead, infer sensible defaults from the table schemas (e.g. pick a meaningful column to filter on, find matching key columns for joins). If you truly cannot infer, briefly tell the user the stage needs configuration and skip it.
8. EXACT COLUMN NAMES: Always use the exact column names from the loaded table schemas above. Do NOT guess or abbreviate (e.g. use "order_date" not "date", "customer_id" not "id"). If unsure, refer back to the schema list.
9. When ALL stages are done, give a brief spoken summary that starts with "All done" or "Done". Explicitly mention each stage you completed and key results (e.g. row counts). Example: "All done! The join produced 10 rows, and after filtering I got 9 active customers."`;

    console.log("Creating execute session (model: %s, prompt length: %d)", GEMINI_MODEL_EXECUTE, prompt.length);
    try {
      this.executeSession = await this.ai.live.connect({
        model: GEMINI_MODEL_EXECUTE,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { languageCode: "en-US" },
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          tools: [{ functionDeclarations: getToolDeclarations() }],
          outputAudioTranscription: {},
        } as any,
        callbacks: {
          onopen: () => {
            console.log("Execute session opened");
          },
          onmessage: (msg) => {
            this.handleGeminiMessage(msg, true);
          },
          onerror: (err) => {
            console.error("Execute session error:", err);
          },
          onclose: (ev) => {
            console.log("Execute session closed (code: %s, reason: %s)",
              (ev as any)?.code ?? "?",
              (ev as any)?.reason ?? (ev as any)?.message ?? "?");
            this.executeSession = null;
          },
        },
      });

      (this.executeSession as any)?.sendClientContent?.({
        turns: [{ role: "user", parts: [{ text: prompt }] }],
        turnComplete: true,
      });
    } catch (err) {
      console.warn("Failed to create execute session:", err);
      this.executeSession = null;
    }
  }

  sendCanvasCompletionPrompt(): void {
    const targetSession = this.executeSession ?? this.session;
    const plannedActionsText = this.executePlannedActions.length > 0
      ? this.executePlannedActions.join("; ")
      : "the requested canvas stages";
    const text = `[CANVAS EXECUTION COMPLETE]
The requested pipeline execution is complete.
Now respond to the user with a brief spoken update in English.
- Start with "All done" or "Done".
- Explicitly say the stage work is done, for example "The join stage is done." Then say what you completed: ${plannedActionsText}.
- Summarize what you completed in 1-2 short sentences.
- Mention any stage that could not be completed, if applicable.
- Do not ask the user to click anything unless action is still needed.`;

    console.log("Sending canvas completion prompt to %s session", this.executeSession ? "execute" : "chat");
    try {
      (targetSession as any)?.sendClientContent?.({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    } catch (err) {
      console.warn("Failed to send canvas completion prompt:", err);
    }

    // Schedule execute session cleanup — give Gemini time to respond with audio
    this.scheduleExecuteCleanup();
  }

  sendConnectIntro(tables?: string[], graphState?: unknown): void {
    const tableList = (tables ?? []).filter(Boolean);
    const tablesText = tableList.length > 0
      ? `Loaded tables: ${tableList.join(", ")}.`
      : "No tables are loaded yet.";
    const graphText = graphState
      ? `Current pipeline state: ${JSON.stringify(graphState).slice(0, 5000)}`
      : "Current pipeline state: empty graph.";

    const text = `[MANUAL CONNECT INTRO]
The user just clicked Connect in manual mode.
Respond immediately with one short spoken greeting in English.
- Mention the current workspace state.
- If tables are loaded, name them briefly.
- If there are incomplete stages, mention that briefly.
- Keep it natural and concise, about 1-2 sentences.

${tablesText}
${graphText}`;

    try {
      (this.session as any)?.sendClientContent?.({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    } catch (err) {
      console.warn("Failed to send connect intro prompt:", err);
    }
  }

  sendUiContext(uiContext: unknown): void {
    if (this.isAuxiliaryClientContentGuarded()) {
      console.log("Skipping UI context during active canvas turn");
      return;
    }

    const text = `[UI CONTEXT — do not respond] ${JSON.stringify(uiContext).slice(0, 8000)}`;
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
    this.closeExecuteSession();
    this.session?.close();
    this.session = null;
    this.auxiliaryClientContentGuardUntil = 0;
  }

  private closeExecuteSession(): void {
    if (this.executeCleanupTimer) {
      clearTimeout(this.executeCleanupTimer);
      this.executeCleanupTimer = null;
    }
    if (this.executeSession) {
      console.log("Closing execute session");
      this.executeSession.close();
      this.executeSession = null;
      this.executePlannedActions = [];

      // Clear the guard — execute session is done, chat session is safe for context updates
      this.auxiliaryClientContentGuardUntil = 0;

      // Refresh chat session with updated schemas (new tables from execution)
      this.sendToClient({ type: "status", payload: { requestSchemas: true } });
    }
  }

  private scheduleExecuteCleanup(): void {
    if (this.executeCleanupTimer) clearTimeout(this.executeCleanupTimer);
    this.executeCleanupTimer = setTimeout(() => {
      this.executeCleanupTimer = null;
      this.closeExecuteSession();
    }, GeminiLiveSession.EXECUTE_CLEANUP_DELAY_MS);
  }

  private beginAuxiliaryClientContentGuard(): void {
    this.auxiliaryClientContentGuardUntil = Date.now() + GeminiLiveSession.CANVAS_GUARD_MS;
  }

  private isAuxiliaryClientContentGuarded(): boolean {
    return Date.now() < this.auxiliaryClientContentGuardUntil;
  }

  private sendToClient(msg: WsMessage): void {
    if (this.clientSocket.readyState === 1) {
      this.clientSocket.send(JSON.stringify(msg));
    }
  }
}
