import { useRef, useEffect } from "react";
import AudioVisualizer from "./AudioVisualizer.js";
import FileUpload from "./FileUpload.js";
import type { MicPermissionState } from "../hooks/useMicPermission.js";

interface SidebarProps {
  micActive: boolean;
  micPermission: MicPermissionState;
  onToggleMic: () => void;
  onFileUpload: (files: File[]) => void;
  status: string;
  apiKey: string;
  dbReady?: boolean;
  dbInitError?: string | null;
  dbLoading?: boolean;
  dbError?: string | null;
  micAnalyser: React.RefObject<AnalyserNode | null>;
  geminiAnalyser: React.RefObject<AnalyserNode | null>;
  userTranscript: string;
  geminiTranscript: string;
}

function deriveAgentStatus(status: string, apiKey: string): { text: string; level: "ok" | "warn" | "error" | "off" } {
  if (!apiKey) return { text: "API key missing — set in Settings", level: "warn" };
  if (status === "connected") return { text: "Agent connected", level: "ok" };
  if (status === "connecting") return { text: "Connecting...", level: "warn" };
  return { text: "Disconnected", level: "off" };
}

export default function Sidebar({
  micActive,
  micPermission,
  onToggleMic,
  onFileUpload,
  status,
  apiKey,
  dbReady = true,
  dbInitError = null,
  dbLoading = false,
  dbError = null,
  micAnalyser,
  geminiAnalyser,
  userTranscript,
  geminiTranscript,
}: SidebarProps) {
  const agentInfo = deriveAgentStatus(status, apiKey);

  const userLogRef = useRef<HTMLDivElement>(null);
  const geminiLogRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (userLogRef.current) userLogRef.current.scrollTop = userLogRef.current.scrollHeight;
  }, [userTranscript]);
  useEffect(() => {
    if (geminiLogRef.current) geminiLogRef.current.scrollTop = geminiLogRef.current.scrollHeight;
  }, [geminiTranscript]);

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
      </div>

      {/* Agent status */}
      <div className="status-indicator">
        <span className={`status-dot ${agentInfo.level === "ok" ? "on" : agentInfo.level === "warn" ? "warn" : ""}`} />
        <span className="status-text">{agentInfo.text}</span>
      </div>

      {/* Conversation area — fills remaining sidebar space */}
      <div className="conversation-area">
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
          <div className="voice-transcript" ref={userLogRef}>
            {userTranscript || <span className="voice-placeholder">Start speaking — your words will appear here...</span>}
          </div>
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
          <div className="voice-transcript" ref={geminiLogRef}>
            {geminiTranscript || <span className="voice-placeholder">Gemini's responses will appear here...</span>}
          </div>
        </div>
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
