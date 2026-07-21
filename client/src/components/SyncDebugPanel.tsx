import { useEffect, useState } from "react";
import { Activity, ChevronDown, ChevronUp, Gauge, Radio } from "lucide-react";
import { api, type MetricsSnapshot } from "@/api/client";
import { formatDebugNumber, recordDebugPing, recordDebugPingFailure, useSyncDebugSnapshot } from "@/lib/syncDebug";
import { getSocket } from "@/sockets/socket";
import { cn } from "@/lib/utils";

type Props = { admin?: boolean };

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-4 border-b border-white/10 py-1 last:border-0"><span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{label}</span><span className="font-mono text-xs tabular-nums text-slate-100">{value}</span></div>;
}

export function SyncDebugPanel({ admin = false }: Props) {
  const telemetry = useSyncDebugSnapshot();
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [serverMetrics, setServerMetrics] = useState<MetricsSnapshot | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const pingTimeouts = new Set<number>();
    const ping = () => {
      if (!socket.connected) return;
      const startedAt = performance.now();
      let answered = false;
      const timeout = window.setTimeout(() => {
        pingTimeouts.delete(timeout);
        if (!answered) recordDebugPingFailure("debug ping timed out");
      }, 3_000);
      pingTimeouts.add(timeout);
      socket.emit("debug-ping", () => {
        answered = true;
        window.clearTimeout(timeout);
        pingTimeouts.delete(timeout);
        recordDebugPing(performance.now() - startedAt);
      });
    };
    ping();
    const timer = window.setInterval(ping, 5_000);
    return () => {
      window.clearInterval(timer);
      pingTimeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, []);

  useEffect(() => {
    if (!admin) return;
    let active = true;
    const load = () => {
      void api.adminMetrics().then((metrics) => { if (active) setServerMetrics(metrics); }).catch(() => { if (active) setServerMetrics(null); });
    };
    load();
    const timer = window.setInterval(load, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [admin]);

  const snapshotAge = telemetry.lastSnapshotAt === null ? null : now - telemetry.lastSnapshotAt;
  return (
    <aside className="fixed bottom-3 right-3 z-[100] w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-cyan-300/30 bg-slate-950/95 font-sans text-slate-100 shadow-2xl shadow-black/50 backdrop-blur" aria-label="Sync debug inspector">
      <button type="button" className="flex w-full items-center justify-between bg-cyan-400/10 px-3 py-2 text-left" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200"><Activity className="size-3.5" />Sync inspector</span>
        {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>
      {!collapsed && <div className="max-h-[70vh] overflow-y-auto p-3">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className={cn("rounded border px-2 py-1.5 text-xs", telemetry.connected ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-rose-400/30 bg-rose-400/10 text-rose-200")}><Radio className="mr-1 inline size-3" />{telemetry.connected ? "Connected" : "Disconnected"}</div>
          <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200"><Gauge className="mr-1 inline size-3" />{telemetry.rttMs === null ? "RTT —" : `RTT ${telemetry.rttMs} ms`}</div>
        </div>
        <section className="mb-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Connection</p><Metric label="Transport" value={telemetry.transport ?? "—"} /><Metric label="Reconnects" value={String(telemetry.reconnectAttempts)} /><Metric label="Last error" value={telemetry.lastSocketError ?? "—"} /></section>
        <section className="mb-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Authoritative snapshot</p><Metric label="Age" value={snapshotAge === null ? "—" : `${snapshotAge} ms`} /><Metric label="Interval" value={telemetry.snapshotIntervalMs === null ? "—" : `${telemetry.snapshotIntervalMs} ms`} /><Metric label="Sequence" value={telemetry.positionSequence === null ? "—" : String(telemetry.positionSequence)} /><Metric label="State / control" value={`${telemetry.stateVersion ?? "—"} / ${telemetry.controlVersion ?? "—"}`} /><Metric label="Correction" value={telemetry.correction} /><Metric label="Pre-correction drift" value={telemetry.driftPoints === null ? "—" : `${formatDebugNumber(telemetry.driftPoints, 1)} pt`} /></section>
        <section className="mb-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Canonical playback</p><Metric label="Cursor" value={telemetry.cursorPoints === null ? "—" : `${formatDebugNumber(telemetry.cursorPoints, 1)} pt`} /><Metric label="Page / position" value={`${telemetry.currentPage ?? "—"} / ${telemetry.documentPercent === null ? "—" : `${formatDebugNumber(telemetry.documentPercent, 2)}%`}`} /><Metric label="Velocity" value={telemetry.velocityPointsPerSecond === null ? "—" : `${formatDebugNumber(telemetry.velocityPointsPerSecond, 1)} pt/s`} /><Metric label="Playing" value={telemetry.playing === null ? "—" : telemetry.playing ? "yes" : "no"} /><Metric label="Revision" value={telemetry.revision?.slice(0, 12) ?? "—"} /></section>
        {admin && <section><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Server process</p><Metric label="Sockets / viewers" value={serverMetrics ? `${serverMetrics.activeSockets} / ${serverMetrics.connectedClients}` : "—"} /><Metric label="Socket events" value={serverMetrics ? `${serverMetrics.socket.eventsPerSec}/s` : "—"} /><Metric label="Broadcasts" value={serverMetrics ? String(serverMetrics.socket.sessionStateBroadcasts) : "—"} /><Metric label="HTTP avg / 5xx" value={serverMetrics ? `${serverMetrics.http.avgLatencyMs} ms / ${serverMetrics.http.errors5xx}` : "—"} /><Metric label="Memory / uptime" value={serverMetrics ? `${serverMetrics.memory.rssMb} MB / ${serverMetrics.uptimeSec}s` : "—"} /></section>}
      </div>}
    </aside>
  );
}
