/**
 * Database connection.
 *
 * - `DATABASE_URL` set  -> real PostgreSQL via node-postgres.
 * - `DATABASE_URL` unset -> embedded PGlite (genuine PostgreSQL compiled to WASM)
 *   so the app is fully runnable with zero external infrastructure.
 *
 * Both paths speak the same SQL through Drizzle, so schema/migrations are identical.
 */
import { config } from '@/lib/config';
import path from 'node:path';
import * as schema from './schema';

type Db = import('drizzle-orm/pglite').PgliteDatabase<typeof schema> &
  Partial<import('drizzle-orm/node-postgres').NodePgDatabase<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __shortforgeDb?: Promise<Db>;
  __shortforgePglite?: { close: () => Promise<void> };
};

async function createConnection(): Promise<Db> {
  if (config.db.isPglite) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { mkdirSync } = await import('node:fs');
    // PGlite will not create missing parent directories itself.
    const dataDir = path.resolve(process.cwd(), config.db.pgliteDir);
    mkdirSync(path.dirname(dataDir), { recursive: true });
    const client = await PGlite.create(dataDir);
    globalForDb.__shortforgePglite = client as unknown as { close: () => Promise<void> };
    return drizzle(client, { schema }) as unknown as Db;
  }

  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pool = new Pool({
    connectionString: config.db.url,
    max: 10,
    ssl: config.db.url.includes('localhost') || config.db.url.includes('127.0.0.1')
      ? undefined
      : { rejectUnauthorized: false },
  });
  return drizzle(pool, { schema }) as unknown as Db;
}

/**
 * Shared connection promise. PGlite is single-connection, so we deliberately
 * reuse one instance process-wide rather than opening a pool.
 */
export function getDb(): Promise<Db> {
  if (!globalForDb.__shortforgeDb) {
    globalForDb.__shortforgeDb = createConnection();
  }
  return globalForDb.__shortforgeDb;
}

/** Convenience for callers that can await once at module scope. */
export async function db(): Promise<Db> {
  return getDb();
}

export { schema };
export type { Db };
