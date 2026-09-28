import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { generationJobs, projects, scenes } from '@/db/schema';
import { requireUser, requireProject } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { enqueueJob } from '@/lib/queue';
import { randomJobId } from '@/lib/security';
import { log } from '@/lib/logging';
import { snapshotProject } from '@/lib/regenerate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  action: z.enum(['script', 'scene', 'visual', 'voice', 'captions', 'render']),
  sceneId: z.number().int().positive().optional(),
  instruction: z.string().max(500).optional(),
  prompt: z.string().max(2000).optional(),
});

/**
 * POST /api/projects/:id/regenerate
 *
 * Regenerates exactly one stage. Body: { action, sceneId?, instruction?, prompt? }
 * Nothing else in the project is touched unless the action inherently
 * requires it (e.g. regenerating a script must re-plan scenes).
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const projectId = Number(id);
  const project = await requireProject(projectId, user.id);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Invalid input.', 400, 'VALIDATION');
  }
  const { action, sceneId, instruction, prompt } = parsed.data;

  const db = await getDb();

  // A scene action must target a scene that belongs to this project.
  if ((action === 'scene' || action === 'visual') && !sceneId) {
    return fail('A sceneId is required for this action.', 400, 'VALIDATION');
  }
  if (sceneId) {
    const [scene] = await db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1);
    if (!scene || scene.projectId !== projectId) {
      return fail('Scene not found.', 404, 'NOT_FOUND');
    }
  }

  // Destructive actions snapshot first so a version can be restored.
  if (action === 'script' || action === 'render' || action === 'voice') {
    await snapshotProject(projectId, `Before ${action} regeneration`).catch(() => undefined);
  }

  const typeMap: Record<typeof action, string> = {
    script: 'SCRIPT',
    scene: 'SCENES',
    visual: 'VISUAL',
    voice: 'VOICE',
    captions: 'CAPTIONS',
    render: 'RENDER',
  };

  const publicId = randomJobId();
  const options: Record<string, unknown> = {};
  if (sceneId) options.sceneId = sceneId;
  if (instruction) options.instruction = instruction;
  if (prompt) options.prompt = prompt;

  const [job] = await db
    .insert(generationJobs)
    .values({
      publicId,
      projectId,
      userId: user.id,
      type: typeMap[action] as never,
      status: 'QUEUED',
      stage: 'QUEUED',
      payload: { action, ...options },
    })
    .returning();

  // A standalone scene/visual job does not move the project into a pipeline state.
  if (action === 'script') {
    await db.update(projects).set({ status: 'SCRIPTING', updatedAt: new Date() }).where(eq(projects.id, projectId));
  } else if (action === 'voice') {
    await db.update(projects).set({ status: 'GENERATING_VOICE', updatedAt: new Date() }).where(eq(projects.id, projectId));
  } else if (action === 'render') {
    await db.update(projects).set({ status: 'RENDERING', updatedAt: new Date() }).where(eq(projects.id, projectId));
  }

  const { runJob } = await import('@/jobs/handlers');
  await enqueueJob(
    { jobId: job.id, publicId, type: typeMap[action], projectId, userId: user.id, options },
    runJob,
  );

  log.info('regenerate.dispatched', {
    job_id: publicId,
    project_id: projectId,
    user_id: user.id,
    action,
  });

  return ok({ jobId: publicId, projectId, action, status: 'QUEUED' }, { status: 202 });
}, { route: 'POST /api/projects/:id/regenerate' });
