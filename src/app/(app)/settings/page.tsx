'use client';

import { useEffect, useState } from 'react';
import { Check, KeyRound, Palette, Save, Settings2 } from 'lucide-react';
import { Button, Card, CardHeader, Field, Input, Select, Spinner, ErrorState, Textarea, DemoBadge } from '@/components/ui';
import { useToast } from '@/components/providers';
import { api, ApiClientError } from '@/lib/api-client';
import {
  CAPTION_STYLES, CAPTION_STYLE_LABELS, CATEGORY_LABELS, CONTENT_CATEGORIES,
  MUSIC_STYLES, MUSIC_STYLE_LABELS, PRESETS, PRESET_LABELS, QUALITY_MODES,
  VISUAL_STYLES, VISUAL_STYLE_LABELS, TARGET_DURATIONS,
} from '@/lib/domain';

interface Settings {
  userId: string;
  defaultVoiceId: string | null;
  defaultVisualStyle: string;
  defaultCaptionStyle: string;
  defaultDuration: number;
  defaultMusic: string;
  defaultCategory: string;
  defaultLanguage: string;
  defaultPreset: string;
  qualityMode: string;
  brandName: string | null;
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
  brandCta: string | null;
  brandIntro: string | null;
  brandOutro: string | null;
}

interface Voice { id: string; name: string; }

