import { useSyncExternalStore } from "react";
import { MICRO_POINTS_PER_POINT, type SessionState } from "@/types/session";

export type SyncCorrection = "snap" | "bounded" | "none";

export type SyncDebugSnapshot = {
  connected: boolean;
  transport: string | null;
  reconnectAttempts: number;
  lastSocketError: string | null;
  rttMs: number | null;
  lastPingAt: number | null;
  lastSnapshotAt: number | null;
  snapshotIntervalMs: number | null;
  positionSequence: number | null;
  stateVersion: number | null;
  controlVersion: number | null;
  correction: SyncCorrection;
  driftPoints: number | null;
  revision: string | null;
  cursorPoints: number | null;
  documentPercent: number | null;
  currentPage: number | null;
  velocityPointsPerSecond: number | null;
  playing: boolean | null;
};

const initialSnapshot: SyncDebugSnapshot = { connected: false, transport: null, reconnectAttempts: 0, lastSocketError: null, rttMs: null, lastPingAt: null, lastSnapshotAt: null, snapshotIntervalMs: null, positionSequence: null, stateVersion: null, controlVersion: null, correction: "none", driftPoints: null, revision: null, cursorPoints: null, documentPercent: null, currentPage: null, velocityPointsPerSecond: null, playing: null };
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();

function update(partial: Partial<SyncDebugSnapshot>): void {
  snapshot = { ...snapshot, ...partial };
  listeners.forEach((listener) => listener());
}

export function isSyncDebugEnabled(search?: string): boolean {
  return new URLSearchParams(search ?? window.location.search).get("debug") === "1";
}

export function recordSocketDebugEvent(event: { connected?: boolean; transport?: string | null; reconnectAttempts?: number; error?: string | null }): void {
  update({ ...(event.connected !== undefined && { connected: event.connected }), ...(event.transport !== undefined && { transport: event.transport }), ...(event.reconnectAttempts !== undefined && { reconnectAttempts: event.reconnectAttempts }), ...(event.error !== undefined && { lastSocketError: event.error }) });
}

export function recordDebugPing(rttMs: number): void {
  update({ rttMs: Math.round(rttMs), lastPingAt: Date.now(), lastSocketError: null });
}

export function recordDebugPingFailure(message: string): void {
  update({ lastSocketError: message });
}

export function recordSyncSnapshot(state: SessionState & { positionSequence?: number }, driftMicroPoints: number | null, correction: SyncCorrection): void {
  const now = Date.now();
  const cursorPoints = state.documentCursor ? state.documentCursor.yMicroPoints / MICRO_POINTS_PER_POINT : null;
  const documentPercent = cursorPoints !== null && state.documentGeometry && state.documentGeometry.totalHeightPoints > 0 ? (cursorPoints / state.documentGeometry.totalHeightPoints) * 100 : null;
  update({ lastSnapshotAt: now, snapshotIntervalMs: snapshot.lastSnapshotAt === null ? null : now - snapshot.lastSnapshotAt, positionSequence: state.positionSequence ?? null, stateVersion: state.stateVersion, controlVersion: state.controlVersion ?? null, correction, driftPoints: driftMicroPoints === null ? null : driftMicroPoints / MICRO_POINTS_PER_POINT, revision: state.documentCursor?.revision ?? null, cursorPoints, documentPercent, currentPage: state.currentPage, velocityPointsPerSecond: state.scrollVelocityPointsPerSecond ?? null, playing: state.playing });
}

export function getSyncDebugSnapshot(): SyncDebugSnapshot { return snapshot; }

export function useSyncDebugSnapshot(): SyncDebugSnapshot {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, getSyncDebugSnapshot);
}

export function formatDebugNumber(value: number | null, digits = 0): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export function resetSyncDebugForTests(): void { snapshot = initialSnapshot; }
