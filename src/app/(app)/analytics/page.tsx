'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Clock, Film, TrendingUp, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, Spinner, ErrorState, StatCard, EmptyState, StatusBadge } from '@/components/ui';
import { api, ApiClientError } from '@/lib/api-client';

interface Metrics {
  avgScriptSeconds: number;
  avgRenderSeconds: number;
  failedPercentage: number;
  totalJobs: number;
  providerFailures: { provider: string; count: number }[];
}

interface Analytics {
  totals: { total: number; completed: number; published: number; processing: number; failed: number; credits: number };
  videos: { count: number; totalSeconds: number; totalBytes: number };
  daily: { day: string; count: number }[];
  recentJobs: { id: string; type: string; status: string; error: string | null; projectId: number }[];
  usage: { operation: string; credits: number; count: number }[];
  metrics: Metrics;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .get<Analytics>('/api/analytics')
        .then((d) => active && setData(d))
        .catch((e) => active && setError((e as Error).message))
        .finally(() => active && setLoading(false));
    void load();
    const t = setInterval(load, 15000);
    return () => { active = false; clearInterval(t); };
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const maxDaily = Math.max(1, ...data.daily.map((d) => d.count));
  const { totals, videos, metrics } = data;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-white">Analytics</h1>
        <p className="mt-1.5 text-sm text-ink-400">Generation volume, timing and reliability.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total shorts" value={totals.total} icon={<Film size={17} />} />
        <StatCard label="Published" value={totals.published} tone="accent" />
        <StatCard label="Avg script time" value={`${metrics.avgScriptSeconds}s`} icon={<Clock size={17} />} hint="Across recent jobs" />
        <StatCard
          label="Failure rate"
          value={`${metrics.failedPercentage}%`}
          tone={metrics.failedPercentage > 20 ? 'danger' : 'success'}
          icon={<AlertTriangle size={17} />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader title="Generation volume" description="Projects created per day (last 7 days)." />
          {data.daily.length === 0 ? (
            <EmptyState title="No activity yet" description="Create a short to start building history." />
          ) : (
            <div className="flex h-48 items-end gap-2" role="img" aria-label="Daily project volume">
              {data.daily.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-xs font-mono text-ink-400">{d.count}</span>
                  <div
                    className="w-full rounded-t-lg bg-accent-gradient transition-all"
                    style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: 6 }}
                  />
                  <span className="text-[10px] text-ink-600">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Library" />
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">Videos</dt><dd className="font-semibold">{videos.count}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Total runtime</dt>
              <dd className="font-semibold">{(videos.totalSeconds / 60).toFixed(1)} min</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Storage</dt>
              <dd className="font-semibold">{(videos.totalBytes / 1024 / 1024).toFixed(1)} MB</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Avg render time</dt>
              <dd className="font-semibold">{metrics.avgRenderSeconds}s</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent jobs" />
          {data.recentJobs.length === 0 ? (
            <p className="text-sm text-ink-500">No jobs yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.recentJobs.map((j) => (
                <li key={j.id} className="flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900/40 px-3 py-2">
                  <StatusBadge status={j.status} />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-400">
                    {j.type.toLowerCase().replace(/_/g, ' ')}
                  </span>
                  <Link href={`/projects/${j.projectId}`} className="text-[11px] text-accent-soft hover:underline">open</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Credit usage" description="Negative values are spend; positive are refunds." />
          {data.usage.length === 0 ? (
            <p className="text-sm text-ink-500">No usage recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.usage.slice(0, 10).map((u) => (
                <li key={u.operation} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-ink-300">{u.operation}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-[11px] text-ink-500">×{u.count}</span>
                    <span className={`font-mono text-xs ${u.credits < 0 ? 'text-ember' : 'text-mint'}`}>
                      {u.credits > 0 ? '+' : ''}{u.credits}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
        <TrendingUp size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        These metrics measure your own generation pipeline (volume, timing, reliability). They are not
        audience or performance analytics.
      </p>
    </div>
  );
}
