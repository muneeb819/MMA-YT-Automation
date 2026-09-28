/**
 * Job queue.
 *
 * Long-running work (LLM calls, TTS, FFmpeg) must never run inside a request.
 * The queue contract is identical for both drivers:
 *   - BullMQ + Redis when REDIS_URL is set (production, multi-instance)
 *   - an in-process async driver otherwise (local dev / single instance)
 *
 * Retries use exponential backoff with a hard attempt ceiling so a failing job
 * cannot loop forever.
 */
import { getDb } from '@/db';
import { generationJobs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { log, recordRequest } from './logging';
import { config } from './config';

export interface JobPayload {
  jobId: number;
  publicId: string;
  type: string;
  projectId: number;
  userId: string;
  options: Record<string, unknown>;
}

export type JobHandler = (payload: JobPayload) => Promise<void>;

const QUEUE_NAME = 'shortforge-generation';

/** In-process driver state. */
interface LocalJob {
  payload: JobPayload;
  attempts: number;
  run: () => Promise<void>;
  timer?: NodeJS.Timeout;
  cancelled: boolean;
}

const localQueue: LocalJob[] = [];
const localHandlers = new Map<string, JobHandler>();
let draining = false;
let bullQueue: import('bullmq').Queue | null = null;
let bullWorker: import('bullmq').Worker | null = null;

/** Exponential backoff: 1s, 4s, 9s … capped at 30s. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * attempt ** 2);
}

export async function enqueueJob(
  payload: JobPayload,
  handler: JobHandler,
  opts: { maxAttempts?: number } = {},
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 3;

  if (config.queue.isRedis) {
    const { Queue } = await import('bullmq');
    const { getRedisConnection } = await import('./redis');
    if (!bullQueue) {
      bullQueue = new Queue(QUEUE_NAME, {
        connection: getRedisConnection(),
        defaultJobOptions: {
          attempts: maxAttempts,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 500 },
        },
      });
    }
    await bullQueue.add(payload.type, payload, { jobId: payload.publicId });
    log.info('job.enqueued', { job_id: payload.publicId, driver: 'bullmq' });
    return;
  }

  const job: LocalJob = {
    payload,
    attempts: 0,
    cancelled: false,
    run: async () => {
      job.attempts += 1;
      const started = Date.now();
      const db = await getDb();
      await db
        .update(generationJobs)
        .set({ status: 'RUNNING', attempts: job.attempts, startedAt: new Date() })
        .where(eq(generationJobs.id, payload.jobId));

      try {
        await handler(payload);
        await db
          .update(generationJobs)
          .set({ status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() })
          .where(eq(generationJobs.id, payload.jobId));
        await recordRequest({
          userId: payload.userId,
          projectId: payload.projectId,
          jobPublicId: payload.publicId,
          operation: payload.type,
          provider: 'pipeline',
          status: 'ok',
          durationMs: Date.now() - started,
        });
        log.info('job.completed', {
          job_id: payload.publicId,
          project_id: payload.projectId,
          duration_ms: Date.now() - started,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const retryable = (err as { retryable?: boolean }).retryable === true;

        if (retryable && job.attempts < maxAttempts) {
          await db
            .update(generationJobs)
            .set({ status: 'QUEUED', error: message.slice(0, 500), updatedAt: new Date() })
            .where(eq(generationJobs.id, payload.jobId));
          log.warn('job.retry_scheduled', {
            job_id: payload.publicId,
            attempt: job.attempts,
            error: message,
          });
          const delay = backoffMs(job.attempts);
          setTimeout(() => void drainLocal(), delay);
          return;
        }

        await db
          .update(generationJobs)
          .set({
            status: 'FAILED',
            error: message.slice(0, 500),
            errorDetail: err instanceof Error ? (err.stack ?? '').slice(0, 4000) : null,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(generationJobs.id, payload.jobId));
        await recordRequest({
          userId: payload.userId,
          projectId: payload.projectId,
          jobPublicId: payload.publicId,
          operation: payload.type,
          provider: 'pipeline',
          status: 'failed',
          durationMs: Date.now() - started,
          error: message,
        });
        log.error('job.failed', {
          job_id: payload.publicId,
          project_id: payload.projectId,
          attempt: job.attempts,
          error: message,
        });
      }
    },
  };

  localQueue.push(job);
  log.info('job.enqueued', { job_id: payload.publicId, driver: 'in-process' });
  setImmediate(() => void drainLocal());
}

/** Serial drain: keeps memory predictable and honours ordering per project. */
async function drainLocal(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (localQueue.length > 0) {
      const job = localQueue.shift();
      if (!job || job.cancelled) continue;
      try {
        await job.run();
      } catch (err) {
        log.error('job.driver_error', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    draining = false;
  }
}

export function registerLocalHandler(type: string, handler: JobHandler): void {
  localHandlers.set(type, handler);
}

export function getLocalHandler(type: string): JobHandler | undefined {
  return localHandlers.get(type);
}

/** Start a BullMQ worker (called from the standalone worker process). */
export async function startBullWorker(handlers: Map<string, JobHandler>): Promise<void> {
  if (!config.queue.isRedis) {
    log.info('worker.mode', { driver: 'in-process' });
    return;
  }
  const { Worker } = await import('bullmq');
  const { getRedisConnection } = await import('./redis');
  bullWorker = new Worker(
    QUEUE_NAME,
    async (queueJob) => {
      const payload = queueJob.data as JobPayload;
      const handler = handlers.get(payload.type);
      if (!handler) throw new Error(`No handler registered for job type "${payload.type}".`);
      await handler(payload);
    },
    { connection: getRedisConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
  );
  bullWorker.on('failed', (job, err) => {
    log.error('job.bullmq_failed', { job_id: job?.id, error: err.message });
  });
  log.info('worker.mode', { driver: 'bullmq' });
}

export async function queueHealth(): Promise<{ status: string; driver: string; depth: number }> {
  if (config.queue.isRedis && bullQueue) {
    try {
      const counts = await bullQueue.getJobCounts('waiting', 'active', 'failed');
      return {
        status: 'healthy',
        driver: 'bullmq',
        depth: (counts.waiting ?? 0) + (counts.active ?? 0),
      };
    } catch (err) {
      return { status: 'degraded', driver: 'bullmq', depth: 0 };
    }
  }
  return {
    status: 'healthy',
    driver: 'in-process',
    depth: localQueue.length,
  };
}

export async function closeQueue(): Promise<void> {
  await bullQueue?.close();
  await bullWorker?.close();
  bullQueue = null;
  bullWorker = null;
}
