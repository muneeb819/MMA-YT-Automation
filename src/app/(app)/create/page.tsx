'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, Info, Clock, Coins } from 'lucide-react';
import { Button, Card, Field, Input, OptionGroup, Select, Spinner, Textarea, DemoBadge, type Option } from '@/components/ui';
import { useToast } from '@/components/providers';
import { api, ApiClientError } from '@/lib/api-client';
import {
  CAPTION_STYLES, CAPTION_STYLE_LABELS, CATEGORY_LABELS, CONTENT_CATEGORIES,
  MUSIC_STYLES, MUSIC_STYLE_LABELS, PRESETS, PRESET_LABELS, QUALITY_MODES,
  SCRIPT_STYLES, SCRIPT_STYLE_LABELS, TARGET_DURATIONS, VISUAL_STYLES, VISUAL_STYLE_LABELS,
  type ContentCategory, type Preset, type QualityMode, type ScriptStyle,
} from '@/lib/domain';

interface Voice {
  id: string;
  name: string;
  gender: string;
  accent: string;
  language: string;
  description?: string;
}
interface Template {
  id: number;
  name: string;
  description: string | null;
  beats: string[];
}

const PLACEHOLDER =
  'Explain the topic you want to turn into a YouTube Short...';

const EXAMPLES = [
  "Tell the story of how El Chapo became one of the world's most notorious drug traffickers.",
  'Explain how AI changed photography in under a minute.',
  'Why the Roman Empire fell — the three decisions that broke it.',
  'How a 19-year-old built a billion-dollar company from a dorm room.',
];

const toOptions = <T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): Option[] => values.map((v) => ({ value: v, label: labels[v] }));

