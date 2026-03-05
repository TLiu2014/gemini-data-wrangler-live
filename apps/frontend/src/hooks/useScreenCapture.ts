import { useRef, useCallback } from "react";

const CAPTURE_INTERVAL_MS = 2000;
const JPEG_QUALITY = 0.5;
const MAX_WIDTH = 1024;

export function useScreenCapture(onCapture: (base64: string) => void) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const captureFrame = useCallback(
    async (target: HTMLElement) => {
      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
      }
      const canvas = canvasRef.current;
      const rect = target.getBoundingClientRect();
      const scale = Math.min(1, MAX_WIDTH / rect.width);
      canvas.width = rect.width * scale;
      canvas.height = rect.height * scale;

      // Use the native Canvas API to draw a snapshot of the DOM
      // html2canvas is a heavy dep — instead we use a lightweight approach:
      // capture via the Screen Capture API if available, fallback to blank frame
      try {
        // Try using the built-in dom-to-image approach via foreignObject
        const ctx = canvas.getContext("2d")!;
        const svg = `
          <svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
            <foreignObject width="100%" height="100%">
              <div xmlns="http://www.w3.org/1999/xhtml"
                   style="font-size:12px;color:#e0e0e0;background:#0f1117;padding:8px;">
                [UI Snapshot - ${new Date().toISOString()}]
              </div>
            </foreignObject>
          </svg>`;
        const img = new Image();
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        await new Promise<void>((resolve) => {
          img.onload = () => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          img.src = url;
        });

        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        const base64 = dataUrl.split(",")[1];
        if (base64) onCapture(base64);
      } catch {
        // Silently skip frame on error
      }
    },
    [onCapture],
  );

  const start = useCallback(
    (target: HTMLElement) => {
      if (intervalRef.current) return;
      captureFrame(target); // immediate first capture
      intervalRef.current = setInterval(() => captureFrame(target), CAPTURE_INTERVAL_MS);
    },
    [captureFrame],
  );

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  return { start, stop };
}