export default function SettingsPage() {
  const { push } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [providers, setProviders] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ settings: Settings | null; providers: Record<string, unknown>; mockMode?: boolean }>('/api/settings'),
      api.get<{ voices: Voice[] }>('/api/voices'),
    ])
      .then(([s, v]) => {
        if (s.settings) setSettings(s.settings);
        setProviders(s.providers);
        setDemoMode(!!s.mockMode);
        setVoices(v.voices);
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : (err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      await api.patch('/api/settings', settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
      push({ title: 'Settings saved', variant: 'success' });
    } catch (err) {
      push({ title: 'Save failed', description: (err as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (!settings) return <ErrorState message="Settings could not be loaded." />;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => (s ? { ...s, [key]: value } : s));

  const providerRows: { key: string; label: string; env: string }[] = [
    { key: 'openai', label: 'OpenAI (script + SEO)', env: 'OPENAI_API_KEY' },
    { key: 'elevenlabs', label: 'ElevenLabs (voice)', env: 'ELEVENLABS_API_KEY' },
    { key: 'replicate', label: 'Replicate (visuals)', env: 'REPLICATE_API_TOKEN' },
    { key: 'creatomate', label: 'Creatomate (managed render)', env: 'CREATOMATE_API_KEY' },
    { key: 'youtube', label: 'YouTube (publishing)', env: 'YOUTUBE_CLIENT_ID / SECRET' },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black tracking-tight text-white">Settings</h1>
            {demoMode && <DemoBadge />}
          </div>
          <p className="mt-1.5 text-sm text-ink-400">Defaults, brand kit and provider status.</p>
        </div>
        <Button variant="primary" onClick={save} loading={saving} icon={saved ? <Check size={15} /> : <Save size={15} />}>
          {saved ? 'Saved' : 'Save changes'}
        </Button>
      </header>

      <Card>
        <CardHeader title="Generation defaults" description="Pre-selected on the Create Short page." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default voice" htmlFor="s-voice">
            <Select id="s-voice" value={settings.defaultVoiceId ?? ''} onChange={(e) => set('defaultVoiceId', e.target.value)}>
              <option value="">No default</option>
              {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </Field>
          <Field label="Default duration" htmlFor="s-dur">
            <Select id="s-dur" value={String(settings.defaultDuration)} onChange={(e) => set('defaultDuration', Number(e.target.value))}>
              {TARGET_DURATIONS.map((d) => <option key={d} value={d}>{d}s</option>)}
            </Select>
          </Field>
          <Field label="Default category" htmlFor="s-cat">
            <Select id="s-cat" value={settings.defaultCategory} onChange={(e) => set('defaultCategory', e.target.value)}>
              {CONTENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </Select>
          </Field>
          <Field label="Default language" htmlFor="s-lang">
            <Input id="s-lang" value={settings.defaultLanguage} onChange={(e) => set('defaultLanguage', e.target.value)} />
          </Field>
          <Field label="Default visual style" htmlFor="s-vs">
            <Select id="s-vs" value={settings.defaultVisualStyle} onChange={(e) => set('defaultVisualStyle', e.target.value)}>
              {VISUAL_STYLES.map((v) => <option key={v} value={v}>{VISUAL_STYLE_LABELS[v]}</option>)}
            </Select>
          </Field>
          <Field label="Default caption style" htmlFor="s-cs">
            <Select id="s-cs" value={settings.defaultCaptionStyle} onChange={(e) => set('defaultCaptionStyle', e.target.value)}>
              {CAPTION_STYLES.map((c) => <option key={c} value={c}>{CAPTION_STYLE_LABELS[c]}</option>)}
            </Select>
          </Field>
          <Field label="Default music" htmlFor="s-music">
            <Select id="s-music" value={settings.defaultMusic} onChange={(e) => set('defaultMusic', e.target.value)}>
              {MUSIC_STYLES.map((m) => <option key={m} value={m}>{MUSIC_STYLE_LABELS[m]}</option>)}
            </Select>
          </Field>
          <Field label="Default preset" htmlFor="s-preset">
            <Select id="s-preset" value={settings.defaultPreset} onChange={(e) => set('defaultPreset', e.target.value)}>
              {PRESETS.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
            </Select>
          </Field>
          <Field label="Quality mode" htmlFor="s-quality">
            <Select id="s-quality" value={settings.qualityMode} onChange={(e) => set('qualityMode', e.target.value)}>
              {QUALITY_MODES.map((q) => <option key={q} value={q}>{q}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Brand kit"
          description="Applied to generated scripts, captions and intros."
          action={<Palette size={16} className="text-ink-500" />}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand name" htmlFor="b-name">
            <Input id="b-name" value={settings.brandName ?? ''} onChange={(e) => set('brandName', e.target.value)} placeholder="Your channel name" />
          </Field>
          <Field label="Primary colour" htmlFor="b-c1">
            <Input id="b-c1" type="color" value={settings.brandPrimaryColor ?? '#7c5cff'} onChange={(e) => set('brandPrimaryColor', e.target.value)} className="h-11 p-1" />
          </Field>
          <Field label="Secondary colour" htmlFor="b-c2">
            <Input id="b-c2" type="color" value={settings.brandSecondaryColor ?? '#1a1030'} onChange={(e) => set('brandSecondaryColor', e.target.value)} className="h-11 p-1" />
          </Field>
          <Field label="Default CTA" htmlFor="b-cta" hint="Used as the closing call to action.">
            <Input id="b-cta" value={settings.brandCta ?? ''} onChange={(e) => set('brandCta', e.target.value)} placeholder="Follow for more deep dives" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Intro line" htmlFor="b-intro">
              <Textarea id="b-intro" rows={2} value={settings.brandIntro ?? ''} onChange={(e) => set('brandIntro', e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Outro line" htmlFor="b-outro">
              <Textarea id="b-outro" rows={2} value={settings.brandOutro ?? ''} onChange={(e) => set('brandOutro', e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Provider configuration"
          description="Read-only status. Secrets are set as server environment variables and are never displayed."
          action={<KeyRound size={16} className="text-ink-500" />}
        />
        <ul className="space-y-2">
          {providerRows.map((p) => {
            const configured = providers[p.key];
            return (
              <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-700 bg-ink-900/50 px-3.5 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-ink-100">{p.label}</p>
                  <p className="text-[11px] text-ink-500">{p.env}</p>
                </div>
                <span className={`chip ${configured ? 'border-mint/40 text-mint' : 'border-ink-600 text-ink-400'}`}>
                  {configured ? 'Connected' : 'Not configured'}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[11px] text-ink-500">
          Storage driver: <span className="text-ink-300">{String(providers.storage ?? 'local')}</span>.
          {providers.userKeysAllowed
            ? ' Per-user API keys are enabled.'
            : ' Per-user API keys are disabled on this deployment.'}
        </p>
      </Card>
    </div>
  );
}
