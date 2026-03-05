import { useRef, useState, useCallback } from "react";

export interface WsMessage {
  type: "audio" | "screenshot" | "action" | "sql" | "status" | "text";
  payload: unknown;
}

export type ActionPayload = {
  action: "ADD_NODE" | "EXECUTE_SQL" | "RENDER_CHART";
  [key: string]: unknown;
};

type ConnectionStatus = "disconnected" | "connecting" | "connected";

interface UseWebSocketOptions {
  onAudio?: (payload: { data: string; mimeType: string }) => void;
  onAction?: (payload: ActionPayload) => void;
  onSql?: (payload: { sql: string; description: string }) => void;
  onText?: (payload: { text: string }) => void;
}

export function useWebSocket(opts: UseWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => setStatus("connected");

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);

        switch (msg.type) {
          case "audio":
            optsRef.current.onAudio?.(msg.payload as { data: string; mimeType: string });
            break;
          case "action":
            optsRef.current.onAction?.(msg.payload as ActionPayload);
            break;
          case "sql":
            optsRef.current.onSql?.(msg.payload as { sql: string; description: string });
            break;
          case "text":
            optsRef.current.onText?.(msg.payload as { text: string });
            break;
          case "status":
            console.log("Status:", msg.payload);
            break;
        }
      } catch {
        console.error("Failed to parse WS message");
      }
    };

    ws.onclose = () => setStatus("disconnected");
    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      setStatus("disconnected");
    };

    wsRef.current = ws;
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("disconnected");
  }, []);

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { status, connect, disconnect, send };
}
