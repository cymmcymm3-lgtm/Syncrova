import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cloud,
  Database,
  FileWarning,
  HardDrive,
  Loader2,
  Phone,
  RefreshCw,
  Server,
  ShieldCheck,
  Wifi
} from 'lucide-react';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { RELEASE_VERSION_NAME } from '../generated/releaseInfo';

type StatusCardProps = {
  icon: React.ComponentType<any>;
  title: string;
  status: React.ReactNode;
  helper: React.ReactNode;
  good?: boolean;
};

const StatusCard = ({ icon: Icon, title, status, helper, good = true }: StatusCardProps) => (
  <div className="rounded-[1.2rem] border border-slate-200 bg-white/92 p-4 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
    <div className="flex items-start justify-between gap-3">
      <span className={`grid h-11 w-11 place-items-center rounded-2xl ring-1 ${good ? 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/50' : 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/50'}`}>
        <Icon size={20} />
      </span>
      <span className={`h-2.5 w-2.5 rounded-full ${good ? 'bg-emerald-500' : 'bg-amber-500'}`} />
    </div>
    <p className="mt-4 text-sm font-black text-slate-500 dark:text-slate-400">{title}</p>
    <p className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{status}</p>
    <p className="mt-1 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">{helper}</p>
  </div>
);

export default function AppHealthPage() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deepLoading, setDeepLoading] = useState(false);
  const [probeLoading, setProbeLoading] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    const updateSocket = () => setSocketConnected(socket.connected);
    updateSocket();
    socket.on('connect', updateSocket);
    socket.on('disconnect', updateSocket);
    return () => {
      socket.off('connect', updateSocket);
      socket.off('disconnect', updateSocket);
    };
  }, []);

  const loadHealth = async ({ deep = false, probe = false }: { deep?: boolean; probe?: boolean } = {}) => {
    if (deep) setDeepLoading(true);
    if (probe) setProbeLoading(true);
    if (!deep && !probe) setLoading(true);
    try {
      const params: Record<string, number> = {};
      if (deep) params.deep = 1;
      if (probe) params.probe = 1;
      const res = await api.get('/health', { params });
      setHealth(res.data);
    } catch {
      setHealth(null);
    } finally {
      if (deep) setDeepLoading(false);
      if (probe) setProbeLoading(false);
      if (!deep && !probe) setLoading(false);
    }
  };

  useEffect(() => {
    loadHealth();
  }, []);

  const dbGood = health?.database?.status === 'connected';
  const apiGood = Boolean(health?.ok);
  const turnGood = Boolean(health?.calls?.turnConfigured);
  const liveKitGood = Boolean(health?.calls?.livekitConfigured);
  const callGood = liveKitGood || turnGood;
  const callStatus = liveKitGood ? 'LiveKit ready' : turnGood ? 'TURN ready' : 'Relay missing';
  const callHelper = liveKitGood
    ? `${health?.calls?.livekitWarnings?.[0] || 'Cloud calling enabled'}, mode ${health?.calls?.relayMode || 'livekit'}`
    : turnGood
      ? `${health?.calls?.turnCount || 0} relay URL(s), mode ${health?.calls?.relayMode}`
      : health?.calls?.livekitMissing?.length
        ? `Missing ${health.calls.livekitMissing.join(', ')}`
        : 'Calls may fail across different networks without LiveKit or TURN';
  const media = health?.media;
  const mediaTotals = media?.totals;
  const mediaIssueCount = Number(mediaTotals?.providers?.supabase || 0)
    + Number(mediaTotals?.providers?.local || 0)
    + Number(mediaTotals?.providers?.blank || 0)
    + Number(mediaTotals?.legacy?.supabase || 0)
    + Number(mediaTotals?.legacy?.localhost || 0)
    + Number(mediaTotals?.missing?.path || 0);
  const mediaGood = media?.status === 'ok' && mediaIssueCount === 0 && !media?.r2Samples?.broken?.length;
  const storageProbe = health?.storageProbe;
  const sourceIssues = (media?.sources || [])
    .filter(source => (
      Number(source.providers?.local || 0)
      + Number(source.providers?.supabase || 0)
      + Number(source.providers?.blank || 0)
      + Number(source.legacy?.localhost || 0)
      + Number(source.missing?.path || 0)
    ) > 0)
    .slice(0, 8);

  return (
    <div className="mobile-page app-health-page mx-auto max-w-6xl space-y-4 px-0 py-1 sm:px-6 sm:py-4 lg:px-8">
      <section className="rounded-[1.45rem] border border-slate-200 bg-white/92 p-5 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900/92 dark:shadow-black/25">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">System health</p>
            <h1 className="mt-1 text-3xl font-black text-slate-950 dark:text-white">App Health</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
              Quick diagnostics for API, database, socket, media storage, and call relay readiness.
            </p>
          </div>
          <button onClick={() => loadHealth()} type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#07036f] px-4 py-3 text-sm font-black text-white">
            {loading ? <Loader2 size={17} className="animate-spin" /> : <Activity size={17} />}
            Refresh
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatusCard icon={Server} title="API" status={apiGood ? 'Online' : 'Offline'} helper={health?.api?.nodeEnv ? `Environment: ${health.api.nodeEnv}` : 'Backend did not respond'} good={apiGood} />
        <StatusCard icon={Database} title="Database" status={health?.database?.status || 'Unknown'} helper={`Ready state: ${health?.database?.readyState ?? '-'}`} good={dbGood} />
        <StatusCard icon={Wifi} title="Realtime socket" status={socketConnected ? 'Connected' : health?.socket?.status || 'Disconnected'} helper={`${health?.socket?.connectedClients ?? 0} backend clients, browser ${socketConnected ? 'connected' : 'not connected'}`} good={socketConnected || health?.socket?.status === 'online'} />
        <StatusCard icon={Cloud} title="Storage" status={health?.storage?.provider || 'Unknown'} helper={health?.storage?.status || 'Upload provider unavailable'} good={Boolean(health?.storage)} />
        <StatusCard icon={HardDrive} title="Media records" status={mediaGood ? 'Clean' : `${mediaIssueCount || 0} issue(s)`} helper={media?.status === 'database-unavailable' ? media.message : `${mediaTotals?.withUrl ?? 0} media URLs scanned`} good={mediaGood} />
        <StatusCard icon={FileWarning} title="Legacy media" status={`${mediaTotals?.providers?.local ?? 0} local / ${mediaTotals?.providers?.supabase ?? 0} Supabase`} helper={`${mediaTotals?.legacy?.localhost ?? 0} localhost URL(s), ${mediaTotals?.missing?.path ?? 0} missing path(s)`} good={mediaGood} />
        <StatusCard icon={Phone} title="Calls" status={callStatus} helper={callHelper} good={callGood} />
        <StatusCard icon={Bot} title="AI Assistant" status={health?.assistant?.openAiConfigured ? 'OpenAI ready' : 'Fallback mode'} helper={health?.assistant?.openAiConfigured ? `Model: ${health?.assistant?.model}` : 'Set OPENAI_API_KEY on the backend for ChatGPT-like replies'} good={Boolean(health?.assistant?.openAiConfigured)} />
        <StatusCard icon={ShieldCheck} title="Release updater" status="Ready" helper={health?.app?.releaseUrl || `/releases/syncrova-${RELEASE_VERSION_NAME}.apk`} good />
      </section>

      <section className="rounded-[1.25rem] border border-slate-200 bg-white/92 p-5 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">Media reliability</p>
            <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">Upload and storage audit</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
              Checks whether profile pictures, post images, and videos are stored with stable R2 metadata.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => loadHealth({ deep: true })} type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              {deepLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Deep scan
            </button>
            <button onClick={() => loadHealth({ probe: true })} type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0b57d0] px-3 py-2 text-xs font-black text-white">
              {probeLoading ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />}
              Run R2 probe
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['R2 records', mediaTotals?.providers?.r2 ?? 0],
            ['Local records', mediaTotals?.providers?.local ?? 0],
            ['Supabase records', mediaTotals?.providers?.supabase ?? 0],
            ['Missing metadata', (mediaTotals?.providers?.blank ?? 0) + (mediaTotals?.missing?.path ?? 0)]
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
              <p className="text-xs font-black uppercase text-slate-400">{label}</p>
              <p className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{value}</p>
            </div>
          ))}
        </div>

        {storageProbe && (
          <div className={`mt-4 flex items-start gap-3 rounded-xl border p-3 text-sm font-semibold ${storageProbe.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200'}`}>
            {storageProbe.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
            <span>{storageProbe.ok ? `R2 probe passed: wrote/read/deleted ${storageProbe.bytes || 0} bytes.` : storageProbe.message || 'R2 probe failed.'}</span>
          </div>
        )}

        {media?.r2Samples?.broken?.length > 0 && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/25 dark:text-rose-200">
            {media.r2Samples.broken.length} sampled R2 object(s) are missing. Run the repair scripts before publishing another APK.
          </div>
        )}

        {sourceIssues.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            {sourceIssues.map(source => (
              <div key={source.label} className="grid gap-2 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 last:border-b-0 dark:border-slate-800 dark:text-slate-300 sm:grid-cols-[1fr_auto]">
                <span>{source.label}</span>
                <span className="text-xs font-black uppercase text-slate-400">
                  local {source.providers?.local || 0} · supabase {source.providers?.supabase || 0} · blank {source.providers?.blank || 0}
                </span>
              </div>
            ))}
          </div>
        )}

        {media?.recommendations?.length > 0 && (
          <div className="mt-4 space-y-2">
            {media.recommendations.map(item => (
              <p key={item} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold leading-5 text-blue-900 dark:bg-blue-950/30 dark:text-blue-100">{item}</p>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[1.25rem] border border-blue-100 bg-blue-50/80 p-5 text-sm font-semibold leading-6 text-slate-600 shadow-sm shadow-blue-200/35 dark:border-blue-900/50 dark:bg-blue-950/25 dark:text-slate-300">
        <p className="font-black text-slate-950 dark:text-white">Developer note</p>
        <p className="mt-1">
          This page never exposes secrets. It only confirms whether services are configured and reachable, so it is safe to show while debugging.
        </p>
      </section>
    </div>
  );
}