export default function CreateShortPage() {
  const router = useRouter();
  const { push } = useToast();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [voiceDemo, setVoiceDemo] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [topic, setTopic] = useState('');
  const [category, setCategory] = useState<ContentCategory>('storytelling');
  const [scriptStyle, setScriptStyle] = useState<ScriptStyle>('documentary');
  const [duration, setDuration] = useState<number>(45);
  const [voiceId, setVoiceId] = useState('');
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [visualStyle, setVisualStyle] = useState('cinematic');
  const [captionStyle, setCaptionStyle] = useState('bold');
  const [musicStyle, setMusicStyle] = useState('cinematic');
  const [musicVolume, setMusicVolume] = useState(0.18);
  const [preset, setPreset] = useState<Preset>('youtube_shorts');
  const [qualityMode, setQualityMode] = useState<QualityMode>('standard');
  const [templateId, setTemplateId] = useState<string>('');

  useEffect(() => {
    let active = true;
    Promise.all([api.get<{ voices: Voice[]; configured: boolean }>('/api/voices'),
                 api.get<{ templates: Template[] }>('/api/templates')])
      .then(([v, t]) => {
        if (!active) return;
        setVoices(v.voices);
        setVoiceDemo(!v.configured);
        if (v.voices[0]) setVoiceId(v.voices[0].id);
        setTemplates(t.templates);
      })
      .catch((err) => push({ title: 'Could not load options', description: (err as Error).message, variant: 'error' }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [push]);

  // Rough live estimate so the user sees cost before committing.
  const estimate = useMemo(() => {
    const scenes = Math.max(3, Math.round(duration / 3.5));
    const images = scenes;
    const video = qualityMode === 'premium' ? Math.ceil(scenes / 2) : 0;
    const credits = 1 + 1 + 2 + images + video * 5 + 2;
    return { scenes, credits, seconds: Math.round(12 + scenes * 4 + duration * 2.4) };
  }, [duration, qualityMode]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (topic.trim().length < 10) next.topic = 'Describe your idea in at least 10 characters.';
    if (topic.length > 2000) next.topic = 'Keep the idea under 2000 characters.';
    if (!voiceId) next.voiceId = 'Choose a voice.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleGenerate() {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const { project } = await api.post<{ project: { id: number } }>('/api/projects', {
        topic: topic.trim(),
        category,
        scriptStyle,
        targetDuration: duration,
        visualStyle,
        captionStyle,
        musicStyle,
        musicVolume,
        voiceId,
        voiceName: voices.find((v) => v.id === voiceId)?.name,
        voiceSpeed,
        preset,
        qualityMode,
        templateId: templateId ? Number(templateId) : undefined,
      });

      // Kick off generation and return immediately — the job runs in the queue.
      const { jobId } = await api.post<{ jobId: string }>(`/api/projects/${project.id}/generate`, {});

      push({
        title: 'Generation started',
        description: `About ${estimate.credits} credits and ${estimate.seconds}s. You can leave this page.`,
        variant: 'success',
      });
      router.push(`/projects/${project.id}?job=${jobId}`);
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : (err as Error).message;
      push({ title: 'Could not start generation', description: message, variant: 'error' });
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner label="Loading options…" />;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-7 animate-fade-up">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black tracking-tight text-white">Create Short</h1>
          {voiceDemo && <DemoBadge />}
        </div>
        <p className="mt-2 max-w-2xl text-sm text-ink-400">
          Describe your idea, choose a style, and the pipeline handles research, script, visuals,
          voiceover, captions, rendering and quality control.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {/* Idea */}
          <Card className="animate-fade-up">
            <Field
              label="Video idea"
              htmlFor="topic"
              required
              error={errors.topic}
              hint="Be specific. Concrete subjects produce stronger hooks than broad topics."
            >
              <Textarea
                id="topic"
                rows={5}
                value={topic}
                maxLength={2000}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={PLACEHOLDER}
                aria-invalid={!!errors.topic}
                aria-describedby={errors.topic ? 'topic-error' : 'topic-hint'}
              />
            </Field>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Try</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setTopic(ex)}
                  className="rounded-lg border border-ink-700 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:border-accent/50 hover:text-ink-100"
                >
                  {ex.split(' ').slice(0, 5).join(' ')}…
                </button>
              ))}
            </div>
          </Card>

          {/* Content setup */}
          <Card className="animate-fade-up space-y-5" style={{ animationDelay: '60ms' }}>
            <OptionGroup
              legend="Content category"
              name="category"
              value={category}
              onChange={(v) => setCategory(v as ContentCategory)}
              options={toOptions(CONTENT_CATEGORIES, CATEGORY_LABELS)}
            />

            <OptionGroup
              legend="Script style"
              name="scriptStyle"
              value={scriptStyle}
              onChange={(v) => setScriptStyle(v as ScriptStyle)}
              options={toOptions(SCRIPT_STYLES, SCRIPT_STYLE_LABELS)}
            />

            <Field label="Target duration" htmlFor="duration" hint="Narration is paced to fit this length.">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="duration-label">
                {TARGET_DURATIONS.map((d) => (
                  <button
                    key={d}
                    role="radio"
                    aria-checked={duration === d}
                    onClick={() => setDuration(d)}
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all ${
                      duration === d
                        ? 'border-accent bg-accent/10 text-white'
                        : 'border-ink-700 bg-ink-900/50 text-ink-300 hover:border-ink-600'
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Template" htmlFor="template" hint="Optional narrative structure.">
              <Select id="template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">No template (default structure)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </Card>

          {/* Voice */}
          <Card className="animate-fade-up space-y-4" style={{ animationDelay: '120ms' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-100">Voice</h2>
              {voiceDemo && <DemoBadge compact />}
            </div>

            <Field label="Voice" htmlFor="voice" required error={errors.voiceId}>
              <Select id="voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {v.gender}, {v.accent}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label={`Voice speed — ${voiceSpeed.toFixed(2)}×`}
              htmlFor="voiceSpeed"
              hint="Higher is faster. Narration timing recalculates to match."
            >
              <input
                id="voiceSpeed"
                type="range"
                min={0.7}
                max={1.3}
                step={0.05}
                value={voiceSpeed}
                onChange={(e) => setVoiceSpeed(Number(e.target.value))}
                className="w-full accent-[#7c5cff]"
              />
            </Field>
          </Card>

          {/* Presentation */}
          <Card className="animate-fade-up space-y-5" style={{ animationDelay: '180ms' }}>
            <OptionGroup
              legend="Visual style"
              name="visualStyle"
              value={visualStyle}
              onChange={setVisualStyle}
              options={toOptions(VISUAL_STYLES, VISUAL_STYLE_LABELS)}
              columns={3}
            />
            <OptionGroup
              legend="Caption style"
              name="captionStyle"
              value={captionStyle}
              onChange={setCaptionStyle}
              options={toOptions(CAPTION_STYLES, CAPTION_STYLE_LABELS)}
              columns={3}
            />
            <OptionGroup
              legend="Background music"
              name="musicStyle"
              value={musicStyle}
              onChange={setMusicStyle}
              options={toOptions(MUSIC_STYLES, MUSIC_STYLE_LABELS)}
              columns={3}
            />
            <Field label={`Music volume — ${Math.round(musicVolume * 100)}%`} htmlFor="musicVolume">
              <input
                id="musicVolume"
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={musicVolume}
                onChange={(e) => setMusicVolume(Number(e.target.value))}
                disabled={musicStyle === 'none'}
                className="w-full accent-[#7c5cff] disabled:opacity-40"
              />
            </Field>
          </Card>

          {/* Output */}
          <Card className="animate-fade-up space-y-5" style={{ animationDelay: '240ms' }}>
            <OptionGroup
              legend="Content preset"
              name="preset"
              value={preset}
              onChange={(v) => setPreset(v as Preset)}
              options={toOptions(PRESETS, PRESET_LABELS)}
            />
            <OptionGroup
              legend="Quality mode"
              name="qualityMode"
              value={qualityMode}
              onChange={(v) => setQualityMode(v as QualityMode)}
              options={[
                { value: 'draft', label: 'Draft', description: 'Fastest and cheapest' },
                { value: 'standard', label: 'Standard', description: 'Normal production' },
                { value: 'premium', label: 'Premium', description: 'Higher-quality visuals and video' },
              ]}
              columns={3}
            />
          </Card>
        </div>

        {/* Sticky summary */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card className="animate-fade-up">
            <h2 className="text-sm font-bold uppercase tracking-wider text-ink-300">Summary</h2>

            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">Duration</dt>
                <dd className="font-semibold text-ink-100">{duration}s</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">Scenes (est.)</dt>
                <dd className="font-semibold text-ink-100">{estimate.scenes}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">Output</dt>
                <dd className="font-semibold text-ink-100">1080×1920 MP4</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">Mode</dt>
                <dd className="font-semibold capitalize text-ink-100">{qualityMode}</dd>
              </div>
            </dl>

            <div className="mt-5 space-y-2 rounded-xl border border-ink-700 bg-ink-900/60 p-3.5">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-200">
                <Coins size={15} className="text-accent" aria-hidden="true" />
                ~{estimate.credits} credits
              </p>
              <p className="flex items-center gap-2 text-xs text-ink-400">
                <Clock size={13} aria-hidden="true" />
                ~{estimate.seconds}s processing
              </p>
              <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                Credits are refunded automatically if generation fails.
              </p>
            </div>

            <Button
              variant="primary"
              size="lg"
              className="mt-5 w-full"
              onClick={handleGenerate}
              disabled={submitting}
              icon={submitting ? undefined : <Sparkles size={17} />}
            >
              {submitting ? (
                <>
                  <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                  Starting…
                </>
              ) : (
                'GENERATE SHORT'
              )}
            </Button>

            <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-500">
              Generation runs in the background. You can navigate away and come back.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
