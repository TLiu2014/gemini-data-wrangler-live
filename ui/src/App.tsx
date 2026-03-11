import { useRef, useState, useCallback, useEffect } from "react";
import { useWebSocket, type ActionPayload } from "./hooks/useWebSocket.js";
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
} from "./components/FlowPane.js";
import DataTable from "./components/DataTable.js";
import ChartView from "./components/ChartView.js";
import TableTabs from "./components/TableTabs.js";
import StageConfigDialog from "./components/StageConfigDialog.js";
import type { StageConfig } from "./utils/sqlGenerator.js";
import { SAMPLE_CUSTOMERS_CSV, SAMPLE_ORDERS_CSV } from "./sampleData.js";

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
  }
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);

  // Stage config dialog
  const [configStage, setConfigStage] = useState<{
    nodeId: string;
    type: string;
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
  const { playChunk, stop: stopPlayback, interrupt: interruptPlayback, pause: pausePlayback, resume: resumePlayback, paused: audioPaused, analyser: geminiAnalyser } = useAudioPlayback();

  // WebSocket
  const { status, geminiError, connect, disconnect, send } = useWebSocket({
    onAudio: (payload) => playChunk(payload.data),
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
    onSql: async (payload) => {
      const sqlPayload = payload as { sql: string; description?: string; toolCallId?: string };
      setCurrentStatus(`Executing: ${sqlPayload.description ?? "SQL query"}...`);
      try {
        // Detect CREATE TABLE ... AS ... — use executeStage to show the resulting table
        const createMatch = sqlPayload.sql.match(
          /CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:"([^"]+)"|(\w+))/i,
        );
        let resultTableName: string | null = null;
        if (createMatch) {
          const tblName = createMatch[1] || createMatch[2];
          resultTableName = await executeStage(sqlPayload.sql, tblName);
        } else {
          await executeQuery(sqlPayload.sql, sqlPayload.description);
        }

        // Auto-add a flow node for CREATE TABLE results
        if (resultTableName) {
          // Detect stage type from SQL keywords (match whole words, not substrings of table names)
          const sqlNorm = sqlPayload.sql.replace(/"[^"]+"/g, "").replace(/'[^']+'/g, ""); // strip quoted identifiers
          const stageType = /\bJOIN\b/i.test(sqlNorm) ? "join"
            : /\bUNION\b/i.test(sqlNorm) ? "union"
            : /\bWHERE\b/i.test(sqlNorm) ? "filter"
            : /\bGROUP\s+BY\b/i.test(sqlNorm) ? "group"
            : /\bORDER\s+BY\b/i.test(sqlNorm) ? "sort"
            : "select";
          // addNode returns null if a node with this tableName already exists (dedup)
          const nodeId = flowRef.current?.addNode(
            stageType,
            stageType.toUpperCase(),
            { tableName: resultTableName, deferEdges: true },
          ) ?? null;
          if (nodeId) {
            // Parse source tables from SQL (FROM / JOIN clauses)
            const srcTables: string[] = [];
            const fromMatch = sqlPayload.sql.match(/FROM\s+(?:"([^"]+)"|(\w+))/i);
            if (fromMatch) srcTables.push(fromMatch[1] || fromMatch[2]);
            const joinMatches = sqlPayload.sql.matchAll(/JOIN\s+(?:"([^"]+)"|(\w+))/gi);
            for (const m of joinMatches) srcTables.push(m[1] || m[2]);
            // Defer so the new node is in nodesRef after React re-renders
            setTimeout(() => {
              flowRef.current?.connectNode(nodeId, srcTables.length > 0 ? srcTables : undefined);
            }, 80);
          }
        }

        // Send result summary back to Gemini
        if (sqlPayload.toolCallId) {
          // Pick the freshest table from state (executeStage/executeQuery just updated it)
          const tbl = resultTableName
            ? tables.find((t) => t.name === resultTableName) ?? tables[tables.length - 1]
            : tables[tables.length - 1];
          send({
            type: "tool_result",
            payload: {
              toolCallId: sqlPayload.toolCallId,
              toolName: "executeDataTransform",
              result: {
                success: true,
                tableName: resultTableName ?? sqlPayload.description ?? "query_result",
                rowCount: tbl?.data.rows.length ?? 0,
                columns: tbl?.data.columns ?? [],
                sampleRows: tbl?.data.rows.slice(0, 3) ?? [],
              },
            },
          });
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
        addOperation(`Error: ${String(err)}`);
      }
    },
    onText: (payload) => {
      setChatLog((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "gemini") {
          return [...prev.slice(0, -1), { ...last, text: last.text + payload.text }];
        }
        return [...prev, { role: "gemini", text: payload.text, ts: Date.now() }];
      });
    },
    onUserText: (payload) => {
      setChatLog((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "user") {
          return [...prev.slice(0, -1), { ...last, text: last.text + payload.text }];
        }
        return [...prev, { role: "user", text: payload.text, ts: Date.now() }];
      });
    },
    onThinking: (payload) => {
      setChatLog((prev) => {
        const last = prev[prev.length - 1];
        // Append thinking to the latest Gemini message, or create a new one
        if (last?.role === "gemini") {
          return [...prev.slice(0, -1), { ...last, thinking: (last.thinking ?? "") + payload.text }];
        }
        return [...prev, { role: "gemini", text: "", thinking: payload.text, ts: Date.now() }];
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
      const schemas = await getSchemas();
      if (schemas) {
        send({ type: "schema", payload: { schemas } });
      }
    },
  });

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
            const tableName = await executeStage(joinSql, resultName);
            if (tableName) {
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

  // Audio capture
  const onAudioChunk = useCallback(
    (base64: string) => send({ type: "audio", payload: { data: base64 } }),
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
  const handleConnect = useCallback(() => {
    // Reset auto-start guard so mic will auto-unmute once Gemini connects
    hasAutoStartedMic.current = false;
    manualConnectRef.current = true;
    connect();
  }, [connect]);

  const handleDisconnect = useCallback(() => {
    if (micActive) {
      stopMic();
      stopCapture();
    }
    stopPlayback();
    disconnect();
  }, [disconnect, micActive, stopMic, stopCapture, stopPlayback]);

  // Interrupt Gemini's current audio response
  const handleInterrupt = useCallback(() => {
    interruptPlayback();
  }, [interruptPlayback]);

  // Stop mic when Gemini disconnects (error, timeout, etc.)
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === "connected" && status !== "connected" && micActive) {
      stopMic();
      stopCapture();
      stopPlayback();
    }
    prevStatusRef.current = status;
  }, [status, micActive, stopMic, stopCapture, stopPlayback]);

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

      if (flowSyncTimerRef.current !== null) {
        window.clearTimeout(flowSyncTimerRef.current);
      }
      flowSyncTimerRef.current = window.setTimeout(() => {
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
    (nodeId: string, stageType: string) => {
      setConfigStage({ nodeId, type: stageType });
    },
    [],
  );

  const handleStageRun = useCallback(
    async (sql: string, resultName: string, stageConfig?: StageConfig) => {
      const nodeId = configStage?.nodeId;
      const stageType = configStage?.type;
      setConfigStage(null);

      const tableName = await executeStage(sql, resultName);
      if (tableName && nodeId) {
        flowRef.current?.updateNodeData(nodeId, { tableName, ...(stageConfig && { stageConfig }) });

        // Connect edges based on source tables in stage config
        const sourceTableNames: string[] = [];
        if (stageConfig) {
          if (stageConfig.leftTable) sourceTableNames.push(stageConfig.leftTable);
          if (stageConfig.rightTable) sourceTableNames.push(stageConfig.rightTable);
          if (stageConfig.unionTables) sourceTableNames.push(...stageConfig.unionTables);
          if (sourceTableNames.length === 0 && stageConfig.table) sourceTableNames.push(stageConfig.table);
          if (sourceTableNames.length === 0 && stageConfig.groupTable) sourceTableNames.push(stageConfig.groupTable);
          if (sourceTableNames.length === 0 && stageConfig.sortTable) sourceTableNames.push(stageConfig.sortTable);
          if (sourceTableNames.length === 0 && stageConfig.selectTable) sourceTableNames.push(stageConfig.selectTable);
        }
        flowRef.current?.connectNode(nodeId, sourceTableNames.length > 0 ? sourceTableNames : undefined);
        addOperation(`Ran ${(stageType ?? "stage").toUpperCase()}: ${resultName}`);
      }
    },
    [configStage, executeStage, addOperation],
  );

  const handleCloseConfig = useCallback(() => setConfigStage(null), []);

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
            onPause={pausePlayback}
            onResume={resumePlayback}
            audioPaused={audioPaused}
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
          onRun={handleStageRun}
          onClose={handleCloseConfig}
        />
      )}
    </div>
  );
}
