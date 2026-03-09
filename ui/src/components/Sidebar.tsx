import { useRef, useEffect, useState } from "react";
import AudioVisualizer from "./AudioVisualizer.js";
import FileUpload from "./FileUpload.js";
import type { MicPermissionState } from "../hooks/useMicPermission.js";

interface ChatMessage {
  role: "user" | "gemini";
  text: string;
  thinking?: string;
  ts: number;
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const [showThinking, setShowThinking] = useState(false);
  const hasThinking = !!msg.thinking?.trim();
  const hasText = !!msg.text.trim();

  // Don't render empty bubbles
  if (!hasText && !hasThinking) return null;

  return (
    <div className={`chat-bubble ${msg.role}`}>
      <span className="chat-role">{msg.role === "user" ? "You" : "Gemini"}</span>
      {hasText && <span className="chat-text">{msg.text}</span>}
      {hasThinking && (
        <button
          className="thinking-toggle"
          onClick={() => setShowThinking((v) => !v)}
        >
          {showThinking ? "Hide thinking" : "Show thinking"}
        </button>
      )}
      {showThinking && hasThinking && (
        <div className="thinking-content">{msg.thinking}</div>
      )}
    </div>
  );
}

interface SidebarProps {
  micActive: boolean;
  micPermission: MicPermissionState;
  onToggleMic: () => void;
  onFileUpload: (files: File[]) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  autoConnect: boolean;
  status: string;
  geminiError: string | null;
  hasApiKey: boolean;
  dbReady?: boolean;
  dbInitError?: string | null;
  dbLoading?: boolean;
  dbError?: string | null;
  micAnalyser: React.RefObject<AnalyserNode | null>;
  geminiAnalyser: React.RefObject<AnalyserNode | null>;
  chatLog: ChatMessage[];
}

function deriveAgentStatus(status: string, hasApiKey: boolean, geminiError: string | null): { text: string; level: "ok" | "warn" | "error" | "off" } {
  if (!hasApiKey) return { text: "API key missing — set in Settings or .env", level: "warn" };
  if (status === "error") return { text: geminiError ?? "Gemini session failed", level: "error" };
  if (status === "connected") return { text: "Agent connected", level: "ok" };
  if (status === "connecting") return { text: "Connecting to Gemini...", level: "warn" };
  return { text: "Disconnected", level: "off" };
}

export default function Sidebar({
  micActive,
  micPermission,
  onToggleMic,
  onFileUpload,
  onConnect,
  onDisconnect,
  autoConnect,
  status,
  geminiError,
  hasApiKey,
  dbReady = true,
  dbInitError = null,
  dbLoading = false,
  dbError = null,
  micAnalyser,
  geminiAnalyser,
  chatLog,
}: SidebarProps) {
  const agentInfo = deriveAgentStatus(status, hasApiKey, geminiError);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatLog]);

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

      {/* Connect / Disconnect (manual mode only) */}
      {!autoConnect && (
        <div className="sidebar-section connect-section">
          {status === "connected" ? (
            <button className="gemini-disconnect-btn" onClick={onDisconnect}>
              Disconnect
            </button>
          ) : (
            <button
              className="gemini-connect-btn"
              onClick={onConnect}
              disabled={status === "connecting" || !hasApiKey}
              title={!hasApiKey ? "Set your API key in Settings first" : undefined}
            >
              {status === "connecting" ? "Connecting..." : "Connect to Gemini"}
            </button>
          )}
        </div>
      )}

      {/* Agent status */}
      <div className="status-indicator">
        <span className={`status-dot ${agentInfo.level === "ok" ? "on" : agentInfo.level === "warn" ? "warn" : agentInfo.level === "error" ? "error" : ""}`} />
        <span className="status-text">{agentInfo.text}</span>
      </div>

      {/* Audio visualizers */}
      <div className="visualizer-row">
        <div className="visualizer-item">
          <span className="visualizer-label">You {micActive && <span className="voice-live">Live</span>}</span>
          <AudioVisualizer
            analyser={micAnalyser.current}
            color={[66, 133, 244]}
            colorEnd={[156, 39, 176]}
            label=""
            active={micActive}
          />
        </div>
        <div className="visualizer-item">
          <span className="visualizer-label">Gemini {status === "connected" && <span className="voice-live gemini">Active</span>}</span>
          <AudioVisualizer
            analyser={geminiAnalyser.current}
            color={[156, 39, 176]}
            colorEnd={[66, 133, 244]}
            label=""
            active={status === "connected"}
          />
        </div>
      </div>

      {/* Unified chat log */}
      <div className="chat-log">
        {chatLog.length === 0 && (
          <span className="voice-placeholder">
            Conversation will appear here...
          </span>
        )}
        {chatLog.map((msg, i) => (
          <ChatBubble key={i} msg={msg} />
        ))}
        <div ref={chatEndRef} />
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
            ? "Mute"
            : "Unmute"}
      </button>
    </>
  );
}
