import { useRef, useState, useCallback, useEffect } from "react";
import { useWebSocket, type ActionPayload, type WsMessage } from "./hooks/useWebSocket.js";
import { useAudioCapture } from "./hooks/useAudioCapture.js";
import { useAudioPlayback } from "./hooks/useAudioPlayback.js";
import { useScreenCapture } from "./hooks/useScreenCapture.js";
import { useDuckDB } from "./hooks/useDuckDB.js";
import { useMicPermission } from "./hooks/useMicPermission.js";
import TopBar from "./components/TopBar.js";
import Sidebar from "./components/Sidebar.js";
import FlowPane, {
  type FlowPaneHandle,
  type FlowSnapshot,
  type GraphState,
} from "./components/FlowPane.js";
import DataTable from "./components/DataTable.js";
import ChartView from "./components/ChartView.js";
import TableTabs from "./components/TableTabs.js";
import StageConfigDialog from "./components/StageConfigDialog.js";
import type { StageConfig } from "./utils/sqlGenerator.js";
import { SAMPLE_CUSTOMERS_CSV, SAMPLE_ORDERS_CSV } from "./sampleData.js";

function getDisplayableEnglishTranscript(text: string): string | null {
  if (!text || !text.trim()) return null;
  const trimmed = text.trim();

  // Filter non-Latin scripts (CJK, Cyrillic, Arabic, Devanagari, Thai, Korean)
  if (/[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3000-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\u1100-\u11FF]/.test(trimmed)) {
    return null;
  }

  // Allow any chunk with at least one letter or digit (don't drop numbers)
  if (!/[A-Za-z0-9]/.test(trimmed)) return null;

  // Preserve leading space — the transcription API uses it to signal word
  // boundaries.  Only trim the trailing side so appendTranscriptChunk can
  // distinguish "lo" (mid-word continuation) from " world" (new word).
  return text.trimEnd();
}

function appendTranscriptChunk(existingText: string, nextChunk: string): string {
  if (!existingText) return nextChunk.trimStart();
  if (!nextChunk) return existingText;

  // Concatenate directly — the transcription API's own leading spaces mark
  // word boundaries.  Collapse any accidental multi-spaces.
  return (existingText + nextChunk).replace(/ {2,}/g, " ");
}

