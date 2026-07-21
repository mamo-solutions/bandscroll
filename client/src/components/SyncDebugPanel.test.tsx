// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SyncDebugPanel } from "./SyncDebugPanel";

const { adminMetrics } = vi.hoisted(() => ({ adminMetrics: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { adminMetrics } }));
vi.mock("@/sockets/socket", () => ({
  getSocket: () => ({ connected: false, emit: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SyncDebugPanel", () => {
  it("shows local diagnostics without requesting protected process metrics", () => {
    render(<SyncDebugPanel />);
    expect(screen.getByLabelText("Sync debug inspector")).toBeTruthy();
    expect(screen.getByText("Authoritative snapshot")).toBeTruthy();
    expect(adminMetrics).not.toHaveBeenCalled();
  });

  it("loads protected process metrics only in the admin variant", async () => {
    adminMetrics.mockResolvedValue({
      activeSockets: 4,
      connectedClients: 3,
      socket: { eventsPerSec: 2, sessionStateBroadcasts: 8 },
      http: { avgLatencyMs: 4, errors5xx: 0 },
      memory: { rssMb: 50 },
      uptimeSec: 20,
    });
    render(<SyncDebugPanel admin />);
    await waitFor(() => expect(adminMetrics).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Server process")).toBeTruthy();
  });
});
