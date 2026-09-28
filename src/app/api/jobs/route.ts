import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { generationJobs } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { ok, route } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/jobs — recent jobs for the signed-in user. */
export const GET = route(async (request: Request) => {
  const user = await requireUser();
  const url = new URL(request.url);
  const limit = Math.min(50, Number(url.searchParams.get('limit') ?? 20));
  const db = await getDb();

  const rows = await db
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
    .limit(limit);

  return ok({ jobs: rows });
}, { route: 'GET /api/jobs' });
