'use client';

import { useEffect, useState } from 'react';
import { Youtube, ShieldCheck, Unlink, CheckCircle2, Info } from 'lucide-react';
import { Button, Card, CardHeader, Spinner, ErrorState } from '@/components/ui';
import { useToast } from '@/components/providers';
import { api, ApiClientError } from '@/lib/api-client';

interface Status {
  configured: boolean;
  connected: boolean;
  channel: { channelId: string; channelName: string; channelThumbnail: string | null } | null;
}

export default function YouTubePage() {
  const { push } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<Status>('/api/youtube')
      .then(setStatus)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));

  useEffect(() => { void load(); }, []);

  async function disconnect() {
    if (!confirm('Disconnect your YouTube channel? You will need to reconnect to publish.')) return;
    try {
      await api.delete('/api/youtube');
      setStatus((s) => (s ? { ...s, connected: false, channel: null } : s));
      push({ title: 'YouTube disconnected', variant: 'success' });
    } catch (err) {
      push({ title: 'Disconnect failed', description: (err as Error).message, variant: 'error' });
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (!status) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-white">YouTube</h1>
        <p className="mt-1.5 text-sm text-ink-400">Optional channel connection for publishing.</p>
      </header>

      <Card>
        <CardHeader
          title="Channel connection"
          action={
            status.connected
              ? <span className="chip border-mint/40 text-mint"><CheckCircle2 size={12} />Connected</span>
              : <span className="chip">Not connected</span>
          }
        />

        {!status.configured && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5">
            <Info size={16} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-semibold text-amber-200">YouTube publishing is not configured on this server.</p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-300">
                The server administrator needs to set <code className="text-accent-soft">YOUTUBE_CLIENT_ID</code>,{' '}
                <code className="text-accent-soft">YOUTUBE_CLIENT_SECRET</code> and{' '}
                <code className="text-accent-soft">YOUTUBE_REDIRECT_URI</code>. Everything else —
                generation, preview and MP4 download — works without it.
              </p>
            </div>
          </div>
        )}

        {status.connected && status.channel ? (
          <div className="flex flex-wrap items-center gap-4">
            {status.channel.channelThumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={status.channel.channelThumbnail}
                alt=""
                className="h-14 w-14 rounded-full border border-ink-700"
              />
            ) : (
              <span className="grid h-14 w-14 place-items-center rounded-full bg-ember/15 text-ember">
                <Youtube size={24} aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">{status.channel.channelName}</p>
              <p className="mt-0.5 font-mono text-[11px] text-ink-500">Channel ID: {status.channel.channelId}</p>
            </div>
            <Button variant="danger" size="sm" onClick={disconnect} icon={<Unlink size={14} />}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div>
            <p className="text-sm leading-relaxed text-ink-300">
              Connect a channel to publish finished shorts. ShortForge uses YouTube OAuth and never asks
              for your YouTube password. Access tokens are encrypted at rest and can be revoked at any
              time by disconnecting here.
            </p>
            {status.configured ? (
              <a href="/api/youtube/connect" className="btn-primary mt-5 w-full sm:w-auto">
                <Youtube size={16} aria-hidden="true" />
                Connect YouTube channel
              </a>
            ) : (
              <Button className="mt-5 w-full sm:w-auto" disabled>
                Connect YouTube channel
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Publishing safety" action={<ShieldCheck size={16} className="text-mint" />} />
        <ul className="space-y-2.5 text-sm text-ink-300">
          <li className="flex items-start gap-2.5">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-mint" aria-hidden="true" />
            Nothing is ever published automatically. Every upload requires an explicit confirmation.
          </li>
          <li className="flex items-start gap-2.5">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-mint" aria-hidden="true" />
            The default visibility is <strong className="text-ink-100">Private</strong>. Going public is
            always a deliberate choice, and going public shows an extra warning.
          </li>
          <li className="flex items-start gap-2.5">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-mint" aria-hidden="true" />
            The confirmation dialog shows the exact channel, title, description and visibility before
            the upload starts.
          </li>
          <li className="flex items-start gap-2.5">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-mint" aria-hidden="true" />
            Research sources stay attached to the project so you can verify claims before publishing.
          </li>
        </ul>
        <p className="mt-4 text-[11px] leading-relaxed text-ink-500">
          Note: the YouTube Data API does not support server-side scheduled publishing, so a scheduled
          upload must be triggered while the app is running. Verify current platform requirements for
          upload limits and Shorts duration limits before publishing at scale.
        </p>
      </Card>
    </div>
  );
}
