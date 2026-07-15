import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { SessionState } from "../types.js";
import type { SessionStoreAdapter } from "./sessionStoreAdapter.js";
import { logger } from "../lib/logger.js";

/**
 * File-backed session store. Sessions are serialized to a single JSON file in
 * `dataDir` after every mutation. On construction the file is loaded and
 * transient runtime fields are reset.
 */
export class FileSessionStore implements SessionStoreAdapter {
  private sessions = new Map<string, SessionState>();
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = resolve(dataDir, "sessions.json");
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as SessionState[];
      for (const session of parsed) {
        // Backfill fields added in newer schema versions so old persisted
        // sessions don't crash clients that expect them.
        session.markers ??= [];
        session.locked ??= false;
        session.playbackMode ??= "scroll";
        session.backgroundMode ??= "light";
        session.autoStopAtSongEnd ??= false;
        session.currentPage ??= 1;
        session.numPages ??= 0;
        session.stateVersion ??= 0;
        // These fields are runtime-only; never restore them across restarts.
        session.connectedClients = 0;
        session.updatedAt = Date.now();
        this.sessions.set(session.id, session);
      }
    } catch (err) {
      // If the file is missing or corrupt, start fresh rather than crash.
      logger.warn("session file load failed; starting fresh", {
        filePath: this.filePath,
        err,
      });
      this.sessions.clear();
    }
  }

  private save(): void {
    const payload = JSON.stringify([...this.sessions.values()], null, 2);
    const tempPath = resolve(
      dirname(this.filePath),
      `sessions.${process.pid}.${Date.now()}.tmp`
    );

    try {
      writeFileSync(tempPath, payload);
      renameSync(tempPath, this.filePath);
    } catch (err) {
      rmSync(tempPath, { force: true });
      throw err;
    }
  }

  get(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  set(id: string, session: SessionState): SessionState {
    this.sessions.set(id, session);
    this.save();
    return session;
  }

  delete(id: string): boolean {
    const existed = this.sessions.delete(id);
    if (existed) this.save();
    return existed;
  }

  values(): IterableIterator<SessionState> {
    return this.sessions.values();
  }

  clear(): void {
    this.sessions.clear();
    this.save();
  }
}
