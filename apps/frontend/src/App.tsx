import { useRef, useState, useCallback } from "react";
import { useWebSocket, type ActionPayload } from "./hooks/useWebSocket.js";
import { useAudioCapture } from "./hooks/useAudioCapture.js";
import { useAudioPlayback } from "./hooks/useAudioPlayback.js";
import { useScreenCapture } from "./hooks/useScreenCapture.js";
import { useDuckDB } from "./hooks/useDuckDB.js";
import Sidebar from "./components/Sidebar.js";
import FlowPane, { type FlowPaneHandle } from "./components/FlowPane.js";
import DataTable from "./components/DataTable.js";
import ChartView from "./components/ChartView.js";

export default function App() {
  const flowRef = useRef<FlowPaneHandle>(null);
  const appRef = useRef<HTMLDivElement>(null);

  // DuckDB-WASM for in-browser SQL
  const { tableData, tableName, error: dbError, init: initDB, loadCSV, executeQuery } = useDuckDB();

  // Chart state
  const [chartConfig, setChartConfig] = useState<{
    chartType: string;
    xKey: string;
    yKey: string;
  } | null>(null);

  // Audio playback for Gemini responses
  const { playChunk, stop: stopPlayback } = useAudioPlayback();

  // WebSocket with message routing
  const { status, connect, disconnect, send } = useWebSocket({
    onAudio: (payload) => {
      playChunk(payload.data);
    },
    onAction: (payload: ActionPayload) => {
      switch (payload.action) {
        case "ADD_NODE":
          flowRef.current?.addNode(
            payload.nodeType as string,
            payload.label as string | undefined,
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
    onSql: (payload) => {
      executeQuery(payload.sql);
    },
    onText: (payload) => {
      console.log("Agent:", payload.text);
    },
  });

  // Audio capture → send to backend
  const onAudioChunk = useCallback(
    (base64: string) => {
      send({ type: "audio", payload: { data: base64 } });
    },
    [send],
  );
  const { micActive, start: startMic, stop: stopMic, audioContext, stream } =
    useAudioCapture(onAudioChunk);

  // Screenshot capture → send to backend
  const { start: startCapture, stop: stopCapture } = useScreenCapture(
    useCallback(
      (base64: string) => {
        send({ type: "screenshot", payload: { data: base64 } });
      },
      [send],
    ),
  );

  const handleToggleConnection = useCallback(() => {
    if (status !== "disconnected") {
      stopMic();
      stopPlayback();
      stopCapture();
      disconnect();
    } else {
      connect();
    }
  }, [status, connect, disconnect, stopMic, stopPlayback, stopCapture]);

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
    async (file: File) => {
      await initDB();
      await loadCSV(file);
      // Auto-add a CSV import node to the flow
      flowRef.current?.addNode("csv-import", file.name);
    },
    [initDB, loadCSV],
  );

  return (
    <div className="app-layout" ref={appRef}>
      <Sidebar
        connected={status === "connected"}
        micActive={micActive}
        onToggleConnection={handleToggleConnection}
        onToggleMic={handleToggleMic}
        onFileUpload={handleFileUpload}
        status={status}
        tableName={tableName}
        audioContext={audioContext}
        stream={stream}
      />
      <div className="main-content">
        <div className="flow-pane">
          <FlowPane ref={flowRef} />
        </div>
        <div className="data-pane">
          <ChartView config={chartConfig} data={tableData} />
          <DataTable data={tableData} error={dbError} />
        </div>
      </div>
    </div>
  );
}
