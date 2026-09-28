import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { templates } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/templates/:id — only the owner can delete a custom template. */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const templateId = Number(id);

  const db = await getDb();
  const [tpl] = await db.select().from(templates).where(eq(templates.id, templateId)).limit(1);

  // System templates are shared, so they are never deletable.
  if (!tpl || tpl.userId !== user.id) {
    return fail('Template not found.', 404, 'NOT_FOUND');
  }

  await db.delete(templates).where(eq(templates.id, templateId));
  return ok({ deleted: true, id: templateId });
}, { route: 'DELETE /api/templates/:id' });
