import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { registerWebSocketRoutes } from "./ws.js";
import { resolveApiKey, saveEncryptedApiKey, validateApiKey } from "./apiKeyStore.js";
import dotenv from "dotenv";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src -> ../../.env in dev, dist -> ../../.env in prod build output.
dotenv.config({ path: resolve(__dirname, "../../.env") });

const PORT = Number(process.env.PORT) || 3001;

async function main() {
  const app = Fastify({ logger: true });

  await app.register(websocket);
  registerWebSocketRoutes(app);

  // Health / config endpoint — lets the frontend know the server has an API key
  app.get("/health", async () => ({
    ok: true,
    hasApiKey: !!resolveApiKey(),
  }));

  // Save API key from UI settings (encrypted on disk)
  app.post("/api/settings/api-key", async (req, reply) => {
    const { apiKey } = (req.body as { apiKey?: string }) || {};
    const trimmed = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!trimmed) {
      return reply.status(400).send({ error: "API key is required." });
    }
    if (!validateApiKey(trimmed)) {
      return reply.status(400).send({ error: "Invalid API key format." });
    }
    const result = saveEncryptedApiKey(trimmed);
    if (!result.ok) {
      return reply.status(500).send({ error: result.error });
    }
    return { success: true };
  });

  // In production, serve the built UI static files
  const uiDistPath = resolve(__dirname, "../../ui/dist");
  if (existsSync(uiDistPath)) {
    await app.register(fastifyStatic, {
      root: uiDistPath,
      prefix: "/",
      wildcard: false,
    });
    // SPA fallback: serve index.html for any non-API, non-WS route
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile("index.html");
    });
  }

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Backend listening on http://0.0.0.0:${PORT}`);

  // Graceful shutdown so the port is released when the process is stopped
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) process.exit(0); // second Ctrl+C = force exit
    shuttingDown = true;
    console.log("Shutting down server...");
    // Force exit after 2s if app.close() hangs on open connections
    setTimeout(() => process.exit(0), 2000).unref();
    app.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
