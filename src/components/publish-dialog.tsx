'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X, Youtube, ExternalLink } from 'lucide-react';
import { Button, Field, Select } from './ui';
import { api, ApiClientError } from '@/lib/api-client';
import { useToast } from './providers';

interface Connection {
  configured: boolean;
  connected: boolean;
  channel: { channelId: string; channelName: string; channelThumbnail: string | null } | null;
}

/**
 * Publish confirmation dialog.
 *
 * Publishing is never one click. The dialog shows the exact channel, visibility,
 * title and description, and the confirm button stays disabled until the user
 * explicitly acknowledges. Visibility defaults to PRIVATE.
 */
export function PublishDialog({
  projectId,
  title,
  description,
  onClose,
  onPublished,
}: {
  projectId: number;
  title: string;
  description: string;
  onClose: () => void;
  onPublished: () => void;
}) {
  const { push } = useToast();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [privacy, setPrivacy] = useState<'PRIVATE' | 'UNLISTED' | 'PUBLIC'>('PRIVATE');
  const [acknowledged, setAcknowledged] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<Connection>('/api/youtube').then(setConnection).catch(() => setConnection(null));
  }, []);

  // Escape closes; focus moves into the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function publish() {
    setPublishing(true);
    try {
      const res = await api.post<{ url: string; privacy: string }>('/api/youtube/publish', {
        projectId,
        privacyStatus: privacy,
        confirmed: true,
      });
      push({
        title: privacy === 'PRIVATE' ? 'Uploaded as private' : 'Published',
        description: privacy === 'PRIVATE' ? 'Find it in YouTube Studio to make it public.' : res.url,
        variant: 'success',
      });
      window.open(res.url, '_blank', 'noopener');
      onPublished();
    } catch (err) {
      push({
        title: 'Publish failed',
        description: err instanceof ApiClientError ? err.message : (err as Error).message,
        variant: 'error',
      });
      setPublishing(false);
    }
  }

  if (!connection) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 p-4 backdrop-blur-sm">
        <div className="panel w-full max-w-lg p-6">
          <div className="flex items-center gap-2 text-sm text-ink-300">
            <Loader2 size={16} className="animate-spin" /> Checking YouTube connection…
          </div>
        </div>
      </div>
    );
  }

  if (!connection.configured) {
    return (
      <ModalShell onClose={onClose}>
        <h2 className="text-lg font-bold text-white">YouTube publishing is not configured</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-300">
          This deployment has no YouTube OAuth credentials, so publishing is unavailable. The
          server administrator needs to set <code className="text-accent-soft">YOUTUBE_CLIENT_ID</code>,{' '}
          <code className="text-accent-soft">YOUTUBE_CLIENT_SECRET</code> and{' '}
          <code className="text-accent-soft">YOUTUBE_REDIRECT_URI</code>.
        </p>
        <p className="mt-3 text-sm text-ink-400">
          Everything else works — you can still download the finished MP4.
        </p>
        <Button className="mt-6" variant="secondary" onClick={onClose}>Close</Button>
      </ModalShell>
    );
  }

  if (!connection.connected) {
    return (
      <ModalShell onClose={onClose}>
        <h2 className="text-lg font-bold text-white">Connect your YouTube channel</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-300">
          ShortForge uses YouTube OAuth. We never ask for — or store — your YouTube password. Access
          tokens are encrypted at rest and you can disconnect at any time.
        </p>
        <a
          href="/api/youtube/connect"
          className="btn-primary mt-6 w-full"
        >
          <Youtube size={16} aria-hidden="true" />
          Connect YouTube channel
        </a>
        <Button className="mt-2 w-full" variant="ghost" onClick={onClose}>Cancel</Button>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Publish to YouTube</h2>
          <p className="mt-1 text-sm text-ink-400">Review every detail before uploading.</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800" aria-label="Close dialog">
          <X size={18} />
        </button>
      </div>

      <div className="mt-5 rounded-xl border border-accent/30 bg-accent/5 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">You are about to publish to</p>
        <p className="mt-1.5 flex items-center gap-2 text-lg font-black text-white">
          <Youtube size={20} className="text-ember" aria-hidden="true" />
          {connection.channel?.channelName}
        </p>
      </div>

      <div className="mt-4 space-y-4">
        <Field label="Title" htmlFor="pub-title">
          <p id="pub-title" className="rounded-xl border border-ink-700 bg-ink-900/60 px-3.5 py-2.5 text-sm text-ink-100">
            {title || '(no title)'}
          </p>
        </Field>

        <Field label="Description" htmlFor="pub-desc">
          <p id="pub-desc" className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-xl border border-ink-700 bg-ink-900/60 px-3.5 py-2.5 text-xs leading-relaxed text-ink-300">
            {description || '(no description)'}
          </p>
        </Field>

        <Field
          label="Visibility"
          htmlFor="pub-privacy"
          hint={privacy === 'PUBLIC' ? 'Anyone can view this video immediately.' : privacy === 'UNLISTED' ? 'Only people with the link can view it.' : 'Only you can view it. Safe default.'}
        >
          <Select id="pub-privacy" value={privacy} onChange={(e) => setPrivacy(e.target.value as typeof privacy)}>
            <option value="PRIVATE">Private — only you</option>
            <option value="UNLISTED">Unlisted — link only</option>
            <option value="PUBLIC">Public — everyone</option>
          </Select>
        </Field>

        {privacy === 'PUBLIC' && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-amber-200">
              This will be visible to everyone the moment the upload finishes. Review the research
              sources first — unverified claims should not be published as fact.
            </p>
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-ink-700 bg-ink-900/50 p-3.5">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#7c5cff]"
          />
          <span className="text-xs leading-relaxed text-ink-300">
            I confirm the channel, title, description and visibility above are correct, and I have
            the right to publish this content.
          </span>
        </label>
      </div>

      <div className="mt-6 flex gap-2">
        <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
        <Button
          variant="primary"
          className="flex-1"
          onClick={publish}
          disabled={!acknowledged || publishing}
          loading={publishing}
        >
          {publishing ? 'Uploading…' : 'Confirm publish'}
        </Button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/85 p-4 backdrop-blur-sm">
      <div
        ref={undefined}
        role="dialog"
        aria-modal="true"
        aria-label="Publish to YouTube"
        tabIndex={-1}
        className="panel my-8 w-full max-w-lg animate-fade-up p-6"
      >
        {children}
      </div>
    </div>
  );
}
