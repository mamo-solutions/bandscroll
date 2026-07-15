import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";
import type { AdminNotification } from "./types.js";

export class AdminNotificationStore {
  private readonly db: Database.Database;
  private readonly notifications = new Map<string, AdminNotification>();

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(resolve(dataDir, "admin-notifications.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_notifications (
        id      TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
    `);
    this.load();
  }

  private load(): void {
    const rows = this.db.prepare(`SELECT id, payload FROM admin_notifications`).all() as Array<{
      id: string;
      payload: string;
    }>;

    for (const row of rows) {
      try {
        this.notifications.set(row.id, JSON.parse(row.payload) as AdminNotification);
      } catch (err) {
        logger.warn("skipping corrupt admin notification row", { id: row.id, err });
      }
    }
  }

  listUnread(): AdminNotification[] {
    return [...this.notifications.values()]
      .filter((notification) => !notification.acknowledgedAt)
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  get(id: string): AdminNotification | undefined {
    return this.notifications.get(id);
  }

  upsert(notification: AdminNotification): AdminNotification {
    this.notifications.set(notification.id, notification);
    this.db.prepare(
      `INSERT INTO admin_notifications (id, payload) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`
    ).run(notification.id, JSON.stringify(notification));
    return notification;
  }

  acknowledge(id: string): AdminNotification | null {
    const existing = this.notifications.get(id);
    if (!existing) return null;
    if (existing.acknowledgedAt) return existing;
    return this.upsert({
      ...existing,
      acknowledgedAt: Date.now(),
    });
  }

  clear(): void {
    this.notifications.clear();
    this.db.prepare(`DELETE FROM admin_notifications`).run();
  }

  close(): void {
    this.db.close();
  }
}

let store: AdminNotificationStore | null = null;

export function getAdminNotificationStore(): AdminNotificationStore {
  if (!store) {
    store = new AdminNotificationStore(env.DATA_DIR);
  }
  return store;
}

export function resetAdminNotificationStoreForTests(): void {
  if (store) {
    store.close();
    store = null;
  }
}
