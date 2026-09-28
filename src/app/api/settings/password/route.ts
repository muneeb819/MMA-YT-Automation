import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { requireUser, hashPassword, verifyPassword } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { rateLimit } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/settings/password — change the account password. */
export const POST = route(async (request: Request) => {
  const user = await requireUser();

  const rl = rateLimit(`pw:${user.id}`, 5, 15 * 60_000);
  if (!rl.allowed) {
    return fail('Too many password change attempts. Try again later.', 429, 'RATE_LIMITED');
  }

  const body = (await request.json().catch(() => ({}))) as { current?: string; next?: string };
  if (!body.current || !body.next || body.next.length < 8) {
    return fail(
      'Provide your current password and a new password of at least 8 characters.',
      400,
      'VALIDATION',
    );
  }

  const db = await getDb();
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!verifyPassword(body.current, row?.passwordHash)) {
    return fail('Your current password is incorrect.', 401, 'INVALID_CREDENTIALS');
  }

  await db
    .update(users)
    .set({ passwordHash: hashPassword(body.next), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return ok({ changed: true });
}, { route: 'POST /api/settings/password' });
