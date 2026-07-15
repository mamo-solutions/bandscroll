import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AdminNotificationStore } from "./adminNotificationStore.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("AdminNotificationStore", () => {
  it("persists unread notifications and acknowledgments", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bandscroll-admin-notifications-"));
    dirs.push(dataDir);

    const store = new AdminNotificationStore(dataDir);
    store.upsert({
      id: "notification-1",
      type: "marker-generation-completed",
      sessionId: "session-1",
      sessionCode: "SESSION-1111",
      sessionTitle: "Sunday Set",
      status: "ready",
      suggestionCount: 3,
      message: "AI markers are ready for SESSION-1111.",
      createdAt: 10,
    });
    expect(store.listUnread()).toHaveLength(1);
    store.acknowledge("notification-1");
    expect(store.listUnread()).toHaveLength(0);
    store.close();

    const restored = new AdminNotificationStore(dataDir);
    expect(restored.get("notification-1")?.acknowledgedAt).toBeTypeOf("number");
    restored.close();
  });
});
