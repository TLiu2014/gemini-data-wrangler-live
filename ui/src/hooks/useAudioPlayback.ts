import { useRef, useCallback } from "react";

const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live outputs 24kHz PCM

export function useAudioPlayback() {
  const ctxRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const getContext = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      nextStartRef.current = 0;
      // Create a persistent analyser for the output visualizer
      analyserRef.current = ctxRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.9;
      analyserRef.current.minDecibels = -85;
      analyserRef.current.maxDecibels = -20;
      analyserRef.current.connect(ctxRef.current.destination);
    }
    return ctxRef.current;
  }, []);

  const playChunk = useCallback(
    (base64: string) => {
      const ctx = getContext();

      // Decode base64 → Int16 PCM → Float32
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 0x8000;
      }

      const buffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // Route through analyser so visualizer can pick it up
      if (analyserRef.current) {
        source.connect(analyserRef.current);
      } else {
        source.connect(ctx.destination);
      }

      const now = ctx.currentTime;
      const startAt = Math.max(now, nextStartRef.current);
      source.start(startAt);
      nextStartRef.current = startAt + buffer.duration;
    },
    [getContext],
  );

  const stop = useCallback(() => {
    ctxRef.current?.close();
    ctxRef.current = null;
    analyserRef.current = null;
    nextStartRef.current = 0;
  }, []);

  return { playChunk, stop, analyser: analyserRef };
}
