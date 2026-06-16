import type { SessionState } from "../types.js";
import type { SessionStoreAdapter } from "./sessionStoreAdapter.js";

/** In-memory session store. This is the zero-config default. */
export class MemorySessionStore implements SessionStoreAdapter {
  private sessions = new Map<string, SessionState>();

  get(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  set(id: string, session: SessionState): SessionState {
    this.sessions.set(id, session);
    return session;
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  values(): IterableIterator<SessionState> {
    return this.sessions.values();
  }
}
