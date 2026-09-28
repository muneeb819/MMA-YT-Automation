'use client';

import { useEffect, useState } from 'react';
import { Clapperboard, Plus, Trash2, Loader2 } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, Field, Input, Spinner, Textarea, ErrorState } from '@/components/ui';
import { useToast } from '@/components/providers';
import { api, ApiClientError } from '@/lib/api-client';

interface Template {
  id: number; slug: string; name: string; description: string | null;
  beats: string[]; category: string; isSystem: boolean;
}

export default function TemplatesPage() {
  const { push } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [beats, setBeats] = useState('Hook, Context, Turning point, Payoff, CTA');

  useEffect(() => {
    api
      .get<{ templates: Template[] }>('/api/templates')
      .then((r) => setTemplates(r.templates))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : (err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function create() {
    setSaving(true);
    try {
      const beatList = beats.split(',').map((b) => b.trim()).filter(Boolean);
      const res = await api.post<{ template: Template }>('/api/templates', {
        name, description, beats: beatList, category: 'storytelling',
      });
      setTemplates((t) => [...t, res.template]);
      setCreating(false);
      setName(''); setDescription('');
      push({ title: 'Template created', variant: 'success' });
    } catch (err) {
      push({ title: 'Could not create template', description: (err as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this template?')) return;
    try {
      await api.delete(`/api/templates/${id}`);
      setTemplates((t) => t.filter((x) => x.id !== id));
      push({ title: 'Template deleted', variant: 'success' });
    } catch (err) {
      push({ title: 'Delete failed', description: (err as Error).message, variant: 'error' });
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">Templates</h1>
          <p className="mt-1.5 text-sm text-ink-400">Reusable narrative structures for your scripts.</p>
        </div>
        <Button variant="primary" onClick={() => setCreating((c) => !c)} icon={<Plus size={15} />}>
          New template
        </Button>
      </header>

      {creating && (
        <Card>
          <CardHeader title="Create a template" description="Beats guide the AI's narrative structure." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="tpl-name" required>
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Documentary Format" />
            </Field>
            <Field label="Description" htmlFor="tpl-desc">
              <Input id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this structure is for" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Beats" htmlFor="tpl-beats" hint="Comma separated, in narrative order." required>
                <Textarea id="tpl-beats" rows={2} value={beats} onChange={(e) => setBeats(e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={create} loading={saving} disabled={!name.trim()}>Create</Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {templates.length === 0 ? (
        <EmptyState icon={<Clapperboard size={30} />} title="No templates" description="Create one to reuse a narrative structure." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className="panel-hover flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-bold text-white">{t.name}</h2>
                {t.isSystem ? (
                  <span className="chip">Built-in</span>
                ) : (
                  <button
                    onClick={() => remove(t.id)}
                    className="rounded p-1 text-ink-500 hover:text-ember"
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {t.description && <p className="mt-2 text-xs leading-relaxed text-ink-400">{t.description}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.beats.map((b) => (
                  <span key={b} className="chip text-[10px]">{b}</span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
