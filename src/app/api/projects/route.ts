import { z } from 'zod';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { sanitizeText } from '@/lib/security';
import { assertDurationAllowed } from '@/lib/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().max(200).optional(),
  topic: z.string().min(10, 'Describe your video idea in at least 10 characters.').max(2000),
  category: z.string().max(40).default('storytelling'),
  scriptStyle: z.string().max(40).default('documentary'),
  targetDuration: z.number().int().min(5).max(180).default(45),
  visualStyle: z.string().max(40).default('cinematic'),
  captionStyle: z.string().max(40).default('bold'),
  musicStyle: z.string().max(40).default('cinematic'),
  musicVolume: z.number().min(0).max(1).default(0.18),
  voiceId: z.string().max(120).optional(),
  voiceName: z.string().max(120).optional(),
  voiceSpeed: z.number().min(0.5).max(2).default(1),
  language: z.string().max(10).default('en'),
  preset: z.string().max(40).default('youtube_shorts'),
  templateId: z.number().int().positive().optional(),
  qualityMode: z.enum(['draft', 'standard', 'premium']).default('standard'),
});

/** GET /api/projects — paginated list scoped to the signed-in user. */
export const GET = route(async (request: Request) => {
  const user = await requireUser();
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') ?? 12)));
  const status = url.searchParams.get('status');
  const search = sanitizeText(url.searchParams.get('q') ?? '', 100);

  const db = await getDb();

  const filters = [eq(projects.userId, user.id)];
  if (status && status !== 'all') filters.push(eq(projects.status, status as never));
  if (search) filters.push(ilike(projects.topic, `%${search}%`));

  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      topic: projects.topic,
      category: projects.category,
      status: projects.status,
      targetDuration: projects.targetDuration,
      actualDuration: projects.actualDuration,
      visualStyle: projects.visualStyle,
      captionStyle: projects.captionStyle,
      scriptStyle: projects.scriptStyle,
      voiceName: projects.voiceName,
      preset: projects.preset,
      thumbnailUrl: projects.thumbnailUrl,
      publishedVideoId: projects.publishedVideoId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(and(...filters))
    .orderBy(desc(projects.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(...filters));

  const total = Number(countRow?.total ?? 0);

  return ok({
    projects: rows,
    pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}, { route: 'GET /api/projects' });

/** POST /api/projects — create a draft project. Generation is a separate call. */
export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? 'Invalid input.',
      400,
      'VALIDATION',
      parsed.error.issues,
    );
  }

  const input = parsed.data;
  const topic = sanitizeText(input.topic, 2000);
  if (topic.length < 10) {
    return fail('Describe your video idea in at least 10 characters.', 400, 'VALIDATION');
  }

  try {
    assertDurationAllowed(input.targetDuration);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Invalid duration.', 400, 'VALIDATION');
  }

  const db = await getDb();
  const title = sanitizeText(input.title ?? '', 200) || topic.slice(0, 90);

  const [project] = await db
    .insert(projects)
    .values({
      userId: user.id,
      title,
      topic,
      category: input.category,
      status: 'DRAFT',
      targetDuration: input.targetDuration,
      scriptStyle: input.scriptStyle,
      visualStyle: input.visualStyle,
      captionStyle: input.captionStyle,
      musicStyle: input.musicStyle,
      musicVolume: input.musicVolume,
      voiceId: input.voiceId ?? null,
      voiceName: input.voiceName ?? null,
      voiceSpeed: input.voiceSpeed,
      language: input.language,
      preset: input.preset,
      templateId: input.templateId ?? null,
      qualityMode: input.qualityMode,
    })
    .returning();

  return ok({ project }, { status: 201 });
}, { route: 'POST /api/projects' });
