/**
 * Authentication.
 *
 * Session cookies are HMAC-signed and httpOnly. Passwords use scrypt with a
 * per-user salt. This avoids a heavyweight auth dependency while still being
 * secure: no JWT library, no plaintext passwords, constant-time verification.
 */
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { config } from './config';
import { getDb } from '@/db';
import { users, sessions, projects as projectsTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { User } from '@/db/schema';

const SESSION_COOKIE = 'sf_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

// ---------------------------------------------------------------------------
// Signed session cookies
// ---------------------------------------------------------------------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', config.signingSecret).update(payload).digest('base64url');
}

export function createSessionToken(userId: string, expiresAt: number): string {
  const payload = b64url(JSON.stringify({ uid: userId, exp: expiresAt }));
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  // Constant-time compare to avoid leaking the signature.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { uid: string; exp: number };
    if (!data.uid || typeof data.exp !== 'number') return null;
    if (Date.now() > data.exp) return null;
    return data.uid;
  } catch {
    return null;
  }
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const token = createSessionToken(userId, expiresAt);
  const db = await getDb();
  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    expiresAt: new Date(expiresAt),
  });
  return { token, expiresAt };
}

export async function destroySession(userId: string): Promise<void> {
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export function sessionCookieOptions(expiresAt: number) {
  return {
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProd,
    path: '/',
    expires: new Date(expiresAt),
  };
}

export { SESSION_COOKIE };

// ---------------------------------------------------------------------------
// Request-scoped helpers
// ---------------------------------------------------------------------------

/** Resolve the signed-in user, or null. Never throws. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const userId = verifySessionToken(token);
  if (!userId) return null;

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

export class UnauthorizedError extends Error {
  constructor(message = 'You must be signed in.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'You do not have access to this resource.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') throw new ForbiddenError('Administrator access required.');
  return user;
}

/**
 * Load a project and assert ownership.
 *
 * This is the single choke point that prevents cross-tenant data access —
 * every project-scoped route must go through it.
 */
export async function requireProject(projectId: number, userId: string) {
  const db = await getDb();
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) {
    const err = new Error('Project not found.') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  if (project.userId !== userId) {
    // Return the same message as "not found" so we never confirm that another
    // user's project exists.
    const err = new Error('Project not found.') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return project;
}
