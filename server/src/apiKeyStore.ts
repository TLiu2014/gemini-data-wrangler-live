/**
 * API key resolution for local development.
 *
 * In production (Cloud Run), no server-side key is configured — users supply
 * their own key via the Settings panel in the UI, and it is passed per-session
 * over the WebSocket (never stored server-side).
 *
 * For local development, set GOOGLE_API_KEY in your .env file and the server
 * uses it as a fallback when the client sends an empty key.
 */

export function resolveApiKey(): string {
  return process.env.GOOGLE_API_KEY ?? "";
}

export function validateApiKey(apiKey: string): boolean {
  if (!apiKey || typeof apiKey !== "string") return false;
  const trimmed = apiKey.trim();
  if (trimmed.length < 30 || trimmed.length > 60) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return false;
  return true;
}
