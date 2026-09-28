'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, DollarSign, RefreshCw, Server, Users, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button, Card, CardHeader, Spinner, ErrorState, StatCard, StatusBadge, EmptyState } from '@/components/ui';
import { useToast } from '@/components/providers';
import { api, ApiClientError } from '@/lib/api-client';

interface AdminData {
  totals: {
    users: number; projects: number; videos: number; published: number;
    failedJobs: number; activeSessions: number; youtubeConnections: number;
  };
  cost: { last24hUsd: number };
  queue: { status: string; driver: string; depth: number };
  providers: { provider: string; enabled: boolean; status: string; failureCount: number; lastError: string | null }[];
  metrics: { failedPercentage: number; totalJobs: number; avgRenderSeconds: number; providerFailures: { provider: string; count: number }[] };
  recentFailures: { id: string; projectId: number; type: string; error: string | null; attempts: number; createdAt: string }[];
  recentLogs: { id: number; operation: string; provider: string | null; status: string; durationMs: number; createdAt: string }[];
  topUsers: { id: string; name: string; email: string; credits: number; spent: number }[];
}

export default function AdminPage() {
  const { push } = useToast();
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    api
      .get<AdminData>('/api/admin')
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));

  useEffect(() => { void load(); }, []);

  async function toggleProvider(provider: string, enabled: boolean) {
    setBusy(provider);
    try {
      await api.post('/api/admin', { action: 'toggle-provider', provider, enabled });
      setData((d) =>
        d ? { ...d, providers: d.providers.map((p) => (p.provider === provider ? { ...p, enabled } : p)) } : d,
      );
      push({ title: `${provider} ${enabled ? 'enabled' : 'disabled'}`, variant: 'success' });
    } catch (err) {
      push({ title: 'Update failed', description: (err as Error).message, variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function retryJob(jobId: string) {
    setBusy(jobId);
    try {
      await api.post('/api/admin', { action: 'retry-job', jobId });
      push({ title: 'Job re-queued', variant: 'success' });
      setTimeout(() => void load(), 2000);
    } catch (err) {
      push({ title: 'Retry failed', description: (err as Error).message, variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-white">Admin</h1>
        <p className="mt-1.5 text-sm text-ink-400">System health, providers, cost and failed jobs.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Users" value={data.totals.users} icon={<Users size={17} />} hint={`${data.totals.activeSessions} active sessions`} />
        <StatCard label="Projects" value={data.totals.projects} hint={`${data.totals.videos} videos rendered`} />
        <StatCard label="Published" value={data.totals.published} tone="accent" hint={`${data.totals.youtubeConnections} channels connected`} />
        <StatCard label="Est. cost (24h)" value={`$${data.cost.last24hUsd.toFixed(2)}`} icon={<DollarSign size={17} />} tone="muted" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="System health"
            action={<span className="chip"><Server size={12} />{data.queue.driver}</span>}
          />
          <dl className="space-y-2.5 text-sm">
            <Row label="Queue" value={`${data.queue.status} · depth ${data.queue.depth}`} />
            <Row label="Failure rate" value={`${data.metrics.failedPercentage}%`} />
            <Row label="Tracked operations" value={String(data.metrics.totalJobs)} />
            <Row label="Avg render time" value={`${data.metrics.avgRenderSeconds}s`} />
            <Row label="Failed jobs (all time)" value={String(data.totals.failedJobs)} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Providers" description="Disable a provider to route around an outage." />
          <ul className="space-y-2">
            {data.providers.length === 0 && <p className="text-sm text-ink-500">No provider health recorded yet.</p>}
            {data.providers.map((p) => (
              <li key={p.provider} className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-900/40 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-100">{p.provider}</p>
                  <p className="text-[11px] text-ink-500">
                    {p.status}{p.failureCount > 0 ? ` · ${p.failureCount} failures` : ''}
                  </p>
                  {p.lastError && <p className="mt-0.5 truncate text-[10px] text-ember">{p.lastError}</p>}
                </div>
                <Button
                  size="sm"
                  variant={p.enabled ? 'secondary' : 'danger'}
                  disabled={busy === p.provider}
                  onClick={() => toggleProvider(p.provider, !p.enabled)}
                  icon={p.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                >
                  {p.enabled ? 'On' : 'Off'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Failed jobs"
          description="Inspect the reason and retry."
          action={<AlertTriangle size={16} className="text-ember" />}
        />
        {data.recentFailures.length === 0 ? (
          <EmptyState title="No failed jobs" description="Everything is healthy." />
        ) : (
          <ul className="space-y-2">
            {data.recentFailures.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-ember/30 bg-ember/5 px-3.5 py-2.5">
                <span className="font-mono text-[11px] text-ink-500">{f.id.slice(0, 16)}…</span>
                <span className="text-xs text-ink-300">project #{f.projectId}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ember">{f.error}</span>
                <span className="text-[11px] text-ink-500">attempt {f.attempts}</span>
                <Button size="sm" variant="secondary" disabled={busy === f.id} onClick={() => retryJob(f.id)} icon={<RefreshCw size={13} />}>
                  Retry
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top users by spend" />
          {data.topUsers.length === 0 ? (
            <p className="text-sm text-ink-500">No usage yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.topUsers.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-100">{u.name}</p>
                    <p className="truncate text-[11px] text-ink-500">{u.email}</p>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-xs text-ember">{u.spent}</span>
                    <span className="text-[10px] text-ink-500">{u.credits} left</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent API calls" action={<Activity size={16} className="text-ink-500" />} />
          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {data.recentLogs.map((l) => (
              <li key={l.id} className="flex items-center gap-2.5 rounded-lg border border-ink-800 bg-ink-900/40 px-2.5 py-1.5 text-[11px]">
                <StatusBadge status={l.status === 'ok' ? 'COMPLETED' : 'FAILED'} />
                <span className="min-w-0 flex-1 truncate text-ink-400">{l.operation}</span>
                <span className="shrink-0 text-ink-600">{l.provider ?? '—'}</span>
                <span className="shrink-0 font-mono text-ink-500">{l.durationMs}ms</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-400">{label}</dt>
      <dd className="font-semibold text-ink-100">{value}</dd>
    </div>
  );
}
