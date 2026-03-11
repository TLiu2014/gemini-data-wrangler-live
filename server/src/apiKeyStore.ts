import crypto from "crypto";
import fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
const KEY_PATH = resolve(DATA_DIR, "secret.key");
const FILE_PATH = resolve(DATA_DIR, "api-key.enc");

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getEncryptionKey(): Buffer {
  ensureDataDir();
  if (!fs.existsSync(KEY_PATH)) {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(KEY_PATH, key.toString("hex"), "utf8");
    return key;
  }
  return Buffer.from(fs.readFileSync(KEY_PATH, "utf8").trim(), "hex");
}

export function saveEncryptedApiKey(plainKey: string): { ok: boolean; error?: string } {
  const key = getEncryptionKey();
  try {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const enc = Buffer.concat([cipher.update(plainKey, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const line = [iv.toString("hex"), authTag.toString("hex"), enc.toString("hex")].join(":");
    ensureDataDir();
    fs.writeFileSync(FILE_PATH, line, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function getDecryptedApiKey(): string | null {
  const key = getEncryptionKey();
  if (!fs.existsSync(FILE_PATH)) return null;
  try {
    const line = fs.readFileSync(FILE_PATH, "utf8").trim();
    const parts = line.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, authTagHex, encHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(enc, undefined, "utf8") + decipher.final("utf8");
  } catch (err) {
    console.warn("apiKeyStore: failed to read/decrypt:", (err as Error).message);
    return null;
  }
}

export function validateApiKey(apiKey: string): boolean {
  if (!apiKey || typeof apiKey !== "string") return false;
  const trimmed = apiKey.trim();
  if (trimmed.length < 30 || trimmed.length > 50) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return false;
  return true;
}

/** Resolve API key: saved file > env var */
export function resolveApiKey(): string {
  const fromFile = getDecryptedApiKey();
  if (fromFile) return fromFile;
  return process.env.GOOGLE_API_KEY || "";
}
