'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderOpen, Plus, Search, Trash2 } from 'lucide-react';
import {
  Button, Card, EmptyState, ErrorState, Spinner, StatusBadge, Select,
} from '@/components/ui';
import { useToast } from '@/components/providers';
import { api, ApiClientError } from '@/lib/api-client';

interface Project {
  id: number; title: string; topic: string; status: string; category: string;
  targetDuration: number; actualDuration: number; thumbnailUrl: string | null;
  publishedVideoId: string | null; createdAt: string;
}

const STATUSES = ['all', 'COMPLETED', 'QUEUED', 'DRAFT', 'FAILED', 'CANCELLED'];

export default function ProjectsPage() {
  const { push } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ pages: 1, total: 0 });

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ status, page: String(page) });
    if (query) params.set('q', query);

    api
      .get<{ projects: Project[]; pagination: { pages: number; total: number } }>(`/api/projects?${params}`)
      .then((res) => {
        if (!active) return;
        setProjects(res.projects);
        setPagination(res.pagination);
        setError(null);
      })
      .catch((err) => active && setError(err instanceof ApiClientError ? err.message : (err as Error).message))
      .finally(() => active && setLoading(false));

    return () => { active = false; };
  }, [status, page, query]);

  async function remove(id: number) {
    if (!confirm('Delete this project and all of its assets?')) return;
    try {
      await api.delete(`/api/projects/${id}`);
      setProjects((p) => p.filter((x) => x.id !== id));
      push({ title: 'Project deleted', variant: 'success' });
    } catch (err) {
      push({ title: 'Delete failed', description: (err as Error).message, variant: 'error' });
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">Projects</h1>
          <p className="mt-1.5 text-sm text-ink-400">
            {pagination.total} project{pagination.total === 1 ? '' : 's'}
          </p>
        </div>
        <Link href="/create" className="btn-primary"><Plus size={16} />Create Short</Link>
      </header>

      <Card>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search); }}
        >
          <div className="relative min-w-[12rem] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by topic…"
              aria-label="Search projects"
              className="input pl-9"
            />
          </div>
          <label className="min-w-[10rem]">
            <span className="label">Status</span>
            <Select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.toLowerCase()}</option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
      </Card>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={30} />}
          title="No projects found"
          description={query || status !== 'all' ? 'Try a different search or filter.' : 'Create your first short to get started.'}
          action={<Link href="/create" className="btn-primary"><Plus size={15} />Create Short</Link>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.map((p) => (
            <article key={p.id} className="panel panel-hover overflow-hidden">
              <Link href={`/projects/${p.id}`} className="block">
                <div className="relative aspect-[9/16] max-h-52 overflow-hidden bg-ink-800">
                  {p.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-ink-600">No preview</div>
                  )}
                </div>
              </Link>
              <div className="p-3.5">
                <Link href={`/projects/${p.id}`}>
                  <h2 className="line-clamp-2 text-sm font-bold text-ink-100 hover:text-white">{p.title}</h2>
                </Link>
                <p className="mt-1 line-clamp-2 text-xs text-ink-500">{p.topic}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <StatusBadge status={p.status} />
                  <span className="text-[11px] text-ink-500">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => remove(p.id)}
                  className="mt-3 w-full rounded-lg border border-ink-700 py-1.5 text-xs font-semibold text-ink-400 transition-colors hover:border-ember/50 hover:text-ember"
                >
                  <Trash2 size={12} className="mr-1 inline" />Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {pagination.pages > 1 && (
        <nav className="flex items-center justify-center gap-2" aria-label="Pagination">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-xs text-ink-400">Page {page} of {pagination.pages}</span>
          <Button variant="secondary" size="sm" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </nav>
      )}
    </div>
  );
}
