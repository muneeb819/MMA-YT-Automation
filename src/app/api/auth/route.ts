import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { userSettings, users } from '@/db/schema';
import { config } from '@/lib/config';
import { fail, ok, route } from '@/lib/api';
import {
  createSession,
  destroySession,
  hashPassword,
  requireUser,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyPassword,
} from '@/lib/auth';
import { log } from '@/lib/logging';
import { rateLimit } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email address.').max(254),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
  name: z.string().min(1).max(120).optional(),
});

function newUserId(): string {
  return `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** POST /api/auth — sign up (creates the account on first call). */
export const POST = route(async (request: Request) => {
  const rl = rateLimit(`auth:${request.headers.get('x-forwarded-for') ?? 'local'}`, 10, 60_000);
  if (!rl.allowed) {
    return fail('Too many sign-in attempts. Please wait a minute and try again.', 429, 'RATE_LIMITED');
  }

  const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Invalid input.', 400, 'VALIDATION');
  }

  const { email, password, name } = parsed.data;
  const db = await getDb();
  const normalisedEmail = email.trim().toLowerCase();

  const [existing] = await db.select().from(users).where(eq(users.email, normalisedEmail)).limit(1);

  if (existing) {
    // Existing account: verify the password rather than silently creating one.
    if (!verifyPassword(password, existing.passwordHash)) {
      return fail('Incorrect email or password.', 401, 'INVALID_CREDENTIALS');
    }
    const { token, expiresAt } = await createSession(existing.id);
    const res = ok({ user: publicUser(existing) });
    res.cookies.set({ ...sessionCookieOptions(expiresAt), name: SESSION_COOKIE, value: token });
    log.info('auth.signin', { user_id: existing.id });
    return res;
  }

  const id = newUserId();
  const [user] = await db
    .insert(users)
    .values({
      id,
      email: normalisedEmail,
      name: name?.trim() || normalisedEmail.split('@')[0],
      passwordHash: hashPassword(password),
      credits: 100,
    })
    .returning();

  await db.insert(userSettings).values({ userId: id }).onConflictDoNothing();

  const { token, expiresAt } = await createSession(id);
  const res = ok({ user: publicUser(user) });
  res.cookies.set({ ...sessionCookieOptions(expiresAt), name: SESSION_COOKIE, value: token });
  log.info('auth.signup', { user_id: id });
  return res;
}, { route: 'POST /api/auth' });

/** DELETE /api/auth — sign out. */
export const DELETE = route(async () => {
  const user = await requireUser();
  await destroySession(user.id);
  const res = ok({ signedOut: true });
  res.cookies.set({ ...sessionCookieOptions(Date.now()), name: SESSION_COOKIE, value: '' });
  return res;
}, { route: 'DELETE /api/auth' });

/**
 * POST /api/auth/demo — one-click demo sign-in.
 * Refuses to run in production so it can never be a backdoor.
 */
export const PUT = route(async () => {
  if (!config.auth.demoLogin || config.isProd) {
    return fail(
      'Demo sign-in is disabled. Create an account with your email and password instead.',
      403,
      'DEMO_DISABLED',
    );
  }

  const db = await getDb();
  const email = 'demo@shortforge.ai';
  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) {
    const id = newUserId();
    [user] = await db
      .insert(users)
      .values({
        id,
        email,
        name: 'Demo Creator',
        passwordHash: hashPassword(crypto.randomUUID()),
        credits: 250,
        onboarded: true,
      })
      .returning();
    await db.insert(userSettings).values({ userId: id }).onConflictDoNothing();
  }

  const { token, expiresAt } = await createSession(user.id);
  const res = ok({ user: publicUser(user) });
  res.cookies.set({ ...sessionCookieOptions(expiresAt), name: SESSION_COOKIE, value: token });
  log.info('auth.demo_signin', { user_id: user.id });
  return res;
}, { route: 'PUT /api/auth/demo' });

/** Never expose password hashes or provider keys. */
function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    credits: user.credits,
    onboarded: user.onboarded,
    createdAt: user.createdAt,
  };
}
