import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";
import type { MarkerSuggestionSet } from "./types.js";

export class MarkerSuggestionStore {
  private readonly db: Database.Database;
  private readonly suggestions = new Map<string, MarkerSuggestionSet>();

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(resolve(dataDir, "marker-suggestions.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marker_suggestions (
        session_id TEXT PRIMARY KEY,
        payload    TEXT NOT NULL
      );
    `);
    this.load();
  }

  private load(): void {
    const rows = this.db.prepare(`SELECT session_id, payload FROM marker_suggestions`).all() as Array<{
      session_id: string;
      payload: string;
    }>;

    for (const row of rows) {
      try {
        this.suggestions.set(row.session_id, JSON.parse(row.payload) as MarkerSuggestionSet);
      } catch (err) {
        logger.warn("skipping corrupt marker suggestion row", { sessionId: row.session_id, err });
      }
    }
  }

  get(sessionId: string): MarkerSuggestionSet | undefined {
    return this.suggestions.get(sessionId);
  }

  upsert(value: MarkerSuggestionSet): MarkerSuggestionSet {
    this.suggestions.set(value.sessionId, value);
    this.db.prepare(
      `INSERT INTO marker_suggestions (session_id, payload) VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET payload = excluded.payload`
    ).run(value.sessionId, JSON.stringify(value));
    return value;
  }

  remove(sessionId: string): boolean {
    const existed = this.suggestions.delete(sessionId);
    if (!existed) return false;
    this.db.prepare(`DELETE FROM marker_suggestions WHERE session_id = ?`).run(sessionId);
    return true;
  }

  clear(): void {
    this.suggestions.clear();
    this.db.prepare(`DELETE FROM marker_suggestions`).run();
  }

  close(): void {
    this.db.close();
  }
}

let store: MarkerSuggestionStore | null = null;

export function getMarkerSuggestionStore(): MarkerSuggestionStore {
  if (!store) {
    store = new MarkerSuggestionStore(env.DATA_DIR);
  }
  return store;
}

export function resetMarkerSuggestionStoreForTests(): void {
  if (store) {
    store.close();
    store = null;
  }
}
