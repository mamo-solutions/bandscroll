import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";
import type { AiProvider, AiProviderConfig, AiTestStatus } from "./types.js";

type SettingKey = "activeProvider";

export class AiConfigStore {
  private readonly db: Database.Database;
  private readonly configs = new Map<AiProvider, AiProviderConfig>();
  private activeProvider: AiProvider | null = null;

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(resolve(dataDir, "ai-config.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_provider_configs (
        provider         TEXT PRIMARY KEY,
        encrypted_api_key TEXT NOT NULL,
        base_url         TEXT,
        default_model    TEXT,
        capabilities     TEXT NOT NULL,
        last_tested_at   INTEGER,
        last_test_status TEXT,
        last_error       TEXT,
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.load();
  }

  private load(): void {
    const rows = this.db.prepare(
      `SELECT provider, encrypted_api_key, base_url, default_model, capabilities,
              last_tested_at, last_test_status, last_error, created_at, updated_at
       FROM ai_provider_configs`
    ).all() as Array<{
      provider: AiProvider;
      encrypted_api_key: string;
      base_url: string | null;
      default_model: string | null;
      capabilities: string;
      last_tested_at: number | null;
      last_test_status: AiTestStatus | null;
      last_error: string | null;
      created_at: number;
      updated_at: number;
    }>;

    for (const row of rows) {
      try {
        this.configs.set(row.provider, {
          provider: row.provider,
          encryptedApiKey: row.encrypted_api_key,
          baseUrl: row.base_url ?? undefined,
          defaultModel: row.default_model ?? undefined,
          capabilities: JSON.parse(row.capabilities) as AiProviderConfig["capabilities"],
          lastTestedAt: row.last_tested_at ?? undefined,
          lastTestStatus: row.last_test_status ?? undefined,
          lastError: row.last_error ?? undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      } catch (err) {
        logger.warn("skipping corrupt ai config row", { provider: row.provider, err });
      }
    }

    const active = this.db
      .prepare(`SELECT value FROM ai_settings WHERE key = ?`)
      .get("activeProvider") as { value: string } | undefined;
    this.activeProvider = (active?.value as AiProvider | undefined) ?? null;
  }

  list(): AiProviderConfig[] {
    return [...this.configs.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  }

  get(provider: AiProvider): AiProviderConfig | undefined {
    return this.configs.get(provider);
  }

  getActiveProvider(): AiProvider | null {
    return this.activeProvider;
  }

  upsert(config: Omit<AiProviderConfig, "createdAt" | "updatedAt">): AiProviderConfig {
    const now = Date.now();
    const existing = this.configs.get(config.provider);
    const next: AiProviderConfig = {
      ...config,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.configs.set(next.provider, next);
    this.db.prepare(
      `INSERT INTO ai_provider_configs (
          provider, encrypted_api_key, base_url, default_model, capabilities,
          last_tested_at, last_test_status, last_error, created_at, updated_at
        ) VALUES (
          @provider, @encrypted_api_key, @base_url, @default_model, @capabilities,
          @last_tested_at, @last_test_status, @last_error, @created_at, @updated_at
        )
        ON CONFLICT(provider) DO UPDATE SET
          encrypted_api_key = excluded.encrypted_api_key,
          base_url = excluded.base_url,
          default_model = excluded.default_model,
          capabilities = excluded.capabilities,
          last_tested_at = excluded.last_tested_at,
          last_test_status = excluded.last_test_status,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at`
    ).run({
      provider: next.provider,
      encrypted_api_key: next.encryptedApiKey,
      base_url: next.baseUrl ?? null,
      default_model: next.defaultModel ?? null,
      capabilities: JSON.stringify(next.capabilities),
      last_tested_at: next.lastTestedAt ?? null,
      last_test_status: next.lastTestStatus ?? null,
      last_error: next.lastError ?? null,
      created_at: next.createdAt,
      updated_at: next.updatedAt,
    });
    return next;
  }

  updateTestResult(
    provider: AiProvider,
    result: { lastTestedAt: number; lastTestStatus: AiTestStatus; lastError?: string }
  ): AiProviderConfig | undefined {
    const existing = this.configs.get(provider);
    if (!existing) return undefined;
    return this.upsert({
      ...existing,
      lastTestedAt: result.lastTestedAt,
      lastTestStatus: result.lastTestStatus,
      lastError: result.lastError,
    });
  }

  remove(provider: AiProvider): boolean {
    const existed = this.configs.delete(provider);
    if (!existed) return false;
    this.db.prepare(`DELETE FROM ai_provider_configs WHERE provider = ?`).run(provider);
    if (this.activeProvider === provider) {
      this.setActiveProvider(null);
    }
    return true;
  }

  clear(): void {
    this.configs.clear();
    this.activeProvider = null;
    this.db.prepare(`DELETE FROM ai_provider_configs`).run();
    this.db.prepare(`DELETE FROM ai_settings`).run();
  }

  setActiveProvider(provider: AiProvider | null): void {
    this.activeProvider = provider;
    if (provider === null) {
      this.db.prepare(`DELETE FROM ai_settings WHERE key = ?`).run("activeProvider");
      return;
    }
    this.db.prepare(
      `INSERT INTO ai_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run("activeProvider" satisfies SettingKey, provider);
  }

  close(): void {
    this.db.close();
  }
}

let store: AiConfigStore | null = null;

export function getAiConfigStore(): AiConfigStore {
  if (!store) {
    store = new AiConfigStore(env.DATA_DIR);
  }
  return store;
}

export function resetAiConfigStoreForTests(): void {
  if (store) {
    store.close();
    store = null;
  }
}
