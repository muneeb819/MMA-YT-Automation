import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { generationJobs, projects } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { enqueueJob } from '@/lib/queue';
import { runJob } from '@/jobs/handlers';
import { log } from '@/lib/logging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/jobs/:id/retry — re-queue a failed or cancelled job. */
export const POST = route(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const db = await getDb();

  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.publicId, id))
    .limit(1);

  if (!job || job.userId !== user.id) return fail('Job not found.', 404, 'NOT_FOUND');
  if (job.status !== 'FAILED' && job.status !== 'CANCELLED') {
    return fail('Only failed or cancelled jobs can be retried.', 409, 'CONFLICT');
  }

  await db
    .update(generationJobs)
    .set({
      status: 'QUEUED',
      cancelRequested: false,
      error: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(generationJobs.id, job.id));
  await db
    .update(projects)
    .set({ status: 'QUEUED', updatedAt: new Date() })
    .where(eq(projects.id, job.projectId));

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

  log.info('job.retried', { job_id: job.publicId, user_id: user.id });
  return ok({ jobId: job.publicId, status: 'QUEUED' }, { status: 202 });
}, { route: 'POST /api/jobs/:id/retry' });
