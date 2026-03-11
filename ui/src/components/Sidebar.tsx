import { useRef, useEffect, useState, useCallback } from "react";
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
  onInterrupt: () => void;
  onPause: () => void;
  onResume: () => void;
  audioPaused: boolean;
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

function exportChatLog(chatLog: ChatMessage[]) {
  const lines = chatLog.map((msg) => {
    const role = msg.role === "user" ? "You" : "Gemini";
    let line = `**${role}:** ${msg.text}`;
    if (msg.thinking?.trim()) {
      line += `\n> _Thinking: ${msg.thinking.trim()}_`;
    }
    return line;
  });
  const content = `# Chat Export\n\n${lines.join("\n\n")}`;
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-export-${new Date().toISOString().slice(0, 16).replace(":", "-")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Sidebar({
  micActive,
  micPermission,
  onToggleMic,
  onFileUpload,
  onConnect,
  onDisconnect,
  onInterrupt,
  onPause,
  onResume,
  audioPaused,
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
  const isConnected = status === "connected";

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatLog]);

  const handleExport = useCallback(() => exportChatLog(chatLog), [chatLog]);

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
          <span className="visualizer-label">Gemini {isConnected && <span className="voice-live gemini">Active</span>}</span>
          <AudioVisualizer
            analyser={geminiAnalyser.current}
            color={[156, 39, 176]}
            colorEnd={[66, 133, 244]}
            label=""
            active={isConnected}
          />
        </div>
      </div>

      {/* Control bar — all buttons in one row */}
      <div className="control-bar">
        {/* Connect / Disconnect */}
        {!autoConnect && (
          isConnected ? (
            <button className="ctrl-btn disconnect" onClick={onDisconnect} title="Disconnect">
              Disconnect
            </button>
          ) : (
            <button
              className="ctrl-btn connect"
              onClick={onConnect}
              disabled={status === "connecting" || !hasApiKey}
              title={!hasApiKey ? "Set your API key in Settings first" : "Connect to Gemini"}
            >
              {status === "connecting" ? "Connecting..." : "Connect"}
            </button>
          )
        )}

        {/* Mute / Unmute */}
        <button
          className={`ctrl-btn ${micActive ? "mic-on" : "mic-off"}`}
          onClick={onToggleMic}
          disabled={micPermission === "denied"}
          title={micPermission === "denied" ? "Mic blocked" : micActive ? "Mute" : "Unmute"}
        >
          {micPermission === "denied" ? "Blocked" : micActive ? "Mute" : "Unmute"}
        </button>

        {/* Interrupt */}
        <button
          className="ctrl-btn interrupt"
          onClick={onInterrupt}
          disabled={!isConnected}
          title="Interrupt Gemini"
        >
          Stop
        </button>

        {/* Pause / Resume */}
        <button
          className={`ctrl-btn ${audioPaused ? "resume" : "pause"}`}
          onClick={audioPaused ? onResume : onPause}
          disabled={!isConnected}
          title={audioPaused ? "Resume playback" : "Pause playback"}
        >
          {audioPaused ? "Resume" : "Pause"}
        </button>
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

      {/* Export chat */}
      {chatLog.length > 0 && (
        <button className="ctrl-btn export" onClick={handleExport} title="Export chat as markdown">
          Export Chat
        </button>
      )}
    </>
  );
}
