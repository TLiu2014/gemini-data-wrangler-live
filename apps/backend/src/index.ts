import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { registerWebSocketRoutes } from "./ws.js";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

const PORT = Number(process.env.PORT) || 3001;

async function main() {
  const app = Fastify({ logger: true });

  await app.register(websocket);
  registerWebSocketRoutes(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Backend listening on http://0.0.0.0:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
