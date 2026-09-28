import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit configuration for schema migrations.
 * The runtime can also target embedded PGlite (no DATABASE_URL), in which case
 * `npm run db:push` applies the idempotent schema directly.
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/shortforge',
  },
  strict: true,
  verbose: true,
} satisfies Config;
