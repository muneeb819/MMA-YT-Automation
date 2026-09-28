'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Flame, Loader2, ArrowRight, PartyPopper } from 'lucide-react';
import { Button, Card, CardHeader, DemoBadge, Spinner } from '@/components/ui';
import { api } from '@/lib/api-client';
import { VISUAL_STYLES, VISUAL_STYLE_LABELS } from '@/lib/domain';

interface Voice { id: string; name: string; }

const STEPS = ['Welcome', 'AI provider', 'Voice provider', 'Media provider', 'Default voice', 'Visual style', 'YouTube', 'Generate demo short'];

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [health, setHealth] = useState<any>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [visualStyle, setVisualStyle] = useState('cinematic');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((j) => setHealth(j?.data)).catch(() => undefined);
    api.get<{ voices: Voice[] }>('/api/voices').then((r) => {
      setVoices(r.voices);
      if (r.voices[0]) setVoiceId(r.voices[0].id);
    }).catch(() => undefined);
  }, []);

  async function finish() {
    setSaving(true);
    try {
      await api.patch('/api/settings', { defaultVoiceId: voiceId, defaultVisualStyle: visualStyle });
    } catch {
      // Defaults are a convenience; never block the wizard on them.
    } finally {
      setSaving(false);
    }
    router.push('/dashboard');
  }

  async function generateDemo() {
    setGenerating(true);
    try {
      const { project } = await api.post<{ project: { id: number } }>('/api/projects', {
        topic: 'Explain how the Antikythera mechanism was used to predict the movement of the planets.',
        category: 'history',
        scriptStyle: 'documentary',
        targetDuration: 15,
        visualStyle,
        captionStyle: 'bold',
        musicStyle: 'cinematic',
        voiceId,
        qualityMode: 'draft',
      });
      const { jobId } = await api.post<{ jobId: string }>(`/api/projects/${project.id}/generate`, {});
      setDone(true);
      setTimeout(() => router.push(`/projects/${project.id}?job=${jobId}`), 1400);
    } catch {
      setGenerating(false);
    }
  }

  const isDemo = health?.mode === 'demo';

  return (
    <div className="mx-auto max-w-2xl py-6">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-gradient text-white">
          <Flame size={20} aria-hidden="true" />
        </span>
        <div>
          <p className="text-base font-black text-white">ShortForge AI</p>
          {isDemo && <DemoBadge compact />}
        </div>
      </div>

      {/* Progress */}
      <ol className="mb-6 flex items-center gap-1.5" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div
              className={`h-1.5 rounded-full transition-colors ${
                i <= step ? 'bg-accent' : 'bg-ink-800'
              }`}
              aria-current={i === step ? 'step' : undefined}
            />
            <span className="sr-only">{s}</span>
          </li>
        ))}
      </ol>

      <Card>
        {!health ? (
          <Spinner label="Checking system…" />
        ) : step === 0 ? (
          <>
            <h1 className="text-xl font-black text-white">Welcome to ShortForge AI</h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-300">
              This wizard checks which providers are connected. You can run everything in demo mode
              right now — the video pipeline and FFmpeg rendering are real — and connect live providers
              later without changing your workflow.
            </p>
            <Button variant="primary" className="mt-6 w-full" onClick={() => setStep(1)} icon={<ArrowRight size={16} />}>
              Get started
            </Button>
          </>
        ) : step === 1 ? (
          <ProviderStep
            title="AI provider"
            body="OpenAI writes the script, SEO metadata and visual prompts."
            configured={health.components?.openai === 'healthy'}
            detail={health.details?.openai}
            envVar="OPENAI_API_KEY"
            onNext={() => setStep(2)}
          />
        ) : step === 2 ? (
          <ProviderStep
            title="Voice provider"
            body="ElevenLabs synthesises the narration. Without it, a synthetic tone track keeps timing and captions accurate."
            configured={health.components?.elevenlabs === 'healthy'}
            detail={health.details?.elevenlabs}
            envVar="ELEVENLABS_API_KEY"
            onNext={() => setStep(3)}
          />
        ) : step === 3 ? (
          <ProviderStep
            title="Media provider"
            body="Replicate generates scene visuals. Without it, visuals are generated locally with FFmpeg and clearly labelled."
            configured={health.components?.replicate === 'healthy'}
            detail={health.details?.replicate}
            envVar="REPLICATE_API_TOKEN"
            onNext={() => setStep(4)}
          />
        ) : step === 4 ? (
          <>
            <h1 className="text-lg font-bold text-white">Choose a default voice</h1>
            <p className="mt-2 text-sm text-ink-400">You can change this per project at any time.</p>
            <div className="mt-5 space-y-2">
              {voices.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVoiceId(v.id)}
                  className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold transition-all ${
                    voiceId === v.id ? 'border-accent bg-accent/10 text-white' : 'border-ink-700 text-ink-200 hover:border-ink-600'
                  }`}
                >
                  {v.name}
                  {voiceId === v.id && <Check size={15} className="text-accent-soft" aria-hidden="true" />}
                </button>
              ))}
            </div>
            <Button variant="primary" className="mt-6 w-full" onClick={() => setStep(5)}>Continue</Button>
          </>
        ) : step === 5 ? (
          <>
            <h1 className="text-lg font-bold text-white">Choose a visual style</h1>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {VISUAL_STYLES.slice(0, 8).map((s) => (
                <button
                  key={s}
                  onClick={() => setVisualStyle(s)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${
                    visualStyle === s ? 'border-accent bg-accent/10 text-white' : 'border-ink-700 text-ink-200 hover:border-ink-600'
                  }`}
                >
                  {VISUAL_STYLE_LABELS[s]}
                </button>
              ))}
            </div>
            <Button variant="primary" className="mt-6 w-full" onClick={() => setStep(6)}>Continue</Button>
          </>
        ) : step === 6 ? (
          <>
            <h1 className="text-lg font-bold text-white">Connect YouTube (optional)</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-300">
              {health.components?.youtube === 'healthy'
                ? 'YouTube OAuth is configured on this server. You can connect a channel from the YouTube page at any time.'
                : 'YouTube publishing is not configured on this server. Everything else works, and you can download the finished MP4.'}
            </p>
            <p className="mt-3 text-xs text-ink-500">
              We never ask for your YouTube password, and nothing is ever published without your explicit confirmation.
            </p>
            <Button variant="primary" className="mt-6 w-full" onClick={() => setStep(7)}>Continue</Button>
          </>
        ) : done ? (
          <div className="py-8 text-center">
            <PartyPopper size={40} className="mx-auto text-mint" aria-hidden="true" />
            <h1 className="mt-4 text-lg font-bold text-white">Your demo short is generating</h1>
            <p className="mt-2 text-sm text-ink-400">Taking you to the progress view…</p>
            <Loader2 size={18} className="mx-auto mt-4 animate-spin text-accent" aria-hidden="true" />
          </div>
        ) : (
          <>
            <h1 className="text-lg font-bold text-white">Generate a demo short</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-300">
              Create a real 15-second 1080×1920 video now to confirm the whole pipeline works on this
              machine. {isDemo ? 'Content will be synthetic and clearly labelled as demo output.' : ''}
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={finish} loading={saving}>
                Skip for now
              </Button>
              <Button variant="primary" className="flex-1" onClick={generateDemo} loading={generating}>
                Generate demo short
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function ProviderStep({
  title, body, configured, detail, envVar, onNext,
}: {
  title: string; body: string; configured: boolean; detail?: string; envVar: string; onNext: () => void;
}) {
  return (
    <>
      <CardHeader title={title} description={body} />
      <div
        className={`flex items-start gap-2.5 rounded-xl border p-3.5 ${
          configured ? 'border-mint/40 bg-mint/10' : 'border-amber-500/40 bg-amber-500/10'
        }`}
      >
        <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${configured ? 'bg-mint' : 'bg-amber-400'}`} />
        <div>
          <p className={`text-sm font-semibold ${configured ? 'text-mint' : 'text-amber-200'}`}>
            {configured ? 'Connected' : 'Not configured — continuing in demo mode'}
          </p>
          <p className="mt-1 text-xs text-ink-300">{detail ?? 'This provider is not configured.'}</p>
          {!configured && (
            <p className="mt-2 text-[11px] text-ink-500">
              The administrator can set <code className="text-ink-300">{envVar}</code> on the server.
            </p>
          )}
        </div>
      </div>
      <Button variant="primary" className="mt-6 w-full" onClick={onNext}>
        Continue
      </Button>
    </>
  );
}
