/**
 * Structured logging + observability.
 *
 * One line of JSON per event so logs are greppable and shippable. Secrets are
 * redacted before anything is written. Detailed errors stay server-side; the UI
 * only ever receives the `publicMessage`.
 */
import { getDb } from '@/db';
import { requestLogs, providerHealth } from '@/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';

const REDACT_KEYS = [
  'apikey',
  'api_key',
  'authorization',
  'token',
  'secret',
  'password',
  'clientsecret',
  'refresh_token',
  'access_token',
  'cookie',
  'encryptedaccesstoken',
  'encryptedrefreshtoken',
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase().replace(/[^a-z]/g, '');
      if (REDACT_KEYS.some((needle) => lower.includes(needle.replace(/[^a-z]/g, '')))) {
        out[k] = '[redacted]';
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  job_id?: string;
  user_id?: string;
  project_id?: number;
  operation?: string;
  provider?: string;
  status?: string | number;
  duration_ms?: number;
  error?: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(redact(fields) as Record<string, unknown>),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (m: string, f?: LogFields) => write('debug', m, f),
  info: (m: string, f?: LogFields) => write('info', m, f),
  warn: (m: string, f?: LogFields) => write('warn', m, f),
  error: (m: string, f?: LogFields) => write('error', m, f),
};

/** Errors thrown by providers carry a safe, user-facing message. */
export interface PublicError {
  status: number;
  publicMessage: string;
  detail: string;
}

export function toPublicError(err: unknown): PublicError {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; statusCode?: number; status?: number; name?: string };
    const status = e.statusCode ?? e.status ?? 500;
    const name = e.name ?? 'Error';

    if (name === 'UnauthorizedError') return { status: 401, publicMessage: e.message ?? 'Not signed in.', detail: '' };
    if (name === 'ForbiddenError') return { status: 403, publicMessage: e.message ?? 'Not permitted.', detail: '' };
    if (name === 'InsufficientCreditsError') return { status: 402, publicMessage: e.message ?? 'Insufficient credits.', detail: '' };

    // Provider errors are already written to be user-safe by the providers.
    if (name === 'ProviderError') {
      return { status: e.statusCode ?? 502, publicMessage: e.message ?? 'A provider request failed.', detail: '' };
    }
    if (typeof status === 'number' && status < 500 && e.message) {
      return { status, publicMessage: e.message, detail: '' };
    }
  }

  return {
    status: 500,
    publicMessage: 'Something went wrong on our side. The issue has been logged.',
    detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
  };
}

/** Persist a provider-call record for the admin observability view. */
export async function recordRequest(fields: {
  userId?: string | null;
  projectId?: number | null;
  jobPublicId?: string | null;
  operation: string;
  provider?: string | null;
  status: string;
  durationMs: number;
  error?: string | null;
}): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(requestLogs).values({
      userId: fields.userId ?? null,
      projectId: fields.projectId ?? null,
      jobPublicId: fields.jobPublicId ?? null,
      operation: fields.operation,
      provider: fields.provider ?? null,
      status: fields.status,
      durationMs: Math.round(fields.durationMs),
      error: fields.error ? fields.error.slice(0, 1000) : null,
    });
  } catch {
    // Never let observability failures break the request path.
  }
}

/** Track per-provider health for the admin panel and circuit-breaking. */
export async function recordProviderStatus(
  provider: string,
  ok: boolean,
  detail?: string,
): Promise<void> {
  try {
    const db = await getDb();
    const existing = await db
      .select()
      .from(providerHealth)
      .where(eq(providerHealth.provider, provider))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(providerHealth).values({
        provider,
        status: ok ? 'healthy' : 'unhealthy',
        lastCheckedAt: new Date(),
        lastError: detail?.slice(0, 500) ?? null,
        failureCount: ok ? 0 : 1,
      });
      return;
    }

    await db
      .update(providerHealth)
      .set({
        status: ok ? 'healthy' : 'unhealthy',
        lastCheckedAt: new Date(),
        lastError: ok ? null : (detail?.slice(0, 500) ?? null),
        failureCount: ok ? 0 : existing[0].failureCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(providerHealth.provider, provider));
  } catch {
    // Non-fatal.
  }
}

/** Is a provider administratively disabled? */
export async function isProviderEnabled(provider: string): Promise<boolean> {
  try {
    const db = await getDb();
    const [row] = await db
      .select({ enabled: providerHealth.enabled })
      .from(providerHealth)
      .where(eq(providerHealth.provider, provider))
      .limit(1);
    return row?.enabled ?? true;
  } catch {
    return true;
  }
}

export async function setProviderEnabled(provider: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  const existing = await db
    .select({ provider: providerHealth.provider })
    .from(providerHealth)
    .where(eq(providerHealth.provider, provider))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(providerHealth).values({ provider, enabled });
  } else {
    await db
      .update(providerHealth)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(providerHealth.provider, provider));
  }
}

export interface GenerationMetrics {
  avgScriptSeconds: number;
  avgRenderSeconds: number;
  avgVideoDuration: number;
  failedPercentage: number;
  totalJobs: number;
  providerFailures: { provider: string; count: number }[];
}

/** Aggregate generation metrics for the admin/analytics views. */
export async function getMetrics(sinceHours = 168): Promise<GenerationMetrics> {
  const db = await getDb();
  const since = new Date(Date.now() - sinceHours * 3600 * 1000);

  const [jobTotals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where status = 'FAILED')::int`,
    })
    .from(requestLogs)
    .where(gte(requestLogs.createdAt, since));

  const ops = await db
    .select({ operation: requestLogs.operation, avgMs: sql<number>`avg(${requestLogs.durationMs})::float` })
    .from(requestLogs)
    .where(gte(requestLogs.createdAt, since))
    .groupBy(requestLogs.operation);

  const providerFailures = await db
    .select({
      provider: requestLogs.provider,
      count: sql<number>`count(*)::int`,
    })
    .from(requestLogs)
    .where(and(gte(requestLogs.createdAt, since), eq(requestLogs.status, 'failed')))
    .groupBy(requestLogs.provider);

  const byOp = new Map(ops.map((o) => [o.operation, Number(o.avgMs ?? 0)]));
  const total = Number(jobTotals?.total ?? 0);
  const failed = Number(jobTotals?.failed ?? 0);

  return {
    avgScriptSeconds: Math.round((byOp.get('script') ?? 0) / 100) / 10,
    avgRenderSeconds: Math.round((byOp.get('render') ?? 0) / 100) / 10,
    avgVideoDuration: 0,
    failedPercentage: total > 0 ? Math.round((failed / total) * 1000) / 10 : 0,
    totalJobs: total,
    providerFailures: providerFailures
      .filter((p) => p.provider)
      .map((p) => ({ provider: String(p.provider), count: Number(p.count) })),
  };
}
