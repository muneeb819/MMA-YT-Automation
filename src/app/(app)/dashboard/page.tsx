'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderOpen, CheckCircle2, Loader2, AlertTriangle, Coins, Plus, ArrowRight } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, Spinner, StatCard, StatusBadge, ErrorState } from '@/components/ui';
import { api, ApiClientError } from '@/lib/api-client';

interface Analytics {
  totals: { total: number; completed: number; published: number; processing: number; failed: number; credits: number };
  videos: { count: number; totalSeconds: number; totalBytes: number };
  daily: { day: string; count: number }[];
  recentJobs: { id: string; type: string; status: string; progress: number; projectId: number; error: string | null }[];
}

interface Project {
  id: number; title: string; topic: string; status: string;
  targetDuration: number; thumbnailUrl: string | null; createdAt: string;
}

export default function DashboardPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [a, p] = await Promise.all([
          api.get<Analytics>('/api/analytics'),
          api.get<{ projects: Project[] }>('/api/projects?pageSize=6'),
        ]);
        if (!active) return;
        setData(a);
        setProjects(p.projects);
        setError(null);
      } catch (err) {
        if (active) setError(err instanceof ApiClientError ? err.message : (err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, 6000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  if (loading) return <Spinner label="Loading dashboard…" />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!data) return null;

  const { totals } = data;
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.count));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">Dashboard</h1>
          <p className="mt-1.5 text-sm text-ink-400">
            Your shorts at a glance. Generation runs in the background.
          </p>
        </div>
        <Link href="/create" className="btn-primary">
          <Plus size={16} aria-hidden="true" />
          Create Short
        </Link>
      </header>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total shorts" value={totals.total} icon={<FolderOpen size={17} />} />
        <StatCard label="Published" value={totals.published} tone="accent" icon={<CheckCircle2 size={17} />} />
        <StatCard label="Processing" value={totals.processing} tone="muted" icon={<Loader2 size={17} />} />
        <StatCard label="Failed" value={totals.failed} tone={totals.failed > 0 ? 'danger' : 'muted'} icon={<AlertTriangle size={17} />} />
        <StatCard label="Credits" value={totals.credits} tone="success" icon={<Coins size={17} />} hint="Remaining" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        {/* Recent projects */}
        <Card>
          <CardHeader
            title="Recent projects"
            action={<Link href="/projects" className="text-xs font-semibold text-accent-soft hover:underline">View all</Link>}
          />
          {projects.length === 0 ? (
            <EmptyState
              icon={<FolderOpen size={28} />}
              title="No projects yet"
              description="Enter an idea and ShortForge will script it, voice it, caption it and render a 9:16 video."
              action={<Link href="/create" className="btn-primary"><Plus size={15} />Create your first short</Link>}
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="panel panel-hover block overflow-hidden"
                  >
                    <div className="relative aspect-[9/16] max-h-40 overflow-hidden bg-ink-800">
                      {p.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center text-xs text-ink-600">No preview</div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="line-clamp-2 text-sm font-semibold text-ink-100">{p.title}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <StatusBadge status={p.status} />
                        <span className="text-[11px] text-ink-500">{p.targetDuration}s</span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Activity + trend */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Last 7 days" />
            {data.daily.length === 0 ? (
              <p className="text-sm text-ink-500">No activity yet.</p>
            ) : (
              <div className="flex h-32 items-end gap-1.5" role="img" aria-label="Projects created per day">
                {data.daily.map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                    <div
                      className="w-full rounded-t-md bg-accent-gradient transition-all"
                      style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: 4 }}
                      title={`${d.day}: ${d.count}`}
                    />
                    <span className="text-[9px] text-ink-600">{d.day.slice(8)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent jobs" />
            {data.recentJobs.length === 0 ? (
              <p className="text-sm text-ink-500">No jobs yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.recentJobs.slice(0, 6).map((j) => (
                  <li key={j.id} className="flex items-center gap-2.5">
                    <StatusBadge status={j.status} />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-400">
                      {j.type.toLowerCase().replace(/_/g, ' ')}
                    </span>
                    <Link
                      href={`/projects/${j.projectId}`}
                      className="rounded p-1 text-ink-500 hover:text-ink-100"
                      aria-label="Open project"
                    >
                      <ArrowRight size={13} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Library" />
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-400">Videos rendered</dt>
                <dd className="font-semibold">{data.videos.count}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-400">Total runtime</dt>
                <dd className="font-semibold">{Math.round(data.videos.totalSeconds / 60)} min</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-400">Storage used</dt>
                <dd className="font-semibold">{(data.videos.totalBytes / 1024 / 1024).toFixed(0)} MB</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
