import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { SessionState } from "../types.js";
import type { SessionStoreAdapter } from "./sessionStoreAdapter.js";

/**
 * SQLite-backed session store. Durable across restarts like FileSessionStore,
 * but commits each mutation as its own row write (no whole-file rewrite) so it
 * scales to many sessions and survives crashes mid-write.
 *
 * The full SessionState is kept as a JSON blob in `data`; a few hot scalar
 * columns (code, status, created_at) are mirrored alongside it so the table
 * stays queryable/indexable without parsing every row. Reads are served from an
 * in-memory mirror loaded once at construction (identical synchronous semantics
 * to FileSessionStore); writes go through to SQLite immediately.
 */
export class SqliteSessionStore implements SessionStoreAdapter {
  private sessions = new Map<string, SessionState>();
  private readonly db: Database.Database;
  private readonly upsertStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.db = new Database(resolve(dataDir, "sessions.db"));
    // WAL gives better durability/concurrency than the default rollback journal.
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        code       TEXT NOT NULL,
        status     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        data       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    `);
    this.upsertStmt = this.db.prepare(
      `INSERT INTO sessions (id, code, status, created_at, data)
       VALUES (@id, @code, @status, @createdAt, @data)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code,
         status = excluded.status,
         created_at = excluded.created_at,
         data = excluded.data`
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM sessions WHERE id = ?`);
    this.load();
  }

  private load(): void {
    const rows = this.db.prepare(`SELECT data FROM sessions`).all() as {
      data: string;
    }[];
    for (const row of rows) {
      try {
        const session = JSON.parse(row.data) as SessionState;
        // Backfill fields added in newer schema versions so old persisted
        // sessions don't crash clients that expect them.
        session.markers ??= [];
        session.locked ??= false;
        // These fields are runtime-only; never restore them across restarts.
        session.connectedClients = 0;
        session.updatedAt = Date.now();
        this.sessions.set(session.id, session);
      } catch {
        // Skip a corrupt row rather than failing the whole load.
      }
    }
  }

  get(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  set(id: string, session: SessionState): SessionState {
    this.sessions.set(id, session);
    this.upsertStmt.run({
      id: session.id,
      code: session.code,
      status: session.status,
      createdAt: session.createdAt,
      data: JSON.stringify(session),
    });
    return session;
  }

  delete(id: string): boolean {
    const existed = this.sessions.delete(id);
    if (existed) this.deleteStmt.run(id);
    return existed;
  }

  values(): IterableIterator<SessionState> {
    return this.sessions.values();
  }

  /** Release the underlying database handle (used in tests). */
  close(): void {
    this.db.close();
  }
}
