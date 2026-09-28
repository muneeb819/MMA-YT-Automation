import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { generationJobs, projects } from '@/db/schema';
import { requireUser, requireProject } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { enqueueJob } from '@/lib/queue';
import { randomJobId } from '@/lib/security';
import { log } from '@/lib/logging';
import { checkPoliticalNeutrality, checkSafety } from '@/lib/templates';
import { registerGenerationHandler, type GenerationJobType } from '@/jobs/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  skipResearch: z.boolean().optional(),
  type: z.enum(['FULL_PIPELINE', 'SCRIPT', 'VOICE', 'CAPTIONS', 'RENDER']).default('FULL_PIPELINE'),
});

/**
 * POST /api/projects/:id/generate
 *
 * Creates a job row and returns immediately. The long-running work happens in
 * the queue worker, so the HTTP request never blocks on rendering.
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const projectId = Number(id);
  const project = await requireProject(projectId, user.id);

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Invalid input.', 400, 'VALIDATION');
  }
  const { skipResearch, type } = parsed.data;

  // Content safety runs before any generation cost is incurred.
  const safety = checkSafety(project.topic, 'generation');
  if (!safety.allowed) {
    return fail(safety.reason ?? 'This request cannot be generated.', 422, 'CONTENT_SAFETY');
  }
  const neutrality = checkPoliticalNeutrality(project.topic);
  if (!neutrality.allowed) {
    return fail(neutrality.reason ?? 'This request cannot be generated.', 422, 'CONTENT_SAFETY');
  }

  const db = await getDb();

  // Refuse to stack duplicate concurrent jobs for the same project.
  const [active] = await db
    .select({ id: generationJobs.id, publicId: generationJobs.publicId })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.projectId, projectId),
        eq(generationJobs.status, 'QUEUED'),
      ),
    )
    .limit(1);
  if (active) {
    return ok(
      { jobId: active.publicId, projectId, status: 'QUEUED', alreadyQueued: true },
      { status: 202 },
    );
  }

  const [running] = await db
    .select({ id: generationJobs.id, publicId: generationJobs.publicId })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.projectId, projectId),
        eq(generationJobs.status, 'RUNNING'),
      ),
    )
    .limit(1);
  if (running) {
    return ok(
      { jobId: running.publicId, projectId, status: 'RUNNING', alreadyRunning: true },
      { status: 202 },
    );
  }

  const publicId = randomJobId();
  const [job] = await db
    .insert(generationJobs)
    .values({
      publicId,
      projectId,
      userId: user.id,
      type: type as GenerationJobType,
      status: 'QUEUED',
      stage: 'QUEUED',
      progress: 0,
      payload: { skipResearch: !!skipResearch },
    })
    .returning();

  await db
    .update(projects)
    .set({ status: 'QUEUED', updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  // Register the handler for this runtime, then enqueue.
  registerGenerationHandler();

  await enqueueJob(
    {
      jobId: job.id,
      publicId,
      type,
      projectId,
      userId: user.id,
      options: { skipResearch: !!skipResearch },
    },
    async (payload) => {
      const { runJob } = await import('@/jobs/handlers');
      await runJob(payload);
    },
  );

  log.info('job.dispatched', { job_id: publicId, project_id: projectId, user_id: user.id, type });

  return ok(
    { jobId: publicId, projectId, status: 'QUEUED', projectStatus: 'QUEUED' },
    { status: 202 },
  );
}, { route: 'POST /api/projects/:id/generate' });
