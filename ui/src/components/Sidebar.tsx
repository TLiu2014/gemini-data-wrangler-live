import AudioVisualizer from "./AudioVisualizer.js";
import FileUpload from "./FileUpload.js";
import type { MicPermissionState } from "../hooks/useMicPermission.js";

interface SidebarProps {
  micActive: boolean;
  micPermission: MicPermissionState;
  onToggleMic: () => void;
  onFileUpload: (files: File[]) => void;
  status: string;
  tableCount: number;
  dbReady?: boolean;
  dbInitError?: string | null;
  dbLoading?: boolean;
  dbError?: string | null;
  micAnalyser: React.RefObject<AnalyserNode | null>;
  geminiAnalyser: React.RefObject<AnalyserNode | null>;
  userTranscript: string;
  geminiTranscript: string;
}

export default function Sidebar({
  micActive,
  micPermission,
  onToggleMic,
  onFileUpload,
  status,
  tableCount,
  dbReady = true,
  dbInitError = null,
  dbLoading = false,
  dbError = null,
  micAnalyser,
  geminiAnalyser,
  userTranscript,
  geminiTranscript,
}: SidebarProps) {
  return (
    <>
      {/* File upload */}
      <div className="sidebar-section">
        <h3>Data Source</h3>
        {dbInitError && (
          <div className="loading-bar error" role="alert">
            Engine failed: {dbInitError}
          </div>
        )}
        {!dbInitError && !dbReady && (
          <div className="loading-bar">Initializing engine...</div>
        )}
        <FileUpload onFiles={onFileUpload} disabled={!!dbInitError} />
        {dbLoading && <div className="loading-bar">Loading data...</div>}
        {dbError && (
          <div className="loading-bar error" role="alert">
            {dbError}
          </div>
        )}
        {tableCount > 0 && (
          <div className="table-badge">{tableCount} table{tableCount > 1 ? "s" : ""} loaded</div>
        )}
      </div>

      {/* Compact connection status */}
      <div className="status-indicator">
        <span
          className={`status-dot ${status === "connected" ? "on" : ""}`}
        />
        <span className="status-text">
          {status === "connected"
            ? "Connected"
            : status === "connecting"
              ? "Connecting..."
              : "Disconnected"}
        </span>
      </div>

      {/* You section */}
      <div className="voice-section">
        <div className="voice-header">
          <span className="voice-label">You</span>
          {micActive && <span className="voice-live">Live</span>}
        </div>
        <AudioVisualizer
          analyser={micAnalyser.current}
          color={[66, 133, 244]}
          colorEnd={[156, 39, 176]}
          label=""
          active={micActive}
        />
        {userTranscript && (
          <div className="voice-transcript">{userTranscript}</div>
        )}
      </div>

      {/* Gemini section */}
      <div className="voice-section">
        <div className="voice-header">
          <span className="voice-label">Gemini</span>
          {status === "connected" && <span className="voice-live gemini">Active</span>}
        </div>
        <AudioVisualizer
          analyser={geminiAnalyser.current}
          color={[156, 39, 176]}
          colorEnd={[66, 133, 244]}
          label=""
          active={status === "connected"}
        />
        {geminiTranscript && (
          <div className="voice-transcript">{geminiTranscript}</div>
        )}
      </div>

      {/* Mic toggle */}
      <button
        className={`mic-btn ${micActive ? "on" : "off"}`}
        onClick={onToggleMic}
        disabled={micPermission === "denied"}
      >
        {micPermission === "denied"
          ? "Mic Blocked"
          : micActive
            ? "Mute Mic"
            : "Unmute Mic"}
      </button>
    </>
  );
}
