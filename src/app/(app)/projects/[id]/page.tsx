'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Download, FileText, Film, Music, RefreshCw, Save, Sparkles, Trash2, Video,
  AlertTriangle, ExternalLink, Type, ListVideo, CheckCircle2, Globe,
} from 'lucide-react';
import {
  Button, Card, CardHeader, DemoBadge, EmptyState, ErrorState, Spinner, StatusBadge, Textarea, Field, Select,
} from '@/components/ui';
import { ProgressTracker } from '@/components/progress-tracker';
import { PublishDialog } from '@/components/publish-dialog';
import { useToast, useDebounced } from '@/components/providers';
import { api, ApiClientError } from '@/lib/api-client';
import { CAPTION_STYLE_LABELS, MUSIC_STYLE_LABELS, VISUAL_STYLE_LABELS } from '@/lib/domain';
import { PRESET_LABELS } from '@/lib/domain';

interface Scene {
  id: number; sceneNumber: number; narration: string; visualPrompt: string;
  visualUrl: string | null; visualType: string; duration: number; startTime: number;
  caption: string; transition: string; status: string; sourceType: string; licenseNote: string | null;
}
interface Detail {
  project: {
    id: number; title: string; topic: string; category: string; status: string;
    targetDuration: number; actualDuration: number; visualStyle: string; captionStyle: string;
    musicStyle: string; musicVolume: number; voiceName: string | null; preset: string;
    qualityMode: string; publishedVideoId: string | null; thumbnailUrl: string | null; createdAt: string;
  };
  script: { id: number; hook: string; body: string; cta: string; wordCount: number; estimatedDuration: number; version: number } | null;
  seo: { title: string; titleVariants: string[]; description: string; hashtags: string[]; tags: string[]; keywords: { primary: string[]; secondary: string[] }; hookScore: { curiosity: number; clarity: number; emotionalPull: number; specificity: number; overall: number } } | null;
  scenes: Scene[];
  audio: { audioUrl: string; duration: number; voiceName: string | null; provider: string } | null;
  video: { videoUrl: string; thumbnailUrl: string | null; duration: number; resolution: string; sizeBytes: number; qcReport: { passed: boolean; failures: string[]; warnings: string[] } | null } | null;
  captions: { srtUrl: string | null; vttUrl: string | null; words: { word: string; start: number; end: number }[] } | null;
  sources: { id: number; fact: string; sourceUrl: string | null; verified: boolean; notes: string | null }[];
  jobs: { id: string; status: string; type: string }[];
  versions: { version: number; label: string | null; createdAt: string }[];
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const projectId = Number(id);
  const searchParams = useSearchParams();
  const { push } = useToast();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(searchParams.get('job'));
  const [busy, setBusy] = useState<string | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [savingScript, setSavingScript] = useState(false);

  // Local edit buffers for autosave.
  const [script, setScript] = useState({ hook: '', body: '', cta: '' });
  const [seo, setSeo] = useState({ title: '', description: '', hashtags: '', tags: '' });