function dedupeExecuteNarration(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const kept: string[] = [];
  let sawLoadedTables = false;
  let sawInitialStateRestatement = false;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    const normalized = trimmed.toLowerCase().replace(/[`'"]/g, "");
    const mentionsLoadedTables =
      normalized.includes("tables loaded")
      || normalized.includes("loaded tables")
      || normalized.includes("i've loaded")
      || (normalized.includes("we have") && normalized.includes("table"));
    const mentionsInitialStateRestatement =
      (normalized.includes("incomplete") && normalized.includes("stage"))
      || (normalized.includes("pipeline") && normalized.includes("stage"))
      || (normalized.includes("currently processing") && normalized.includes("stage"));

    if (mentionsLoadedTables && sawLoadedTables) continue;
    if (mentionsInitialStateRestatement && sawInitialStateRestatement) continue;

    kept.push(trimmed);
    if (mentionsLoadedTables) sawLoadedTables = true;
    if (mentionsInitialStateRestatement) sawInitialStateRestatement = true;
  }

  return kept.join(" ");
}

function describeCanvasStageProgress(graphState: GraphState | undefined, baseText: string): string {
  const completed = graphState?.nodes
    .filter((n) => n.executionState === "success" && !["load", "start"].includes(n.stageType.toLowerCase()))
    .map((n) => n.stageType.toLowerCase()) ?? [];
  const running = graphState?.nodes
    .filter((n) => n.executionState === "running")
    .map((n) => n.stageType.toLowerCase()) ?? [];

  const parts: string[] = [];
  if (completed.length > 0) {
    parts.push(`Completed ${completed.join(", ")} stage${completed.length > 1 ? "s" : ""}.`);
  }
  if (running.length > 0) {
    parts.push(`Working on ${running.join(", ")}...`);
  }
  if (running.length === 0 && completed.length > 0) {
    parts.push("All stages done!");
  }
  if (parts.length === 0) {
    parts.push("Checking the current pipeline...");
  }

  return [baseText, ...parts].filter(Boolean).join(" ");
}

export default function App() {
  const flowRef = useRef<FlowPaneHandle>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const sidebarResizing = useRef(false);
  const hSplitResizing = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [flowPercent, setFlowPercent] = useState(45);
  const [dataLayout, setDataLayout] = useState<"top-bottom" | "left-right">(
    () =>
      (localStorage.getItem("flow_data_layout") as "top-bottom" | "left-right" | null)
      ?? "top-bottom",
  );

  // API key
  const [apiKey, setApiKey] = useState(
    () => sessionStorage.getItem("gemini_api_key") ?? "",
  );
  const handleApiKeyChange = useCallback((key: string) => {
    setApiKey(key);
    sessionStorage.setItem("gemini_api_key", key);
    // Persist to server (encrypted on disk)
    if (key.trim()) {
      fetch("/api/settings/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key.trim() }),
      }).catch(() => {});
    }
  }, []);

  // Check if the server already has an API key configured (e.g. via .env)
  const [serverHasApiKey, setServerHasApiKey] = useState(false);
  useEffect(() => {
    fetch("/health")
      .then((r) => r.json())
      .then((d: { hasApiKey?: boolean }) => setServerHasApiKey(!!d.hasApiKey))
      .catch(() => {});
  }, []);
  const hasApiKey = !!apiKey || serverHasApiKey;
  const handleDataLayoutChange = useCallback((layout: "top-bottom" | "left-right") => {
    setDataLayout(layout);
    localStorage.setItem("flow_data_layout", layout);
  }, []);

  // Start with mic muted (default: false = unmuted on start)
  const [startMicMuted, setStartMicMuted] = useState(() =>
    localStorage.getItem("start_mic_muted") === "true",
  );
  const handleStartMicMutedChange = useCallback((muted: boolean) => {
    setStartMicMuted(muted);
    localStorage.setItem("start_mic_muted", muted ? "true" : "false");
  }, []);

  // Auto-connect (default: true = previous behaviour)
  const [autoConnect, setAutoConnect] = useState(() =>
    localStorage.getItem("auto_connect") !== "false",
  );
  const handleAutoConnectChange = useCallback((auto: boolean) => {
    setAutoConnect(auto);
    localStorage.setItem("auto_connect", auto ? "true" : "false");
  }, []);

  // Sample data & flow
  const [useSampleData, setUseSampleData] = useState(() =>
    localStorage.getItem("use_sample_data") === "true",
  );
  const [useSampleFlow, setUseSampleFlow] = useState(() =>
    localStorage.getItem("use_sample_flow") === "true",
  );
  const handleUseSampleDataChange = useCallback((use: boolean) => {
    setUseSampleData(use);
    localStorage.setItem("use_sample_data", use ? "true" : "false");
    if (!use) {
      setUseSampleFlow(false);
      localStorage.setItem("use_sample_flow", "false");
    }
  }, []);
  const handleUseSampleFlowChange = useCallback((use: boolean) => {
    setUseSampleFlow(use);
    localStorage.setItem("use_sample_flow", use ? "true" : "false");
    if (use && !useSampleData) {
      setUseSampleData(true);
      localStorage.setItem("use_sample_data", "true");
    }
  }, [useSampleData]);

  // Mic permission
  const { state: micPermission, request: requestMic } = useMicPermission();

  // Unified chat log
  interface ChatMessage {
    role: "user" | "gemini";
    text: string;
    thinking?: string;
    ts: number;
    placeholder?: boolean;
  }
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);

  // Stage config dialog
  const [configStage, setConfigStage] = useState<{
    nodeId: string;
    type: string;
    isNew?: boolean;
  } | null>(null);

  // Status bar
  const [currentStatus, setCurrentStatus] = useState("Ready for data.");
  const [stageCount, setStageCount] = useState(0);
  const addOperation = useCallback((text: string) => {
    setCurrentStatus(text);
  }, []);

  // DuckDB
  const {
    ready: dbReady,
    initError: dbInitError,
    loading: dbLoading,
    tables,
    activeTable,
    activeTableId,
    setActiveTableId,
    error: dbError,
    loadCSV,
    loadCSVFromText,
    executeQuery,
    executeStage,
    dropTable,
    getSchemas,
    resetDatabase,
  } = useDuckDB();

  const tableNameToIdRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const next = new Map<string, string>();
    for (const t of tables) next.set(t.name, t.id);
    tableNameToIdRef.current = next;
  }, [tables]);

  const handleShowTableByName = useCallback(
    (tableName: string) => {
      const id = tableNameToIdRef.current.get(tableName);
      if (id) setActiveTableId(id);
    },
    [setActiveTableId],
  );

  // Chart
  const [chartConfig, setChartConfig] = useState<{
    chartType: string;
    xKey: string;
    yKey: string;
  } | null>(null);

  // Audio playback
  const { playChunk, stop: stopPlayback, interrupt: interruptPlayback, pause: pausePlayback, resume: resumePlayback, paused: audioPaused, isPlaying: geminiSpeaking, analyser: geminiAnalyser } = useAudioPlayback();

  // Canvas execution pending flag (declared early so useWebSocket callbacks can access it)
  const pendingCanvasRef = useRef(false);

  // True while canvas execution is in progress — suppresses uiContext sends that would
  // corrupt the Gemini Live session by calling sendClientContent mid-response.
  const canvasExecutingRef = useRef(false);
  const canvasAwaitSpeechEndRef = useRef(false);
  const canvasResponseStartedRef = useRef(false);
  const canvasCompletionPromptSentRef = useRef(false);
  const canvasReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geminiSpeakingRef = useRef(geminiSpeaking);
  const resumeMicAfterCanvasRef = useRef(false);
  const statusRef = useRef<string>("disconnected");
  const micActiveRef = useRef(false);
  const restartMicAfterCanvasRef = useRef<null | (() => Promise<void>)>(null);
  const sendRef = useRef<((msg: WsMessage) => void) | null>(null);
  const canvasPlaceholderBaseRef = useRef("");
  const audioPausedRef = useRef(false);
  const pausedTextBufferRef = useRef<string[]>([]);

  const clearCanvasReleaseTimer = useCallback(() => {
    if (canvasReleaseTimerRef.current) {
      clearTimeout(canvasReleaseTimerRef.current);
      canvasReleaseTimerRef.current = null;
    }
  }, []);

  const scheduleCanvasRelease = useCallback(() => {
    clearCanvasReleaseTimer();
    if (!canvasAwaitSpeechEndRef.current || !canvasResponseStartedRef.current) return;

    canvasReleaseTimerRef.current = setTimeout(() => {
      if (!canvasAwaitSpeechEndRef.current) return;
      if (geminiSpeakingRef.current) {
        scheduleCanvasRelease();
        return;
      }

      canvasAwaitSpeechEndRef.current = false;
      canvasExecutingRef.current = false;
      canvasReleaseTimerRef.current = null;

      if (resumeMicAfterCanvasRef.current && statusRef.current === "connected" && !micActiveRef.current) {
        resumeMicAfterCanvasRef.current = false;
        void (async () => {
          try {
            await restartMicAfterCanvasRef.current?.();
          } catch (err) {
            addOperation(`Mic restart failed: ${String(err)}`);
          }
        })();
      }
    }, 1800);
  }, [addOperation, clearCanvasReleaseTimer]);

  const noteCanvasResponseActivity = useCallback(() => {
    if (!canvasExecutingRef.current && !canvasAwaitSpeechEndRef.current) return;
    canvasResponseStartedRef.current = true;
    if (canvasAwaitSpeechEndRef.current) {
      scheduleCanvasRelease();
    }
  }, [scheduleCanvasRelease]);

  const maybePromptCanvasCompletion = useCallback(() => {
    if (!canvasExecutingRef.current || canvasCompletionPromptSentRef.current) return;
    const gs = flowRef.current?.getGraphState();
    const stillRunning = gs?.nodes.some((n) => n.executionState === "running");
    if (stillRunning) return;

    canvasCompletionPromptSentRef.current = true;
    sendRef.current?.({ type: "canvas_complete", payload: {} });
  }, []);

  // Serialize onSql processing so concurrent tool calls don't race on DuckDB
  const sqlQueueRef = useRef(Promise.resolve());

  // WebSocket
  const { status, geminiError, connect, disconnect, send } = useWebSocket({
    onAudio: (payload) => {
      noteCanvasResponseActivity();
      playChunk(payload.data);
    },
    onAction: (payload: ActionPayload) => {
      switch (payload.action) {
        case "ADD_NODE":
          flowRef.current?.addNode(
            payload.nodeType as string,
            payload.label as string | undefined,
            {
              tableName:
                typeof payload.tableName === "string"
                  ? payload.tableName
                  : activeTable?.name,
            },
          );
          break;
        case "RENDER_CHART":
          setChartConfig({
            chartType: payload.chartType as string,
            xKey: payload.xKey as string,
            yKey: payload.yKey as string,
          });
          break;
        case "REMOVE_NODE": {
          const tableName = payload.tableName as string;
          const toolCallId = payload.toolCallId as string | undefined;
          const confirmed = window.confirm(
            `Remove transformation "${tableName}"? This will drop the table and remove its node from the pipeline.`,
          );
          if (confirmed) {
            (async () => {
              const dropped = await dropTable(tableName);
              if (dropped) {
                flowRef.current?.removeNodeByTableName(tableName);
                addOperation(`Removed transformation: ${tableName}`);
              }
              if (toolCallId) {
                send({
                  type: "tool_result",
                  payload: {
                    toolCallId,
                    toolName: "removeTransform",
                    result: dropped
                      ? { success: true, removed: tableName }
                      : { success: false, error: `Table "${tableName}" not found` },
                  },
                });
              }
            })();
          } else {
            if (toolCallId) {
              send({
                type: "tool_result",
                payload: {
                  toolCallId,
                  toolName: "removeTransform",
                  result: { success: false, error: "User cancelled the removal" },
                },
              });
            }
          }
          break;
        }
      }
    },
    onSql: (payload) => {
      const sqlPayload = payload as { sql: string; description?: string; toolCallId?: string };
      // Serialize SQL execution so concurrent tool calls don't race on DuckDB
      sqlQueueRef.current = sqlQueueRef.current.then(async () => {
        setCurrentStatus(`Executing: ${sqlPayload.description ?? "SQL query"}...`);
        try {
          // Detect CREATE TABLE ... AS ... — use executeStage to show the resulting table
          const createMatch = sqlPayload.sql.match(
            /CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:"([^"]+)"|(\w+))/i,
          );
          let stageResult: import("./hooks/useDuckDB.js").TableInfo | null = null;
          if (createMatch) {
            const tblName = createMatch[1] || createMatch[2];
            stageResult = await executeStage(sqlPayload.sql, tblName);
          } else {
            await executeQuery(sqlPayload.sql, sqlPayload.description);
          }

          const resultTableName = stageResult?.name ?? null;

          // Auto-add a flow node for CREATE TABLE results (or update existing pending node)
          if (resultTableName) {
            // Check if there's already a pending node whose stageConfig.resultName matches
            const gs = flowRef.current?.getGraphState();
            const pendingNode = gs?.nodes.find((n) =>
              !n.tableName && n.stageConfig?.resultName === resultTableName,
            );

            if (pendingNode) {
              // Update the existing manually-added node — mark as done
              flowRef.current?.updateNodeData(pendingNode.id, {
                tableName: resultTableName,
                executionState: "success",
              });
            } else {
              // No matching pending node — create a new one (existing flow)
              const sqlNorm = sqlPayload.sql.replace(/"[^"]+"/g, "").replace(/'[^']+'/g, "");
              const stageType = /\bJOIN\b/i.test(sqlNorm) ? "join"
                : /\bUNION\b/i.test(sqlNorm) ? "union"
                : /\bWHERE\b/i.test(sqlNorm) ? "filter"
                : /\bGROUP\s+BY\b/i.test(sqlNorm) ? "group"
                : /\bORDER\s+BY\b/i.test(sqlNorm) ? "sort"
                : "select";
              const nodeId = flowRef.current?.addNode(
                stageType,
                stageType.toUpperCase(),
                { tableName: resultTableName, deferEdges: true },
              ) ?? null;
              if (nodeId) {
                const srcTables: string[] = [];
                const fromMatch = sqlPayload.sql.match(/FROM\s+(?:"([^"]+)"|(\w+))/i);
                if (fromMatch) srcTables.push(fromMatch[1] || fromMatch[2]);
                const joinMatches = sqlPayload.sql.matchAll(/JOIN\s+(?:"([^"]+)"|(\w+))/gi);
                for (const m of joinMatches) srcTables.push(m[1] || m[2]);
                setTimeout(() => {
                  flowRef.current?.connectNode(nodeId, srcTables.length > 0 ? srcTables : undefined);
                }, 80);
              }
            }
          }

          // Send result summary back to Gemini (use fresh data from executeStage, not stale state)
          if (sqlPayload.toolCallId) {
            send({
              type: "tool_result",
              payload: {
                toolCallId: sqlPayload.toolCallId,
                toolName: "executeDataTransform",
                result: {
                  success: true,
                  tableName: resultTableName ?? sqlPayload.description ?? "query_result",
                  rowCount: stageResult?.data.rows.length ?? 0,
                  columns: stageResult?.data.columns ?? [],
                  sampleRows: stageResult?.data.rows.slice(0, 3) ?? [],
                },
              },
            });
          }

          // Update placeholder text with execution progress
          if (canvasExecutingRef.current) {
            const gs = flowRef.current?.getGraphState();
            const completed = gs?.nodes
              .filter((n) => n.executionState === "success" && !["load", "start"].includes(n.stageType.toLowerCase()))
              .map((n) => n.stageType.toLowerCase()) ?? [];
            const running = gs?.nodes
              .filter((n) => n.executionState === "running")
              .map((n) => n.stageType.toLowerCase()) ?? [];

            setChatLog((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role !== "gemini" || !last?.placeholder) return prev;
              const newText = describeCanvasStageProgress(gs, canvasPlaceholderBaseRef.current);
              return [...prev.slice(0, -1), { ...last, text: newText }];
            });

            // If no more "running" nodes remain, canvas execution is complete.
            // Keep canvasExecutingRef true while Gemini gives the spoken summary.
            const stillRunning = gs?.nodes.some((n) => n.executionState === "running");
            if (!stillRunning) {
              canvasAwaitSpeechEndRef.current = true;
              maybePromptCanvasCompletion();
              scheduleCanvasRelease();
            }
          }

          addOperation(`Executed: ${sqlPayload.description ?? "SQL query"}`);
        } catch (err) {
          if (sqlPayload.toolCallId) {
            send({
              type: "tool_result",
              payload: {
                toolCallId: sqlPayload.toolCallId,
                toolName: "executeDataTransform",
                result: { success: false, error: String(err) },
              },
            });
          }

          if (canvasExecutingRef.current) {
            const gs = flowRef.current?.getGraphState();
            const stillRunning = gs?.nodes.some((n) => n.executionState === "running");
            if (!stillRunning) {
              canvasAwaitSpeechEndRef.current = true;
              maybePromptCanvasCompletion();
              scheduleCanvasRelease();
            }
          }

          addOperation(`Error: ${String(err)}`);
        }
      });
    },
    onText: (payload) => {
      noteCanvasResponseActivity();
      const displayText = getDisplayableEnglishTranscript(payload.text);
      if (!displayText) return;

      // Buffer transcript while audio is paused
      if (audioPausedRef.current) {
        pausedTextBufferRef.current.push(displayText);
        return;
      }

      setChatLog((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "gemini" && last?.placeholder) {
          const cleaned = dedupeExecuteNarration(displayText.trimStart());
          const currentStatus = describeCanvasStageProgress(
            flowRef.current?.getGraphState(),
            canvasPlaceholderBaseRef.current,
          );
          const text = cleaned
            ? appendTranscriptChunk(currentStatus, ` ${cleaned}`)
            : currentStatus;
          return [...prev.slice(0, -1), { role: "gemini", text, ts: Date.now() }];
        }
        if (last?.role === "gemini") {
          return [...prev.slice(0, -1), { ...last, text: appendTranscriptChunk(last.text, displayText) }];
        }
        return [...prev, { role: "gemini", text: displayText, ts: Date.now() }];
      });
    },
    onUserText: (payload) => {
      const displayText = getDisplayableEnglishTranscript(payload.text);
      if (!displayText) return;
      setChatLog((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "user") {
          return [...prev.slice(0, -1), { ...last, text: appendTranscriptChunk(last.text, displayText) }];
        }
        return [...prev, { role: "user", text: displayText, ts: Date.now() }];
      });
    },
    onThinking: (payload) => {
      noteCanvasResponseActivity();
      setChatLog((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "gemini" && last?.placeholder) {
          // Keep the visible placeholder text so chat never shows a blank Gemini bubble.
          return [...prev.slice(0, -1), { ...last, thinking: (last.thinking ?? "") + payload.text }];
        }
        // Append thinking only to an existing Gemini message.
        if (last?.role === "gemini") {
          return [...prev.slice(0, -1), { ...last, thinking: (last.thinking ?? "") + payload.text }];
        }
        // Do not create a thinking-only message bubble.
        return prev;
      });
    },
    onInterrupted: () => {
      // Gemini detected user speech — clear queued audio and mark transcript as cut off
      interruptPlayback();
      setChatLog((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role !== "gemini") return prev;
        // Only append "..." if the message doesn't already end with it
        if (last.text.trimEnd().endsWith("...")) return prev;
        return [...prev.slice(0, -1), { ...last, text: last.text.trimEnd() + "..." }];
      });
    },
    onRequestSchemas: async () => {
      // Skip when canvas execution is pending — schemas will be combined
      // into the single canvas_execute prompt instead.
      if (pendingCanvasRef.current || canvasExecutingRef.current) return;
      const schemas = await getSchemas();
      if (schemas) {
        send({ type: "schema", payload: { schemas } });
      }
    },
  });

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Load sample data on startup when enabled
  const sampleLoadedRef = useRef(false);
  // Reset guard when DB reinitializes (e.g. HMR)
  useEffect(() => {
    if (!dbReady) sampleLoadedRef.current = false;
  }, [dbReady]);
  useEffect(() => {
    if (!useSampleData || !dbReady || sampleLoadedRef.current) return;
    sampleLoadedRef.current = true;

    (async () => {
      setCurrentStatus("Loading sample data...");
      const t1 = await loadCSVFromText("customers", SAMPLE_CUSTOMERS_CSV);
      const t2 = await loadCSVFromText("orders", SAMPLE_ORDERS_CSV);

      if (t1) {
        flowRef.current?.addNode("load", "LOAD: customers", { tableName: "customers" });
      }
      if (t2) {
        flowRef.current?.addNode("load", "LOAD: orders", { tableName: "orders" });
      }

      if (useSampleFlow && t1 && t2) {
        const joinSql = `CREATE OR REPLACE TABLE customer_orders AS SELECT o.*, c.name, c.region, c.status FROM orders o INNER JOIN customers c ON o.customer_id = c.customer_id`;
        const resultName = "customer_orders";
        const joinNodeId = flowRef.current?.addNode("join", "JOIN", { deferEdges: true });
        if (joinNodeId) {
          try {
            const joinResult = await executeStage(joinSql, resultName);
            if (joinResult) {
              flowRef.current?.updateNodeData(joinNodeId, {
                tableName: resultName,
                stageConfig: {
                  type: "join",
                  leftTable: "orders",
                  rightTable: "customers",
                  leftKey: "customer_id",
                  rightKey: "customer_id",
                  joinType: "INNER",
                  resultName,
                },
              });
              flowRef.current?.connectNode(joinNodeId, ["orders", "customers"]);
            }
          } catch (err) {
            console.warn("Failed to execute sample join:", err);
          }
        }
      }

      const schemas = await getSchemas();
      if (schemas) {
        send({ type: "schema", payload: { schemas } });
      }
      setCurrentStatus("Sample data loaded.");
    })();
  }, [useSampleData, useSampleFlow, dbReady, loadCSVFromText, executeStage, getSchemas, send]);

  const onAudioChunk = useCallback(
    (base64: string) => {
      send({ type: "audio", payload: { data: base64 } });
    },
    [send],
  );
  const { micActive, start: startMic, stop: stopMic, analyser: micAnalyser } =
    useAudioCapture(onAudioChunk);

  // Screenshot capture — disabled for vision-free mode (saves API quota)
  // const { start: startCapture, stop: stopCapture } = useScreenCapture(
  //   useCallback(
  //     (base64: string) => send({ type: "screenshot", payload: { data: base64 } }),
  //     [send],
  //   ),
  // );
  const startCapture = useCallback((_el: HTMLElement) => {}, []);
  const stopCapture = useCallback(() => {}, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    micActiveRef.current = micActive;
  }, [micActive]);

  useEffect(() => {
    restartMicAfterCanvasRef.current = async () => {
      await startMic();
      if (appRef.current) startCapture(appRef.current);
    };
  }, [startMic, startCapture]);

  // Auto mic permission on mount
  useEffect(() => {
    if (micPermission === "prompt") requestMic();
  }, [micPermission, requestMic]);

  // Auto-connect on mount when enabled
  const hasAutoConnected = useRef(false);
  useEffect(() => {
    if (!autoConnect || hasAutoConnected.current) return;
    hasAutoConnected.current = true;
    connect();
  }, [autoConnect, connect]);

  // Manual connect / disconnect
  const manualConnectRef = useRef(false);
  const pendingManualIntroRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const handleConnect = useCallback(() => {
    // Reset auto-start guard so mic will auto-unmute once Gemini connects
    hasAutoStartedMic.current = false;
    manualConnectRef.current = true;
    pendingManualIntroRef.current = true;
    connect();
  }, [connect]);

  const handleDisconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    if (micActive) {
      stopMic();
      stopCapture();
    }
    stopPlayback();
    disconnect();
  }, [disconnect, micActive, stopMic, stopCapture, stopPlayback]);

  // Interrupt Gemini's current audio response
  const handleInterrupt = useCallback(() => {
    audioPausedRef.current = false;
    pausedTextBufferRef.current = [];
    interruptPlayback();
  }, [interruptPlayback]);

  // Pause playback and start buffering transcript
  const handlePause = useCallback(() => {
    audioPausedRef.current = true;
    pausePlayback();
  }, [pausePlayback]);

  // Resume playback and flush buffered transcript chunks
  const handleResume = useCallback(() => {
    // Set ref immediately so incoming onText chunks stop buffering
    audioPausedRef.current = false;
    resumePlayback();

    const buffered = pausedTextBufferRef.current;
    pausedTextBufferRef.current = [];
    if (buffered.length === 0) return;
    const combined = buffered.join("");
    const displayText = getDisplayableEnglishTranscript(combined);
    if (!displayText) return;
    setChatLog((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "gemini") {
        return [...prev.slice(0, -1), { ...last, text: appendTranscriptChunk(last.text, displayText) }];
      }
      return [...prev, { role: "gemini", text: displayText, ts: Date.now() }];
    });
  }, [resumePlayback]);

  // Stop mic, clear canvas state, and mark stale "running" nodes on Gemini disconnect
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === "connected" && status !== "connected") {
      const wasManualDisconnect = manualDisconnectRef.current;
      manualDisconnectRef.current = false;
      pendingManualIntroRef.current = false;

      if (micActive) {
        stopMic();
        stopCapture();
      }
      stopPlayback();
      canvasExecutingRef.current = false;
      canvasAwaitSpeechEndRef.current = false;
      canvasResponseStartedRef.current = false;
      canvasCompletionPromptSentRef.current = false;
      resumeMicAfterCanvasRef.current = false;
      clearCanvasReleaseTimer();
      if (canvasTimeoutRef.current) {
        clearTimeout(canvasTimeoutRef.current);
        canvasTimeoutRef.current = null;
      }
      // Session dropped mid-run: move incomplete nodes back to pending instead of error.
      const gs = flowRef.current?.getGraphState();
      if (gs) {
        for (const node of gs.nodes) {
          if (node.executionState === "running") {
            flowRef.current?.updateNodeData(node.id, { executionState: "pending" });
          }
        }
      }

      if (!wasManualDisconnect) {
        flowRef.current?.resetGraph();
        setChartConfig(null);
        setConfigStage(null);
        void resetDatabase();
        addOperation("Server disconnected. Cleared in-memory data.");
      }
    }
    prevStatusRef.current = status;
  }, [status, micActive, stopMic, stopCapture, stopPlayback, clearCanvasReleaseTimer, resetDatabase, addOperation]);

  useEffect(() => {
    geminiSpeakingRef.current = geminiSpeaking;
    if (canvasAwaitSpeechEndRef.current && !geminiSpeaking) {
      scheduleCanvasRelease();
    }
  }, [geminiSpeaking, scheduleCanvasRelease]);


  // Auto-start mic once permission granted + connected (unless "start with mic muted" is set)
  const hasAutoStartedMic = useRef(false);
  useEffect(() => {
    // Allow auto-start again after disconnect/manual mute cycles.
    if (status !== "connected") {
      hasAutoStartedMic.current = false;
    }
  }, [status]);

  useEffect(() => {
    // Skip auto-start if "start mic muted" is set AND this is not a manual connect
    if (startMicMuted && !manualConnectRef.current) return;
    if (
      micPermission === "granted" &&
      status === "connected" &&
      !micActive &&
      !hasAutoStartedMic.current
    ) {
      hasAutoStartedMic.current = true;
      manualConnectRef.current = false;
      void (async () => {
        try {
          await startMic();
          if (appRef.current) startCapture(appRef.current);
        } catch (err) {
          hasAutoStartedMic.current = false;
          addOperation(`Mic start failed: ${String(err)}`);
        }
      })();
    }
  }, [startMicMuted, micPermission, status, micActive, startMic, startCapture, addOperation]);

  useEffect(() => {
    if (status !== "connected" || !pendingManualIntroRef.current) return;

    pendingManualIntroRef.current = false;
    const graphState = flowRef.current?.getGraphState();
    const tableNames = tables.map((table) => table.name);

    send({
      type: "connect_intro",
      payload: {
        tables: tableNames,
        graphState,
      },
    });
  }, [status, tables, send]);

  const handleToggleMic = useCallback(() => {
    if (micActive) {
      stopMic();
      stopCapture();
    } else {
      void (async () => {
        try {
          await startMic();
          if (appRef.current) startCapture(appRef.current);
        } catch (err) {
          addOperation(`Mic start failed: ${String(err)}`);
        }
      })();
    }
  }, [micActive, startMic, stopMic, startCapture, stopCapture, addOperation]);

  const handleFileUpload = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        setCurrentStatus(`Loading ${file.name}...`);
        const tableName = await loadCSV(file);
        if (tableName) {
          flowRef.current?.addNode("load", `LOAD: ${tableName}`, { tableName });
          addOperation(`Loaded ${file.name} as "${tableName}".`);
        }
      }
      // Send updated schemas to the backend so Gemini knows about all loaded tables
      const schemas = await getSchemas();
      if (schemas) {
        send({ type: "schema", payload: { schemas } });
      }
    },
    [loadCSV, addOperation, getSchemas, send],
  );

  const flowSyncTimerRef = useRef<number | null>(null);
  const handleFlowChange = useCallback(
    (snapshot: FlowSnapshot) => {
      // Count non-START nodes as stages
      setStageCount(snapshot.nodes.filter((n) => n.stageType.toUpperCase() !== "START").length);

      // Don't send uiContext while canvas execution is running — sending sendClientContent
      // mid-response corrupts the Gemini Live session and causes disconnect.
      if (canvasExecutingRef.current) return;

      if (flowSyncTimerRef.current !== null) {
        window.clearTimeout(flowSyncTimerRef.current);
      }
      flowSyncTimerRef.current = window.setTimeout(() => {
        // Re-check: canvas execution may have started since the timer was set
        if (canvasExecutingRef.current) return;
        send({
          type: "status",
          payload: {
            uiContext: {
              graph: snapshot,
              note:
                "User edited the flow graph (drag/connect/disconnect). Use this as UI navigator context.",
            },
          },
        });
      }, 400);
    },
    [send],
  );
  useEffect(() => {
    return () => {
      if (flowSyncTimerRef.current !== null) {
        window.clearTimeout(flowSyncTimerRef.current);
      }
    };
  }, []);

  // Stage configuration
  const handleConfigureStage = useCallback(
    (nodeId: string, stageType: string, isNew?: boolean) => {
      setConfigStage({ nodeId, type: stageType, isNew });
    },
    [],
  );

  const handleCloseConfig = useCallback(() => {
    if (configStage?.isNew) {
      flowRef.current?.removeNode(configStage.nodeId);
    }
    setConfigStage(null);
  }, [configStage]);

  // Save partial stage config without executing SQL
  const handleStageSave = useCallback(
    (stageConfig: StageConfig) => {
      const nodeId = configStage?.nodeId;
      setConfigStage(null);
      if (nodeId) {
        const newType = stageConfig?.type?.toLowerCase();
        flowRef.current?.updateNodeData(nodeId, {
          stageConfig,
          ...(newType && { stageType: newType, label: newType.toUpperCase() }),
        });
      }
    },
    [configStage],
  );

  // "Execute Canvas" — send compact graph state + schemas to Gemini in one message
  const canvasTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const executeCanvasNow = useCallback(() => {
    const graphState = flowRef.current?.getGraphState();
    if (!graphState) return;

    const loadedTables = graphState.nodes
      .filter((node) => node.tableName && ["load", "start"].includes(node.stageType.toLowerCase()))
      .map((node) => node.tableName as string);
    const pendingStages = graphState.nodes
      .filter((node) => !node.tableName && !["start", "load"].includes(node.stageType.toLowerCase()))
      .map((node) => node.stageType.toLowerCase());

    // Base text for the placeholder (loaded tables info) — stored in ref for dynamic updates
    const baseText = loadedTables.length > 0
      ? `I see ${loadedTables.length} loaded table${loadedTables.length > 1 ? "s" : ""}: ${loadedTables.join(", ")}.`
      : "";
    canvasPlaceholderBaseRef.current = baseText;

    const statusText = pendingStages.length > 0
      ? `I'm doing the ${pendingStages.join(", ")} stage${pendingStages.length > 1 ? "s" : ""} now.`
      : "I'm checking the current pipeline now.";

    // Add user message + placeholder (updated as stages complete, then Gemini’s voice appends)
    setChatLog((prev) => [
      ...prev,
      {
        role: "user",
        text: "Execute Canvas — analyze my pipeline and fill in the missing transformations.",
        ts: Date.now(),
      },
      {
        role: "gemini",
        text: [baseText, statusText].filter(Boolean).join(" "),
        ts: Date.now(),
        placeholder: true,
      },
    ]);

    // Mark all pending nodes as "running"
    const runningNodeIds: string[] = [];
    for (const node of graphState.nodes) {
      const st = node.stageType.toLowerCase();
      if (!node.tableName && st !== "start" && st !== "load") {
        flowRef.current?.updateNodeData(node.id, { executionState: "running" });
        runningNodeIds.push(node.id);
      }
    }

    // Build compact graph state — only fields Gemini needs.
    // NOTE: executionState must be set to "running" here (not read from the snapshot)
    // because the updateNodeData calls above are async React state updates that haven't
    // been processed yet — the snapshot still has the old values (null/pending).
    const compactState = {
      nodes: graphState.nodes.map((n) => {
        const st = n.stageType.toLowerCase();
        const isIncomplete = !n.tableName && st !== "start" && st !== "load";
        return {
          id: n.id,
          stageType: n.stageType,
          label: n.label,
          tableName: n.tableName ?? null,
          stageConfig: n.stageConfig ?? null,
          executionState: isIncomplete ? "running" : (n.executionState ?? null),
        };
      }),
      edges: graphState.edges.map((e) => ({
        source: e.source,
        target: e.target,
      })),
    };

    // Build schemas synchronously from table data already in memory (no DuckDB queries)
    const schemas: Record<string, string[]> = {};
    for (const t of tables) {
      schemas[t.name] = t.data.columns;
    }

    // Mark canvas execution active before sending the execute request.
    canvasExecutingRef.current = true;
    canvasAwaitSpeechEndRef.current = false;
    canvasResponseStartedRef.current = false;
    canvasCompletionPromptSentRef.current = false;
    resumeMicAfterCanvasRef.current = false;
    clearCanvasReleaseTimer();

    setTimeout(() => {
      send({
        type: "canvas_execute",
        payload: { graphState: compactState, schemas },
      });

      addOperation("Sent pipeline to Gemini for analysis...");
    }, 300);

    // Safety timeout: if nodes are still "running" after 30s, mark as error and stop blocking uiContext
    if (canvasTimeoutRef.current) clearTimeout(canvasTimeoutRef.current);
    canvasTimeoutRef.current = setTimeout(() => {
      canvasExecutingRef.current = false;
      canvasAwaitSpeechEndRef.current = false;
      canvasResponseStartedRef.current = false;
      resumeMicAfterCanvasRef.current = false;
      canvasCompletionPromptSentRef.current = false;
      const nodes = flowRef.current?.getGraphState().nodes ?? [];
      for (const node of nodes) {
        if (node.executionState === "running") {
          flowRef.current?.updateNodeData(node.id, { executionState: "error" });
        }
      }
      maybePromptCanvasCompletion();
      scheduleCanvasRelease();
    }, 30000);
  }, [send, addOperation, tables, clearCanvasReleaseTimer, maybePromptCanvasCompletion, scheduleCanvasRelease]);

  const handleExecuteCanvas = useCallback(() => {
    if (status !== "connected") {
      // Auto-connect, then execute once connected
      pendingCanvasRef.current = true;
      handleConnect();
      addOperation("Connecting to Gemini...");
      return;
    }
    executeCanvasNow();
  }, [status, handleConnect, executeCanvasNow, addOperation]);

  // Fire pending canvas execution once Gemini connects
  useEffect(() => {
    if (status === "connected" && pendingCanvasRef.current) {
      pendingCanvasRef.current = false;
      // Minimal delay — session is ready, executeCanvasNow is synchronous
      const t = setTimeout(() => executeCanvasNow(), 100);
      return () => clearTimeout(t);
    }
  }, [status, executeCanvasNow]);

  const handleNodeDeleted = useCallback(
    (_nodeId: string, stageType: string) => {
      addOperation(`Deleted ${stageType.toUpperCase()} stage`);
    },
    [addOperation],
  );

  // Sidebar resize
  const handleSidebarMouseDown = useCallback(() => {
    sidebarResizing.current = true;
    const onMove = (e: MouseEvent) => {
      if (!sidebarResizing.current) return;
      setSidebarWidth(Math.max(240, Math.min(500, e.clientX)));
    };
    const onUp = () => {
      sidebarResizing.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // Flow / data split resize
  const mainContentRef = useRef<HTMLDivElement>(null);
  const handleHSplitMouseDown = useCallback(() => {
    hSplitResizing.current = true;
    const onMove = (e: MouseEvent) => {
      if (!hSplitResizing.current || !mainContentRef.current) return;
      const rect = mainContentRef.current.getBoundingClientRect();
      const pct = dataLayout === "left-right"
        ? ((e.clientX - rect.left) / rect.width) * 100
        : ((e.clientY - rect.top) / rect.height) * 100;
      setFlowPercent(Math.max(15, Math.min(85, pct)));
    };
    const onUp = () => {
      hSplitResizing.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = dataLayout === "left-right" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [dataLayout]);

  const tabList = tables.map((t) => ({
    id: t.id,
    name: t.name,
    rowCount: t.data.rows.length,
  }));

  return (
    <div className="app-root" ref={appRef}>
      <TopBar
        apiKey={apiKey}
        onApiKeyChange={handleApiKeyChange}
        dataLayout={dataLayout}
        onDataLayoutChange={handleDataLayoutChange}
        startMicMuted={startMicMuted}
        onStartMicMutedChange={handleStartMicMutedChange}
        useSampleData={useSampleData}
        onUseSampleDataChange={handleUseSampleDataChange}
        useSampleFlow={useSampleFlow}
        onUseSampleFlowChange={handleUseSampleFlowChange}
        autoConnect={autoConnect}
        onAutoConnectChange={handleAutoConnectChange}
      />

      {micPermission === "denied" && (
        <div className="mic-denied-banner">
          Microphone access was denied. Allow mic access in browser settings to use voice.
        </div>
      )}

      <div className="app-layout">
        <aside className="sidebar-panel" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
          <Sidebar
            micActive={micActive}
            micPermission={micPermission}
            onToggleMic={handleToggleMic}
            onFileUpload={handleFileUpload}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onInterrupt={handleInterrupt}
            onPause={handlePause}
            onResume={handleResume}
            audioPaused={audioPaused}
            geminiSpeaking={geminiSpeaking}
            autoConnect={autoConnect}
            status={status}
            geminiError={geminiError}
            hasApiKey={hasApiKey}
            dbReady={dbReady}
            dbInitError={dbInitError}
            dbLoading={dbLoading}
            dbError={dbError}
            micAnalyser={micAnalyser}
            geminiAnalyser={geminiAnalyser}
            chatLog={chatLog}
          />
        </aside>
        <div className="resize-handle" onMouseDown={handleSidebarMouseDown} />
        <div
          className={`main-content ${dataLayout === "left-right" ? "layout-left-right" : "layout-top-bottom"}`}
          ref={mainContentRef}
        >
          <div
            className="flow-section"
            style={
              dataLayout === "left-right"
                ? { width: `${flowPercent}%`, height: "100%", display: "flex", flexDirection: "column" }
                : { height: `${flowPercent}%`, width: "100%", display: "flex", flexDirection: "column" }
            }
          >
            <div className="status-bar-wrapper">
              <div className="status-bar">
                <div className="status-bar-main">
                  <span className={`status-bar-icon ${
                    currentStatus.toLowerCase().includes("error") || currentStatus.toLowerCase().includes("fail")
                      ? "error"
                      : currentStatus.toLowerCase().includes("loading") || currentStatus.toLowerCase().includes("executing")
                        ? "loading"
                        : "ok"
                  }`} />
                  <div className="status-bar-text">
                    <span className="status-bar-label">Status</span>
                    <span className="status-bar-value">{currentStatus}</span>
                  </div>
                </div>
                {tables.length > 0 && (
                  <div className="status-bar-badge">
                    <span className="status-bar-label">Tables</span>
                    <span className="status-bar-value">{tables.length}</span>
                  </div>
                )}
                {stageCount > 0 && (
                  <div className="status-bar-badge">
                    <span className="status-bar-label">Stages</span>
                    <span className="status-bar-value">{stageCount}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flow-pane" style={{ flex: 1 }}>
              <FlowPane
                ref={flowRef}
                onFlowChange={handleFlowChange}
                onShowTableByName={handleShowTableByName}
                onConfigureStage={handleConfigureStage}
                onNodeDeleted={handleNodeDeleted}
                onExecuteCanvas={handleExecuteCanvas}
              />
            </div>
          </div>
          <div
            className={`hsplit-handle ${dataLayout === "left-right" ? "vertical" : "horizontal"}`}
            onMouseDown={handleHSplitMouseDown}
          />
          <div className="data-pane">
            <TableTabs tabs={tabList} activeId={activeTableId} onSelect={setActiveTableId} />
            <ChartView config={chartConfig} data={activeTable?.data ?? null} />
            <DataTable data={activeTable?.data ?? null} error={dbError} />
          </div>
        </div>
      </div>

      {configStage && (
        <StageConfigDialog
          stageType={configStage.type}
          nodeId={configStage.nodeId}
          tables={tables}
          onSave={handleStageSave}
          onClose={handleCloseConfig}
        />
      )}
    </div>
  );
}
