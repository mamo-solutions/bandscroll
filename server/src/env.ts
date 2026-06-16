import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load the root .env (one level up from /server) if present, else local .env.
const rootEnv = resolve(process.cwd(), "../.env");
const localEnv = resolve(process.cwd(), ".env");
loadEnv({ path: existsSync(rootEnv) ? rootEnv : localEnv });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const NODE_ENV = process.env.NODE_ENV ?? "development";

export const env = {
  NODE_ENV,
  isProduction: NODE_ENV === "production",
  PORT: Number(process.env.PORT ?? 3000),
  ADMIN_PASSWORD: required("ADMIN_PASSWORD", "change-me-now"),
  ADMIN_SESSION_SECRET: required(
    "ADMIN_SESSION_SECRET",
    "please-change-this-to-a-long-random-secret"
  ),
  // Resolved to an absolute path so uploads land in one predictable place.
  UPLOAD_DIR: resolve(process.cwd(), process.env.UPLOAD_DIR ?? "../uploads"),
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
  // Storage backend. "memory" keeps the original zero-config behaviour;
  // "file" persists sessions to DATA_DIR/sessions.json across restarts.
  STORAGE: process.env.STORAGE ?? "memory",
  DATA_DIR: resolve(process.cwd(), process.env.DATA_DIR ?? "../data"),
};

export type Env = typeof env;
