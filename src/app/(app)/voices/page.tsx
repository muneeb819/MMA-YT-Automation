'use client';

import { useEffect, useState } from 'react';
import { AudioLines, Info } from 'lucide-react';
import { Card, CardHeader, DemoBadge, Spinner, ErrorState } from '@/components/ui';
import { api, ApiClientError } from '@/lib/api-client';

interface Voice {
  id: string; name: string; gender: string; accent: string;
  language: string; provider: string; description?: string; previewUrl?: string;
}

export default function VoicesPage() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [configured, setConfigured] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ voices: Voice[]; configured: boolean; message: string | null }>('/api/voices')
      .then((r) => {
        setVoices(r.voices);
        setConfigured(r.configured);
        setMessage(r.message);
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : (err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;

  const grouped = {
    male: voices.filter((v) => v.gender === 'male'),
    female: voices.filter((v) => v.gender === 'female'),
    neutral: voices.filter((v) => v.gender === 'neutral'),
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black tracking-tight text-white">Voices</h1>
          {!configured && <DemoBadge />}
        </div>
        <p className="mt-1.5 text-sm text-ink-400">
          {configured
            ? 'Your ElevenLabs voice library.'
            : 'Demo voices are in use. Connect ElevenLabs to load your own library.'}
        </p>
      </header>

      {message && !configured && (
        <Card className="flex items-start gap-2.5 border-amber-500/30">
          <Info size={16} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
          <p className="text-sm text-ink-300">{message}</p>
        </Card>
      )}

      {!configured && (
        <Card className="border-amber-500/30">
          <p className="text-sm text-ink-300">
            To load real ElevenLabs voices, add <code className="text-accent-soft">ELEVENLABS_API_KEY</code>{' '}
            to the server environment and restart. Voice speed, stability and style are adjustable on
            the Create Short page either way.
          </p>
        </Card>
      )}

      {Object.entries(grouped).map(([gender, list]) =>
        list.length === 0 ? null : (
          <div key={gender}>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-ink-400">
              {gender} ({list.length})
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((v) => (
                <Card key={v.id} className="panel-hover">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent-soft">
                      <AudioLines size={18} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white">{v.name}</p>
                      <p className="mt-0.5 text-xs text-ink-400">
                        {v.accent} · {v.language.toUpperCase()}
                      </p>
                      {v.description && <p className="mt-1 text-[11px] text-ink-500">{v.description}</p>}
                      {v.previewUrl ? (
                        <audio controls preload="none" src={v.previewUrl} className="mt-2.5 w-full">
                          <track kind="captions" />
                        </audio>
                      ) : (
                        <p className="mt-2 text-[10px] uppercase tracking-wider text-ink-600">No preview available</p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
