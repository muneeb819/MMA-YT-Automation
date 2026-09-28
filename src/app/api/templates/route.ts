import { z } from 'zod';
import { asc, eq, isNull, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { templates } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { ensureSystemTemplates } from '@/lib/templates';
import { sanitizeText } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(2, 'Give the template a name.').max(80),
  description: z.string().max(500).optional(),
  beats: z.array(z.string().min(1).max(60)).min(1, 'Add at least one beat.').max(12),
  category: z.string().max(40).default('storytelling'),
  scriptStyle: z.string().max(40).optional(),
});

function slugify(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** GET /api/templates — system templates plus the user's own. */
export const GET = route(async () => {
  const user = await requireUser();
  await ensureSystemTemplates();
  const db = await getDb();

  const rows = await db
    .select()
    .from(templates)
    .where(or(isNull(templates.userId), eq(templates.userId, user.id)))
    .orderBy(asc(templates.id));

  return ok({
    templates: rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      beats: t.beats,
      category: t.category,
      scriptStyle: t.scriptStyle,
      isSystem: t.isSystem,
    })),
  });
}, { route: 'GET /api/templates' });

/** POST /api/templates — create a custom template. */
export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Invalid input.', 400, 'VALIDATION');
  }

  const db = await getDb();
  const [tpl] = await db
    .insert(templates)
    .values({
      userId: user.id,
      slug: slugify(parsed.data.name),
      name: sanitizeText(parsed.data.name, 80),
      description: sanitizeText(parsed.data.description ?? '', 500) || null,
      beats: parsed.data.beats.map((b) => sanitizeText(b, 60)),
      category: parsed.data.category,
      scriptStyle: parsed.data.scriptStyle ?? null,
      isSystem: false,
    })
    .returning();

  return ok({ template: tpl }, { status: 201 });
}, { route: 'POST /api/templates' });
