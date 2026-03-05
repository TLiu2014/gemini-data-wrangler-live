import { useRef, useEffect } from "react";

interface AudioVisualizerProps {
  audioContext: React.RefObject<AudioContext | null>;
  stream: React.RefObject<MediaStream | null>;
  active: boolean;
}

export default function AudioVisualizer({ audioContext, stream, active }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active || !audioContext.current || !stream.current) return;

    const ctx = canvas.getContext("2d")!;
    const analyser = audioContext.current.createAnalyser();
    analyser.fftSize = 256;

    const source = audioContext.current.createMediaStreamSource(stream.current);
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const barWidth = (width / bufferLength) * 2;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * height;

        // Gradient from indigo to cyan
        const ratio = i / bufferLength;
        const r = Math.floor(79 * (1 - ratio) + 34 * ratio);
        const g = Math.floor(70 * (1 - ratio) + 211 * ratio);
        const b = Math.floor(229 * (1 - ratio) + 153 * ratio);
        ctx.fillStyle = `rgb(${r},${g},${b})`;

        ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      source.disconnect();
    };
  }, [audioContext, stream, active]);

  return (
    <canvas
      ref={canvasRef}
      width={228}
      height={120}
      style={{ width: "100%", height: "100%", borderRadius: 8 }}
    />
  );
}
