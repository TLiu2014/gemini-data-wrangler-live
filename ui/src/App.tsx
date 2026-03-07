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
  }, []);
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

  // Transcripts (separate user / Gemini)
  const [userTranscript, setUserTranscript] = useState("");
  const [geminiTranscript, setGeminiTranscript] = useState("");

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
  const { playChunk, stop: stopPlayback, analyser: geminiAnalyser } = useAudioPlayback();

  // WebSocket
  const { status, connect, disconnect, send } = useWebSocket({
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
      }
    },
    onSql: async (payload) => {
      const sqlPayload = payload as { sql: string; description?: string; toolCallId?: string };
      setCurrentStatus(`Executing: ${sqlPayload.description ?? "SQL query"}...`);
      try {
        await executeQuery(sqlPayload.sql, sqlPayload.description);
        // Send result summary back to backend for Gemini's tool response
        if (sqlPayload.toolCallId) {
          const tbl = tables.length > 0 ? tables[tables.length - 1] : null;
          send({
            type: "tool_result",
            payload: {
              toolCallId: sqlPayload.toolCallId,
              toolName: "executeDataTransform",
              result: {
                success: true,
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
      setGeminiTranscript((prev) => {
        const next = (prev + " " + payload.text).trim();
        return next.length > 500 ? next.slice(-500) : next;
      });
    },
    onUserText: (payload) => {
      setUserTranscript((prev) => {
        const next = (prev + " " + payload.text).trim();
        return next.length > 500 ? next.slice(-500) : next;
      });
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

  // Auto-connect WS
  const hasAutoConnected = useRef(false);
  useEffect(() => {
    if (!hasAutoConnected.current) {
      hasAutoConnected.current = true;
      connect();
    }
  }, [connect]);

  // Auto-start mic once permission granted + connected (unless "start with mic muted" is set)
  const hasAutoStartedMic = useRef(false);
  useEffect(() => {
    if (startMicMuted) return;
    if (
      micPermission === "granted" &&
      status === "connected" &&
      !micActive &&
      !hasAutoStartedMic.current
    ) {
      hasAutoStartedMic.current = true;
      startMic();
      if (appRef.current) startCapture(appRef.current);
    }
  }, [startMicMuted, micPermission, status, micActive, startMic, startCapture]);

  const handleToggleMic = useCallback(() => {
    if (micActive) {
      stopMic();
      stopCapture();
    } else {
      startMic();
      if (appRef.current) startCapture(appRef.current);
    }
  }, [micActive, startMic, stopMic, startCapture, stopCapture]);

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
            status={status}
            apiKey={apiKey}
            dbReady={dbReady}
            dbInitError={dbInitError}
            dbLoading={dbLoading}
            dbError={dbError}
            micAnalyser={micAnalyser}
            geminiAnalyser={geminiAnalyser}
            userTranscript={userTranscript}
            geminiTranscript={geminiTranscript}
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
