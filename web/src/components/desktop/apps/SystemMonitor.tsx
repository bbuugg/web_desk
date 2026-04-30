import { useState, useEffect, useRef } from 'react';
import { Activity, Cpu, MemoryStick, HardDrive, Network, Loader2, Server, Trash2 } from 'lucide-react';
import type { AppComponentProps } from '@/types/desktop';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// --- Types matching backend ---
interface SystemStats {
  cpu: { usagePercent: number[]; totalPercent: number; cores: number; modelName: string };
  memory: { total: number; used: number; available: number; usedPercent: number; swapTotal: number; swapUsed: number };
  disk: { path: string; fstype: string; total: number; used: number; free: number; usedPercent: number }[];
  network: { bytesSent: number; bytesRecv: number; packetsSent: number; packetsRecv: number; sendRate: number; recvRate: number };
  host: { hostname: string; os: string; platform: string; kernel: string; arch: string; uptime: number; bootTime: number };
  procs: { pid: number; name: string; cmdline: string; cpuPercent: number; memPercent: number; memRss: number; status: string; user: string }[];
}

interface SystemMonitorMessage {
  id: string;
  type: 'stats' | 'error';
  data?: SystemStats;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function SystemMonitor(_props: AppComponentProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [killTarget, setKillTarget] = useState<{ pid: number; name: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isMobile = useIsMobile();

  const killProcess = (pid: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'kill', pid }));
    }
  };

  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/api/ws/sysmon`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      try {
        const message: SystemMonitorMessage = JSON.parse(event.data);
        if (message.type !== 'stats' || !message.data) {
          return;
        }

        const data = message.data;
        setStats(data);
        setCpuHistory(prev => {
          const next = [...prev, data.cpu.totalPercent];
          return next.length > 60 ? next.slice(-60) : next;
        });
      } catch { /* ignore */ }
    };

    return () => ws.close();
  }, []);

  if (!connected || !stats) {
    return (
      <div className="flex items-center justify-center h-full bg-[#0d1117] text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Connecting...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-gray-200 overflow-auto">
      {/* Host info bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b border-white/5 bg-white/[0.02] text-xs text-gray-400 shrink-0">
        <div className="flex items-center gap-1.5">
          <Server className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-white font-medium">{stats.host.hostname}</span>
        </div>
        <span>{stats.host.platform} {stats.host.kernel}</span>
        <span>{stats.host.arch}</span>
        <span>Up {formatUptime(stats.host.uptime)}</span>
      </div>

      {/* Main grid */}
      <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-3'} gap-3 p-4 shrink-0`}>
        {/* CPU Card */}
        <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">CPU</span>
            <span className="ml-auto text-lg font-bold text-white">{stats.cpu.totalPercent.toFixed(1)}%</span>
          </div>
          <div className="text-[10px] text-gray-500 truncate">{stats.cpu.modelName}</div>
          {/* Mini chart */}
          <MiniChart data={cpuHistory} color="#4ade80" max={100} />
          {/* Per-core bars */}
          <div className="grid grid-cols-4 gap-1">
            {(stats.cpu.usagePercent || []).map((v, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500/70 transition-all duration-500" style={{ width: `${v}%` }} />
                </div>
                <span className="text-[8px] text-gray-600 text-center">{v.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Memory Card */}
        <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <MemoryStick className="w-4 h-4 text-sky-400" />
            <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Memory</span>
            <span className="ml-auto text-lg font-bold text-white">{stats.memory.usedPercent.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>{formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}</span>
          </div>
          <ProgressBar percent={stats.memory.usedPercent} color="bg-sky-500/70" />
          {stats.memory.swapTotal > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] text-gray-500">
                <span>Swap</span>
                <span>{formatBytes(stats.memory.swapUsed)} / {formatBytes(stats.memory.swapTotal)}</span>
              </div>
              <ProgressBar percent={stats.memory.swapTotal > 0 ? (stats.memory.swapUsed / stats.memory.swapTotal) * 100 : 0} color="bg-purple-500/70" />
            </div>
          )}
        </div>

        {/* Network Card */}
        <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Network</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-500">▲ Upload</span>
              <span className="text-sm font-semibold text-emerald-400">{formatBytes(stats.network.sendRate)}/s</span>
              <span className="text-[10px] text-gray-600">Total: {formatBytes(stats.network.bytesSent)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-500">▼ Download</span>
              <span className="text-sm font-semibold text-sky-400">{formatBytes(stats.network.recvRate)}/s</span>
              <span className="text-[10px] text-gray-600">Total: {formatBytes(stats.network.bytesRecv)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Disk usage */}
      <div className="px-4 pb-2 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <HardDrive className="w-4 h-4 text-orange-400" />
          <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Disks</span>
        </div>
        <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
          {(stats.disk || []).map(d => (
            <div key={d.path} className="flex items-center gap-3 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-300 truncate font-mono">{d.path}</span>
                  <span className="text-gray-500 shrink-0 ml-2">{d.usedPercent.toFixed(1)}%</span>
                </div>
                <ProgressBar percent={d.usedPercent} color={d.usedPercent > 90 ? 'bg-red-500/70' : d.usedPercent > 70 ? 'bg-amber-500/70' : 'bg-orange-500/70'} />
                <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                  <span>{formatBytes(d.used)} used</span>
                  <span>{formatBytes(d.free)} free</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Processes table */}
      <div className="px-4 pb-4 shrink-0 flex flex-col max-h-[500px]">
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <Activity className="w-4 h-4 text-violet-400" />
          <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Top Processes</span>
          <span className="text-[10px] text-gray-600 ml-1">({(stats.procs || []).length})</span>
        </div>
        <div className="rounded-lg border border-white/5 overflow-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#0d1117]">
              <tr className="bg-white/5 text-gray-500 uppercase text-[10px]">
                <th className="text-left px-2 py-1.5 w-14">PID</th>
                <th className="text-left px-2 py-1.5 min-w-[120px]">Name</th>
                <th className="text-left px-2 py-1.5 w-20">User</th>
                <th className="text-right px-2 py-1.5 w-16">CPU %</th>
                <th className="text-right px-2 py-1.5 w-16">MEM %</th>
                <th className="text-right px-2 py-1.5 w-20">RSS</th>
                <th className="text-right px-2 py-1.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {(stats.procs || []).map(p => (
                <tr key={p.pid} className="border-t border-white/5 hover:bg-white/[0.03] transition-colors">
                  <td className="px-2 py-1 font-mono text-gray-500">{p.pid}</td>
                  <td className="px-2 py-1 text-gray-300 truncate max-w-[160px]">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-gray-500 truncate" title={p.cmdline}>{p.cmdline}</div>
                  </td>
                  <td className="px-2 py-1 text-gray-500 truncate max-w-[80px]">{p.user}</td>
                  <td className="px-2 py-1 text-right font-mono">
                    <span className={p.cpuPercent > 50 ? 'text-red-400' : p.cpuPercent > 10 ? 'text-amber-400' : 'text-gray-400'}>
                      {p.cpuPercent.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    <span className={p.memPercent > 20 ? 'text-sky-400' : 'text-gray-400'}>
                      {p.memPercent.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-gray-500">{formatBytes(p.memRss)}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setKillTarget({ pid: p.pid, name: p.name });
                      }}
                      className="p-1 rounded hover:bg-red-500/20 text-gray-600 hover:text-red-400 transition-colors"
                      title="Kill process"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AlertDialog open={!!killTarget} onOpenChange={(open) => !open && setKillTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kill Process?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to kill <strong className="text-white">{killTarget?.name}</strong> (PID: {killTarget?.pid})?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (killTarget) killProcess(killTarget.pid);
                setKillTarget(null);
              }}
              className="bg-red-500 hover:bg-red-600 text-white border-none"
            >
              Kill Process
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- Sub-components ---

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

function MiniChart({ data, color, max }: { data: number[]; color: string; max: number }) {
  const width = 200;
  const height = 40;
  const points = data.length;
  if (points < 2) return <div style={{ height }} />;

  const step = width / (60 - 1); // always 60 slots
  const pathParts: string[] = [];

  data.forEach((v, i) => {
    const x = (i + (60 - data.length)) * step;
    const y = height - (v / max) * height;
    pathParts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  });

  const linePath = pathParts.join(' ');
  const lastX = (59) * step;
  const fillPath = `${linePath} L ${lastX.toFixed(1)} ${height} L ${((60 - data.length) * step).toFixed(1)} ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#chartGrad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
