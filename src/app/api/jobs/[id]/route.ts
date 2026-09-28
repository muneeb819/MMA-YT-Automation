import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { generationJobs, jobEvents, projects } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { PIPELINE_STAGES } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/jobs/:id — current status, progress and stage timeline. */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const db = await getDb();
  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.publicId, id))
    .limit(1);

  // Ownership check: a job for another user is reported as not found.
  if (!job || job.userId !== user.id) {
    return fail('Job not found.', 404, 'NOT_FOUND');
  }

  const [project] = await db
    .select({ id: projects.id, status: projects.status, title: projects.title })
    .from(projects)
    .where(eq(projects.id, job.projectId))
    .limit(1);

  const events = await db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, job.id))
    .orderBy(jobEvents.id);

  const currentIndex = PIPELINE_STAGES.findIndex((s) => s.key === job.stage);
  const stages = PIPELINE_STAGES.map((stage, i) => ({
    key: stage.key,
    label: stage.label,
    state:
      job.status === 'COMPLETED' || i < currentIndex
        ? 'done'
        : i === currentIndex && (job.status === 'RUNNING' || job.status === 'QUEUED')
          ? 'active'
          : 'pending',
  }));

  return ok({
    job: {
      id: job.publicId,
      type: job.type,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      stageDetail: job.stageDetail,
      error: job.error,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      cancelRequested: job.cancelRequested,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
    project,
    stages,
    events: events.slice(-40),
  });
}, { route: 'GET /api/jobs/:id' });

/** POST /api/jobs/:id/cancel — cooperative cancellation. */
export const POST = route(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const db = await getDb();
  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.publicId, id))
    .limit(1);

  if (!job || job.userId !== user.id) {
    return fail('Job not found.', 404, 'NOT_FOUND');
  }

  if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
    return fail(`This job already finished with status ${job.status}.`, 409, 'CONFLICT');
  }

  await db
    .update(generationJobs)
    .set({ cancelRequested: true, updatedAt: new Date() })
    .where(eq(generationJobs.id, job.id));

  // A queued job that has not started can be cancelled immediately.
  if (job.status === 'QUEUED') {
    await db
      .update(generationJobs)
      .set({ status: 'CANCELLED', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id));
    await db
      .update(projects)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(eq(projects.id, job.projectId));
  }

  return ok({ jobId: id, cancelRequested: true });
}, { route: 'POST /api/jobs/:id/cancel' });
