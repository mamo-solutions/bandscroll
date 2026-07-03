import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { encryptAiSecret } from "./crypto.js";
import { AiConfigStore } from "./aiConfigStore.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("AiConfigStore", () => {
  it("persists encrypted API keys without storing plaintext", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bandscroll-ai-config-"));
    dirs.push(dataDir);

    const store = new AiConfigStore(dataDir);
    store.upsert({
      provider: "openai",
      encryptedApiKey: encryptAiSecret("sk-plain-text-secret"),
      defaultModel: "gpt-4.1-mini",
      capabilities: ["marker-generation"],
      lastTestedAt: undefined,
      lastTestStatus: undefined,
      lastError: undefined,
    });
    store.setActiveProvider("openai");
    store.close();

    const db = new Database(join(dataDir, "ai-config.db"), { readonly: true });
    const row = db
      .prepare(`SELECT encrypted_api_key, default_model FROM ai_provider_configs WHERE provider = ?`)
      .get("openai") as { encrypted_api_key: string; default_model: string };
    db.close();

    expect(row.default_model).toBe("gpt-4.1-mini");
    expect(row.encrypted_api_key).not.toContain("sk-plain-text-secret");
    expect(row.encrypted_api_key.startsWith("v1:")).toBe(true);
  });
});
