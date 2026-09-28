'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Loader2, X, AlertTriangle, RefreshCw, Ban } from 'lucide-react';
import { Button, ProgressBar } from './ui';
import { api, ApiClientError } from '@/lib/api-client';

export interface StageState {
  key: string;
  label: string;
  state: 'done' | 'active' | 'pending';
}

export interface JobSnapshot {
  job: {
    id: string;
    type: string;
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    stage: string;
    progress: number;
    stageDetail: string | null;
    error: string | null;
    attempts: number;
    maxAttempts: number;
    cancelRequested: boolean;
  };
  stages: StageState[];
}

/**
 * Live job progress via polling.
 *
 * Polling is used rather than SSE because the worker runs out-of-process, and
 * polling is resilient to connection drops and serverless deployments where
 * long-lived connections are not available.
 */
export function useJobProgress(jobId: string | null, onComplete?: () => void) {
  const [data, setData] = useState<JobSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const snapshot = await api.get<JobSnapshot>(`/api/jobs/${jobId}`);
        if (!active) return;
        setData(snapshot);
        setError(null);

        const finished = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(snapshot.job.status);
        if (finished) {
          onCompleteRef.current?.();
          return;
        }
        // 1.2s while running, 4s while queued — keeps the UI responsive
        // without hammering the API.
        timer = setTimeout(poll, snapshot.job.status === 'RUNNING' ? 1200 : 4000);
      } catch (err) {
        if (!active) return;
        setError(err instanceof ApiClientError ? err.message : (err as Error).message);
        timer = setTimeout(poll, 5000);
      }
    };

    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  return { data, error };
}

export function ProgressTracker({
  jobId,
  onComplete,
  onCancel,
  onRetry,
}: {
  jobId: string;
  onComplete?: () => void;
  onCancel?: () => Promise<void>;
  onRetry?: () => Promise<void>;
}) {
  const { data, error } = useJobProgress(jobId, onComplete);
  const [busy, setBusy] = useState(false);

  if (error && !data) {
    return (
      <div role="alert" className="rounded-xl border border-ember/40 bg-ember/5 p-4 text-sm text-ember">
        Could not load job status: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-ink-400">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        Connecting to job…
      </div>
    );
  }

  const { job, stages } = data;
  const running = job.status === 'QUEUED' || job.status === 'RUNNING';

  const handleCancel = async () => {
    if (!onCancel) return;
    setBusy(true);
    try {
      await onCancel();
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    if (!onRetry) return;
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div aria-live="polite">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink-100">
            {job.status === 'COMPLETED'
              ? 'Generation complete'
              : job.status === 'FAILED'
                ? 'Generation failed'
                : job.status === 'CANCELLED'
                  ? 'Generation cancelled'
                  : job.status === 'QUEUED'
                    ? 'Queued…'
                    : 'Generating Short…'}
          </p>
          {job.stageDetail && <p className="mt-0.5 text-xs text-ink-400">{job.stageDetail}</p>}
        </div>
        {running && onCancel && (
          <Button variant="ghost" size="sm" onClick={handleCancel} disabled={busy} icon={<Ban size={14} />}>
            Cancel
          </Button>
        )}
        {(job.status === 'FAILED' || job.status === 'CANCELLED') && onRetry && (
          <Button variant="secondary" size="sm" onClick={handleRetry} disabled={busy} icon={<RefreshCw size={14} />}>
            Retry
          </Button>
        )}
      </div>

      <ProgressBar value={job.progress} />

      <ol className="mt-5 space-y-2.5">
        {stages.map((stage) => (
          <li key={stage.key} className="flex items-center gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              {stage.state === 'done' ? (
                <span className="grid h-5 w-5 place-items-center rounded-full bg-mint/20 text-mint">
                  <Check size={12} strokeWidth={3} aria-hidden="true" />
                </span>
              ) : stage.state === 'active' ? (
                <span className="grid h-5 w-5 place-items-center rounded-full bg-accent/20 text-accent-soft">
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                </span>
              ) : (
                <Circle size={16} className="text-ink-600" aria-hidden="true" />
              )}
            </span>
            <span
              className={`text-sm ${
                stage.state === 'done'
                  ? 'text-ink-300'
                  : stage.state === 'active'
                    ? 'font-semibold text-white'
                    : 'text-ink-500'
              }`}
            >
              {stage.label}
            </span>
          </li>
        ))}
      </ol>

      {job.status === 'FAILED' && job.error && (
        <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-xl border border-ember/40 bg-ember/5 p-3.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-ember" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ember">{job.error}</p>
            {job.attempts < job.maxAttempts && (
              <p className="mt-1 text-xs text-ink-400">
                Attempt {job.attempts} of {job.maxAttempts}.
              </p>
            )}
          </div>
        </div>
      )}

      {job.cancelRequested && running && (
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-400">
          <X size={13} aria-hidden="true" />
          Cancellation requested — stopping at the next safe point.
        </p>
      )}
    </div>
  );
}
