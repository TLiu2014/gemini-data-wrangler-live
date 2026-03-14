import { useState, useEffect, useRef } from "react";

interface TopBarProps {
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  dataLayout: "top-bottom" | "left-right";
  onDataLayoutChange: (layout: "top-bottom" | "left-right") => void;
  startMicMuted: boolean;
  onStartMicMutedChange: (muted: boolean) => void;
  useSampleData: boolean;
  onUseSampleDataChange: (use: boolean) => void;
  useSampleFlow: boolean;
  onUseSampleFlowChange: (use: boolean) => void;
  autoConnect: boolean;
  onAutoConnectChange: (auto: boolean) => void;
}

export default function TopBar({
  apiKey,
  onApiKeyChange,
  dataLayout,
  onDataLayoutChange,
  startMicMuted,
  onStartMicMutedChange,
  useSampleData,
  onUseSampleDataChange,
  useSampleFlow,
  onUseSampleFlowChange,
  autoConnect,
  onAutoConnectChange,
}: TopBarProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setKeyInput(apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (!showSettings) return;
    const handleClick = (e: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest(".settings-btn")
      ) {
        setShowSettings(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSettings]);

  return (
    <div className="top-bar">
      <h1 className="top-bar-title">Gemini Data Wrangler Live</h1>

      <div style={{ position: "relative" }}>
        <button
          className={`settings-btn ${showSettings ? "active" : ""}`}
          onClick={() => setShowSettings(!showSettings)}
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {showSettings && (
          <div className="settings-dropdown" ref={settingsRef}>
            <div className="settings-header">
              <h3>Settings</h3>
              <button className="settings-close" onClick={() => setShowSettings(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="settings-section">
              <label className="settings-label">Gemini API Key</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="password"
                  className="settings-input"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Enter API key..."
                />
                <button
                  className="settings-save-btn"
                  onClick={() => {
                    onApiKeyChange(keyInput);
                    setShowSettings(false);
                  }}
                >
                  Save
                </button>
              </div>
              <p className="settings-hint">
                Stored in your browser session only — never sent to any server except directly to Gemini. Get a free key at{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                  aistudio.google.com
                </a>
              </p>
            </div>

            <div className="settings-section">
              <label className="settings-label">Connection</label>
              <label className="settings-checkbox-option">
                <input
                  type="checkbox"
                  checked={autoConnect}
                  onChange={(e) => onAutoConnectChange(e.target.checked)}
                />
                <span>Auto-connect on load</span>
              </label>
              <p className="settings-hint">When unchecked, use the Connect button in the sidebar to start a Gemini session manually (saves free-tier quota).</p>
            </div>

            <div className="settings-section">
              <label className="settings-label">Mic when started</label>
              <label className="settings-checkbox-option">
                <input
                  type="checkbox"
                  checked={startMicMuted}
                  onChange={(e) => onStartMicMutedChange(e.target.checked)}
                />
                <span>Start with mic muted</span>
              </label>
              <p className="settings-hint">When unchecked (default), mic is unmuted when the session starts.</p>
            </div>

            <div className="settings-section">
              <label className="settings-label">Sample Data</label>
              <label className="settings-checkbox-option">
                <input
                  type="checkbox"
                  checked={useSampleData}
                  onChange={(e) => onUseSampleDataChange(e.target.checked)}
                />
                <span>Load sample tables (customers + orders)</span>
              </label>
              <p className="settings-hint">Loads two sample CSV tables on startup.</p>
            </div>

            <div className="settings-section">
              <label className="settings-label">Sample Flow</label>
              <label className="settings-checkbox-option">
                <input
                  type="checkbox"
                  checked={useSampleFlow}
                  onChange={(e) => onUseSampleFlowChange(e.target.checked)}
                />
                <span>Load sample flow (2 loads + 1 join)</span>
              </label>
              <p className="settings-hint">Creates a sample pipeline with a JOIN stage. Requires sample data.</p>
            </div>

            <div className="settings-section">
              <label className="settings-label">Flow + Data Layout</label>
              <div className="settings-radio-group">
                <label className="settings-radio-option">
                  <input
                    type="radio"
                    name="layout"
                    value="top-bottom"
                    checked={dataLayout === "top-bottom"}
                    onChange={() => onDataLayoutChange("top-bottom")}
                  />
                  <span>Top / Bottom</span>
                </label>
                <label className="settings-radio-option">
                  <input
                    type="radio"
                    name="layout"
                    value="left-right"
                    checked={dataLayout === "left-right"}
                    onChange={() => onDataLayoutChange("left-right")}
                  />
                  <span>Left / Right</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
