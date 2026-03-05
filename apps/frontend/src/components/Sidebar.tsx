import AudioVisualizer from "./AudioVisualizer.js";
import FileUpload from "./FileUpload.js";

interface SidebarProps {
  connected: boolean;
  micActive: boolean;
  onToggleConnection: () => void;
  onToggleMic: () => void;
  onFileUpload: (file: File) => void;
  status: string;
  tableName: string | null;
  audioContext: React.RefObject<AudioContext | null>;
  stream: React.RefObject<MediaStream | null>;
}

export default function Sidebar({
  connected,
  micActive,
  onToggleConnection,
  onToggleMic,
  onFileUpload,
  status,
  tableName,
  audioContext,
  stream,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <h2>Gemini Data Wrangler</h2>

      <button
        className={`connect-btn ${connected ? "on" : "off"}`}
        onClick={onToggleConnection}
      >
        {connected ? "Disconnect" : "Connect"}
      </button>

      {connected && (
        <button
          className={`mic-btn ${micActive ? "on" : "off"}`}
          onClick={onToggleMic}
        >
          {micActive ? "Mute Mic" : "Unmute Mic"}
        </button>
      )}

      <div
        className={`status-badge ${status === "connected" ? "connected" : "disconnected"}`}
      >
        {status}
      </div>

      <div className="audio-visualizer">
        {micActive ? (
          <AudioVisualizer
            audioContext={audioContext}
            stream={stream}
            active={micActive}
          />
        ) : connected ? (
          "Mic muted"
        ) : (
          "Connect to start voice session"
        )}
      </div>

      <div className="sidebar-section">
        <h3>Data Source</h3>
        {tableName ? (
          <div className="table-badge">Table: {tableName}</div>
        ) : (
          <FileUpload onFile={onFileUpload} />
        )}
      </div>
    </aside>
  );
}
