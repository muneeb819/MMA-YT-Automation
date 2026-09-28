import { sql, and, eq, gte, desc, count } from 'drizzle-orm';
import { getDb } from '@/db';
import { generationJobs, projects, usage, users, videoAssets } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { getMetrics } from '@/lib/logging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/analytics — dashboard counters, usage and recent activity. */
export const GET = route(async () => {
  const user = await requireUser();
  const db = await getDb();
  const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${projects.status} = 'COMPLETED')::int`,
      published: sql<number>`count(*) filter (where ${projects.publishedVideoId} is not null)::int`,
      processing: sql<number>`count(*) filter (where ${projects.status} in ('QUEUED','RESEARCHING','SCRIPTING','SEO_GENERATING','SCENE_PLANNING','GENERATING_VISUALS','GENERATING_VOICE','GENERATING_CAPTIONS','ASSEMBLING','RENDERING','QUALITY_CHECK'))::int`,
      failed: sql<number>`count(*) filter (where ${projects.status} = 'FAILED')::int`,
    })
    .from(projects)
    .where(eq(projects.userId, user.id));

  const [creditRow] = await db
    .select({ credits: users.credits })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  // Per-day counts for the trend chart.
  const daily = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${projects.createdAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(projects)
    .where(and(eq(projects.userId, user.id), gte(projects.createdAt, since7)))
    .groupBy(sql`date_trunc('day', ${projects.createdAt})`)
    .orderBy(sql`date_trunc('day', ${projects.createdAt})`);

  const [videoStats] = await db
    .select({
      videos: sql<number>`count(${videoAssets.id})::int`,
      totalSeconds: sql<number>`coalesce(sum(${videoAssets.duration}), 0)::float`,
      totalBytes: sql<number>`coalesce(sum(${videoAssets.sizeBytes}), 0)::float`,
    })
    .from(videoAssets)
    .innerJoin(projects, eq(projects.id, videoAssets.projectId))
    .where(eq(projects.userId, user.id));

  const recentJobs = await db
    .select({
      id: generationJobs.publicId,
      type: generationJobs.type,
      status: generationJobs.status,
      stage: generationJobs.stage,
      progress: generationJobs.progress,
      error: generationJobs.error,
      projectId: generationJobs.projectId,
      createdAt: generationJobs.createdAt,
      completedAt: generationJobs.completedAt,
    })
    .from(generationJobs)
    .where(eq(generationJobs.userId, user.id))
    .orderBy(desc(generationJobs.id))
    .limit(10);

  const usageRows = await db
    .select({
      operation: usage.operation,
      credits: sql<number>`coalesce(sum(${usage.credits}), 0)::int`,
      count: count(usage.id),
    })
    .from(usage)
    .where(eq(usage.userId, user.id))
    .groupBy(usage.operation)
    .orderBy(desc(sql`sum(${usage.credits})`));

  const metrics = await getMetrics();

  return ok({
    totals: {
      total: Number(totals?.total ?? 0),
      completed: Number(totals?.completed ?? 0),
      published: Number(totals?.published ?? 0),
      processing: Number(totals?.processing ?? 0),
      failed: Number(totals?.failed ?? 0),
      credits: creditRow?.credits ?? 0,
    },
    videos: {
      count: Number(videoStats?.videos ?? 0),
      totalSeconds: Math.round(Number(videoStats?.totalSeconds ?? 0)),
      totalBytes: Math.round(Number(videoStats?.totalBytes ?? 0)),
    },
    daily,
    recentJobs,
    usage: usageRows,
    metrics,
  });
}, { route: 'GET /api/analytics' });
