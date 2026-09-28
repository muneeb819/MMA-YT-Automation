import { desc, eq, sql, gte, and } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  generationJobs,
  projectVersions,
  projects,
  providerHealth,
  requestLogs,
  sessions,
  usage,
  users,
  videoAssets,
  youtubeConnections,
} from '@/db/schema';
import { requireAdmin } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { getMetrics, setProviderEnabled } from '@/lib/logging';
import { queueHealth } from '@/lib/queue';
import { enqueueJob } from '@/lib/queue';
import { log } from '@/lib/logging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin — system overview for administrators. */
export const GET = route(async () => {
  await requireAdmin();
  const db = await getDb();
  const since24 = new Date(Date.now() - 24 * 3600 * 1000);

  const [userCount] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  const [projectCount] = await db.select({ n: sql<number>`count(*)::int` }).from(projects);
  const [videoCount] = await db.select({ n: sql<number>`count(*)::int` }).from(videoAssets);
  const [publishedCount] = await db
    .select({ n: sql<number>`count(*) filter (where ${projects.publishedVideoId} is not null)::int` })
    .from(projects);
  const [failedCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(generationJobs)
    .where(eq(generationJobs.status, 'FAILED'));
  const [sessionCount] = await db.select({ n: sql<number>`count(*)::int` }).from(sessions);
  const [ytCount] = await db.select({ n: sql<number>`count(*)::int` }).from(youtubeConnections);

  const [cost] = await db
    .select({ usd: sql<number>`coalesce(sum(estimated_cost_usd), 0)::float` })
    .from(requestLogs)
    .where(gte(requestLogs.createdAt, since24));

  const recentFailures = await db
    .select({
      id: generationJobs.publicId,
      projectId: generationJobs.projectId,
      type: generationJobs.type,
      error: generationJobs.error,
      attempts: generationJobs.attempts,
      createdAt: generationJobs.createdAt,
    })
    .from(generationJobs)
    .where(eq(generationJobs.status, 'FAILED'))
    .orderBy(desc(generationJobs.id))
    .limit(20);

  const recentLogs = await db
    .select({
      id: requestLogs.id,
      operation: requestLogs.operation,
      provider: requestLogs.provider,
      status: requestLogs.status,
      durationMs: requestLogs.durationMs,
      error: requestLogs.error,
      createdAt: requestLogs.createdAt,
    })
    .from(requestLogs)
    .orderBy(desc(requestLogs.id))
    .limit(40);

  const providers = await db.select().from(providerHealth);
  const metrics = await getMetrics();
  const queue = await queueHealth();

  // Top users by credit consumption.
  const topUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      credits: users.credits,
      spent: sql<number>`coalesce((select sum(abs(credits)) from usage where usage.user_id = users.id), 0)::int`,
    })
    .from(users)
    .orderBy(desc(sql`coalesce((select sum(abs(credits)) from usage where usage.user_id = users.id), 0)`))
    .limit(10);

  return ok({
    totals: {
      users: Number(userCount?.n ?? 0),
      projects: Number(projectCount?.n ?? 0),
      videos: Number(videoCount?.n ?? 0),
      published: Number(publishedCount?.n ?? 0),
      failedJobs: Number(failedCount?.n ?? 0),
      activeSessions: Number(sessionCount?.n ?? 0),
      youtubeConnections: Number(ytCount?.n ?? 0),
    },
    cost: { last24hUsd: Number(cost?.usd ?? 0) },
    queue,
    providers,
    metrics,
    recentFailures,
    recentLogs,
    topUsers,
  });
}, { route: 'GET /api/admin' });

const providerBody = (provider: string, enabled: boolean) => ({ provider, enabled });

/** POST /api/admin — toggle a provider or retry a failed job. */
export const POST = route(async (request: Request) => {
  await requireAdmin();
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    provider?: string;
    enabled?: boolean;
    jobId?: string;
  };

  if (body.action === 'toggle-provider' && body.provider && typeof body.enabled === 'boolean') {
    await setProviderEnabled(body.provider, body.enabled);
    log.info('admin.provider_toggled', { provider: body.provider, enabled: body.enabled });
    return ok({ provider: body.provider, enabled: body.enabled });
  }

  if (body.action === 'retry-job' && body.jobId) {
    const db = await getDb();
    const [job] = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.publicId, body.jobId))
      .limit(1);
    if (!job) return fail('Job not found.', 404, 'NOT_FOUND');

    await db
      .update(generationJobs)
      .set({ status: 'QUEUED', cancelRequested: false, error: null, completedAt: null, updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id));
    await db
      .update(projects)
      .set({ status: 'QUEUED', updatedAt: new Date() })
      .where(eq(projects.id, job.projectId));

    const { runJob } = await import('@/jobs/handlers');
    await enqueueJob(
      {
        jobId: job.id,
        publicId: job.publicId,
        type: job.type,
        projectId: job.projectId,
        userId: job.userId,
        options: (job.payload ?? {}) as Record<string, unknown>,
      },
      runJob,
    );
    return ok({ jobId: body.jobId, status: 'QUEUED' }, { status: 202 });
  }

  return fail('Unsupported admin action.', 400, 'VALIDATION');
}, { route: 'POST /api/admin' });