  const load = useCallback(async () => {
    try {
      const data = await api.get<Detail>(`/api/projects/${projectId}`);
      setDetail(data);
      setError(null);
      if (data.script) setScript({ hook: data.script.hook, body: data.script.body, cta: data.script.cta });
      if (data.seo) {
        setSeo({
          title: data.seo.title,
          description: data.seo.description,
          hashtags: data.seo.hashtags.join(', '),
          tags: data.seo.tags.join(', '),
        });
      }
      if (!jobId && data.jobs?.[0]?.id && ['QUEUED', 'RUNNING'].includes(data.jobs[0].status)) {
        setJobId(data.jobs[0].id);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, jobId]);

  useEffect(() => { void load(); }, [load]);

  const debouncedScript = useDebounced(script, 1400);
  const debouncedSeo = useDebounced(seo, 1400);
  const skipNextSave = useRef(true);

  // Autosave — every edit is persisted so a refresh never loses work.
  useEffect(() => {
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    if (!detail?.script) return;
    const t = setTimeout(async () => {
      try {
        setSavingScript(true);
        await api.patch(`/api/projects/${projectId}`, {
          script: { hook: debouncedScript.hook, body: debouncedScript.body, cta: debouncedScript.cta },
        });
      } catch {
        push({ title: 'Autosave failed', description: 'Your edits are still on screen — retry by editing again.', variant: 'error' });
      } finally {
        setSavingScript(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [debouncedScript, detail?.script, projectId, push]);

  useEffect(() => {
    if (!detail?.seo) return;
    const t = setTimeout(() => {
      void api.patch(`/api/projects/${projectId}`, {
        seo: {
          title: debouncedSeo.title,
          description: debouncedSeo.description,
          hashtags: debouncedSeo.hashtags.split(',').map((s) => s.trim()).filter(Boolean),
          tags: debouncedSeo.tags.split(',').map((s) => s.trim()).filter(Boolean),
        },
      }).catch(() => undefined);
    }, 500);
    return () => clearTimeout(t);
  }, [debouncedSeo, detail?.seo, projectId]);

  async function regenerate(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const res = await api.post<{ jobId: string }>(`/api/projects/${projectId}/regenerate`, { action, ...extra });
      setJobId(res.jobId);
      push({ title: `Regenerating ${action}…`, description: 'Progress updates automatically.', variant: 'info' });
    } catch (err) {
      push({ title: 'Regeneration failed to start', description: (err as Error).message, variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function cancelJob() {
    if (!jobId) return;
    await api.post(`/api/jobs/${jobId}/cancel`).catch(() => undefined);
    push({ title: 'Cancellation requested', variant: 'info' });
  }

  async function retryJob() {
    if (!jobId) return;
    const res = await api.post<{ jobId: string }>(`/api/jobs/${jobId}/retry`);
    setJobId(res.jobId);
  }

  async function handleDelete() {
    if (!confirm('Delete this project and all its assets? This cannot be undone.')) return;
    try {
      await api.delete(`/api/projects/${projectId}`);
      push({ title: 'Project deleted', variant: 'success' });
      window.location.href = '/projects';
    } catch (err) {
      push({ title: 'Delete failed', description: (err as Error).message, variant: 'error' });
    }
  }

  if (loading) return <Spinner label="Loading project…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!detail) return null;

  const { project, scenes, video, audio, seo: storedSeo, sources } = detail;
  const qc = video?.qcReport;
  const hasVideo = !!video;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-black tracking-tight text-white">{project.title}</h1>
            <StatusBadge status={project.status} />
          </div>
          <p className="mt-1.5 max-w-3xl text-sm text-ink-400">{project.topic}</p>
          <p className="mt-1 text-xs text-ink-500">
            {PRESET_LABELS[project.preset as keyof typeof PRESET_LABELS] ?? project.preset} ·{' '}
            {project.targetDuration}s target · {VISUAL_STYLE_LABELS[project.visualStyle as keyof typeof VISUAL_STYLE_LABELS] ?? project.visualStyle} ·{' '}
            {CAPTION_STYLE_LABELS[project.captionStyle as keyof typeof CAPTION_STYLE_LABELS] ?? project.captionStyle} ·{' '}
            {project.voiceName ?? 'No voice'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => regenerate('render')} disabled={!!busy} icon={<RefreshCw size={14} />}>
            Re-render
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowPublish(true)} disabled={!hasVideo} icon={<Globe size={14} />}>
            Publish
          </Button>
        </div>
      </header>

      {/* Active job */}
      {jobId && (
        <Card>
          <ProgressTracker
            jobId={jobId}
            onComplete={() => { setJobId(null); void load(); }}
            onCancel={cancelJob}
            onRetry={retryJob}
          />
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        {/* Left column: preview + audio + downloads */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Preview" action={video?.resolution ? <span className="chip">{video.resolution}</span> : null} />
            {hasVideo ? (
              <>
                <video
                  key={video.videoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  poster={video.thumbnailUrl ?? undefined}
                  className="w-full rounded-xl border border-ink-700 bg-black"
                  style={{ aspectRatio: '9 / 16' }}
                  src={video.videoUrl}
                >
                  <track kind="captions" src={detail.captions?.vttUrl ?? ''} srcLang="en" label="English" default />
                </video>
                <p className="mt-2 text-center text-xs text-ink-500">
                  {video.duration.toFixed(1)}s · {(video.sizeBytes / 1024 / 1024).toFixed(1)} MB
                </p>
              </>
            ) : (
              <EmptyState
                icon={<Video size={28} />}
                title="No video yet"
                description="Generate the short to render a 9:16 MP4 with captions and audio."
                action={
                  <Button variant="primary" size="sm" onClick={() => void regenerate('render')} loading={busy === 'render'}>
                    Render now
                  </Button>
                }
              />
            )}
          </Card>

          {audio && (
            <Card>
              <CardHeader title="Voiceover" description={`${audio.voiceName ?? 'Voice'} · ${audio.duration.toFixed(1)}s`} />
              <audio controls preload="none" src={audio.audioUrl} className="w-full">
                <track kind="captions" />
              </audio>
            </Card>
          )}

          <Card>
            <CardHeader title="Export" description="Downloads are generated securely for your account." />
            <div className="grid gap-2">
              {[
                { kind: 'mp4', label: 'Download MP4', icon: <Film size={15} />, disabled: !hasVideo },
                { kind: 'audio', label: 'Download audio', icon: <Music size={15} />, disabled: !audio },
                { kind: 'script', label: 'Download script', icon: <FileText size={15} />, disabled: !detail.script },
                { kind: 'srt', label: 'Download subtitles (.srt)', icon: <Type size={15} />, disabled: !detail.captions?.srtUrl },
                { kind: 'vtt', label: 'Download subtitles (.vtt)', icon: <Type size={15} />, disabled: !detail.captions?.vttUrl },
                { kind: 'json', label: 'Export project (.json)', icon: <Download size={15} />, disabled: false },
              ].map((d) => (
                <a
                  key={d.kind}
                  href={`/api/projects/${projectId}/download?kind=${d.kind}`}
                  aria-disabled={d.disabled}
                  tabIndex={d.disabled ? -1 : undefined}
                  onClick={(e) => d.disabled && e.preventDefault()}
                  className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                    d.disabled
                      ? 'pointer-events-none border-ink-800 text-ink-600'
                      : 'border-ink-700 text-ink-200 hover:border-accent/50 hover:bg-ink-800'
                  }`}
                >
                  {d.icon}
                  {d.label}
                </a>
              ))}
            </div>
          </Card>

          {qc && (
            <Card>
              <CardHeader title="Quality report" />
              <div className={`flex items-center gap-2 text-sm font-semibold ${qc.passed ? 'text-mint' : 'text-ember'}`}>
                {qc.passed ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                {qc.passed ? 'All checks passed' : 'Checks failed'}
              </div>
              <ul className="mt-3 space-y-1.5 text-xs text-ink-400">
                <li>✓ 1080×1920 resolution</li>
                <li>✓ Audio track present</li>
                <li>✓ Duration within tolerance</li>
                <li>✓ Container decodes correctly</li>
                {qc.warnings?.map((w) => (
                  <li key={w} className="text-amber-400">⚠ {w}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Right column: editors */}
        <div className="space-y-5">
          {/* Script editor */}
          <Card>
            <CardHeader
              title="Script"
              description={savingScript ? 'Saving…' : 'Edits save automatically.'}
              action={
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => regenerate('script', { instruction: 'Generate a fresh, more dramatic alternative.' })}
                    loading={busy === 'script'}
                    icon={<RefreshCw size={13} />}
                  >
                    Regenerate
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => regenerate('voice')} loading={busy === 'voice'} icon={<Sparkles size={13} />}>
                    Regenerate voice
                  </Button>
                </div>
              }
            />

            {detail.script ? (
              <div className="space-y-4">
                <Field label="Hook" htmlFor="hook">
                  <Textarea id="hook" rows={2} value={script.hook} onChange={(e) => setScript({ ...script, hook: e.target.value })} />
                </Field>
                <Field
                  label="Narration"
                  htmlFor="body"
                  hint={`${detail.script.wordCount} words · ~${detail.script.estimatedDuration}s at default pacing`}
                >
                  <Textarea id="body" rows={12} value={script.body} onChange={(e) => setScript({ ...script, body: e.target.value })} />
                </Field>
                <Field label="Call to action" htmlFor="cta">
                  <Textarea id="cta" rows={2} value={script.cta} onChange={(e) => setScript({ ...script, cta: e.target.value })} />
                </Field>
              </div>
            ) : (
              <EmptyState
                icon={<FileText size={28} />}
                title="No script yet"
                description="Generate the short to produce a researched, structured script."
                action={
                  <Button variant="primary" size="sm" onClick={() => regenerate('script')} loading={busy === 'script'}>
                    Generate script
                  </Button>
                }
              />
            )}
          </Card>

          {/* SEO editor */}
          <Card>
            <CardHeader title="SEO metadata" description="Edits save automatically." />
            {storedSeo ? (
              <div className="space-y-4">
                <Field label="Title" htmlFor="seo-title" hint={`${seo.title.length}/100 characters`}>
                  <Textarea id="seo-title" rows={2} value={seo.title} onChange={(e) => setSeo({ ...seo, title: e.target.value })} />
                </Field>

                {storedSeo.titleVariants?.length > 0 && (
                  <div>
                    <p className="label">Title variants</p>
                    <ul className="space-y-1.5">
                      {storedSeo.titleVariants.map((t) => (
                        <li key={t} className="rounded-lg border border-ink-700 bg-ink-900/50 px-3 py-2 text-xs text-ink-300">{t}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <Field label="Description" htmlFor="seo-desc">
                  <Textarea id="seo-desc" rows={6} value={seo.description} onChange={(e) => setSeo({ ...seo, description: e.target.value })} />
                </Field>

                <Field label="Hashtags" htmlFor="seo-hashtags" hint="Comma separated, 10–15 recommended.">
                  <Textarea id="seo-hashtags" rows={2} value={seo.hashtags} onChange={(e) => setSeo({ ...seo, hashtags: e.target.value })} />
                </Field>

                <Field label="Tags" htmlFor="seo-tags" hint="Comma separated search tags.">
                  <Textarea id="seo-tags" rows={3} value={seo.tags} onChange={(e) => setSeo({ ...seo, tags: e.target.value })} />
                </Field>

                {storedSeo.hookScore && (
                  <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                      Hook score — craft estimate, not a performance prediction
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {(['curiosity', 'clarity', 'emotionalPull', 'specificity'] as const).map((k) => (
                        <div key={k}>
                          <p className="text-[11px] text-ink-500">{k.replace(/([A-Z])/g, ' $1')}</p>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${storedSeo.hookScore[k]}%` }} />
                          </div>
                          <p className="mt-1 text-xs font-mono text-ink-300">{storedSeo.hookScore[k]}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState icon={<Type size={28} />} title="No SEO metadata yet" description="Generated alongside the script." />
            )}
          </Card>

          {/* Scene timeline */}
          <Card>
            <CardHeader
              title="Scenes"
              description={`${scenes.length} scenes · total ${scenes.reduce((a, s) => a + s.duration, 0).toFixed(1)}s`}
              action={
                <div className="flex gap-2">
                  <Select
                    aria-label="Caption style"
                    className="w-auto py-1.5 text-xs"
                    value={project.captionStyle}
                    onChange={async (e) => {
                      await api.patch(`/api/projects/${projectId}`, { settings: { captionStyle: e.target.value } });
                      push({ title: 'Caption style updated', description: 'Re-render to apply.', variant: 'info' });
                      void load();
                    }}
                  >
                    {Object.entries(CAPTION_STYLE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </Select>
                  <Button size="sm" variant="secondary" onClick={() => regenerate('captions')} loading={busy === 'captions'} icon={<RefreshCw size={13} />}>
                    Recaption
                  </Button>
                </div>
              }
            />

            {scenes.length === 0 ? (
              <EmptyState icon={<ListVideo size={28} />} title="No scenes yet" description="Scenes are planned from the script." />
            ) : (
              <ol className="space-y-3">
                {scenes.map((scene) => (
                  <li key={scene.id} className="rounded-xl border border-ink-700 bg-ink-900/40 p-3.5">
                    <div className="flex gap-3.5">
                      <div className="w-16 shrink-0">
                        {scene.visualUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={scene.visualUrl}
                            alt={`Scene ${scene.sceneNumber} visual`}
                            loading="lazy"
                            className="aspect-[9/16] w-full rounded-lg border border-ink-700 object-cover"
                          />
                        ) : (
                          <div className="grid aspect-[9/16] w-full place-items-center rounded-lg border border-dashed border-ink-700 text-[9px] text-ink-600">
                            no visual
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="chip">Scene {scene.sceneNumber}</span>
                          <span className="chip font-mono">
                            {scene.startTime.toFixed(2)}s → {(scene.startTime + scene.duration).toFixed(2)}s
                          </span>
                          <span className="chip">{scene.duration.toFixed(1)}s</span>
                          <span className="chip">{scene.transition}</span>
                          {scene.sourceType && <span className="chip">{scene.sourceType.replace(/_/g, ' ').toLowerCase()}</span>}
                        </div>

                        <p className="text-sm leading-relaxed text-ink-200">{scene.narration}</p>

                        {scene.caption && (
                          <p className="text-xs text-ink-400">
                            <span className="font-semibold text-ink-300">On-screen:</span> {scene.caption}
                          </p>
                        )}

                        {scene.licenseNote && (
                          <p className="text-[11px] text-ink-500">{scene.licenseNote}</p>
                        )}

                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === `visual-${scene.id}`}
                            onClick={() => regenerate('visual', { sceneId: scene.id })}
                            icon={<RefreshCw size={12} />}
                          >
                            Regenerate visual
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === `scene-${scene.id}`}
                            onClick={() => regenerate('scene', { sceneId: scene.id })}
                            icon={<RefreshCw size={12} />}
                          >
                            Regenerate scene
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {/* Research sources */}
          {sources.length > 0 && (
            <Card>
              <CardHeader
                title="Research sources"
                description="Review these before publishing factual content."
              />
              <ul className="space-y-2">
                {sources.map((s) => (
                  <li key={s.id} className="rounded-xl border border-ink-700 bg-ink-900/40 p-3">
                    <p className="text-sm text-ink-200">{s.fact}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span
                        className={`chip ${s.verified ? 'border-mint/40 text-mint' : 'border-amber-500/40 text-amber-400'}`}
                      >
                        {s.verified ? 'Verified' : 'UNVERIFIED'}
                      </span>
                      {s.sourceUrl && (
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent-soft hover:underline"
                        >
                          Source <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                    {s.notes && <p className="mt-1.5 text-[11px] text-ink-500">{s.notes}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Danger zone */}
          <Card className="border-ember/30">
            <CardHeader title="Danger zone" />
            <Button variant="danger" size="sm" onClick={handleDelete} icon={<Trash2 size={14} />}>
              Delete project
            </Button>
          </Card>
        </div>
      </div>

      {showPublish && (
        <PublishDialog
          projectId={projectId}
          title={seo.title || project.title}
          description={seo.description}
          onClose={() => setShowPublish(false)}
          onPublished={() => { setShowPublish(false); void load(); }}
        />
      )}
    </div>
  );
}
