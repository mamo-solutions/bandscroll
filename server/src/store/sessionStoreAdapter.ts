import type { SessionState } from "../types.js";

/** Pluggable backend for session persistence. */
export interface SessionStoreAdapter {
  /** Retrieve a session by id. */
  get(id: string): SessionState | undefined;

  /**
   * Store (or update) a session and return it.
   * For persistent adapters this is the hook that commits to disk/DB.
   */
  set(id: string, session: SessionState): SessionState;

  /** Remove a session. Returns true if it existed. */
  delete(id: string): boolean;

  /** Iterate all sessions. */
  values(): IterableIterator<SessionState>;

  /** Remove all sessions from the backing store. Intended for tests/reset hooks. */
  clear(): void;
}
