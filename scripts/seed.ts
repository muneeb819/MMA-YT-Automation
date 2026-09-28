/**
 * Seed script: creates the schema, seeds system templates, and optionally an
 * admin account for local testing.
 *
 * Usage:
 *   node --import tsx scripts/seed.ts
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=... node --import tsx scripts/seed.ts
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db';
import { migrate } from '../src/db/push';
import { users, userSettings } from '../src/db/schema';
import { ensureSystemTemplates } from '../src/lib/templates';
import { hashPassword } from '../src/lib/auth';

async function main() {
  console.log('[seed] creating schema…');
  await migrate();

  console.log('[seed] seeding system templates…');
  await ensureSystemTemplates();

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12) {
      throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
    }
    const db = await getDb();
    const email = adminEmail.trim().toLowerCase();
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    const id = existing?.id ?? `usr_seed_${Date.now().toString(36)}`;
    if (existing) {
      await db
        .update(users)
        .set({ role: 'ADMIN', passwordHash: hashPassword(adminPassword), updatedAt: new Date() })
        .where(eq(users.id, existing.id));
      console.log(`[seed] updated admin: ${email}`);
    } else {
      await db.insert(users).values({
        id,
        email,
        name: 'Administrator',
        role: 'ADMIN',
        passwordHash: hashPassword(adminPassword),
        credits: 1000,
        onboarded: true,
      });
      console.log(`[seed] created admin: ${email}`);
    }
    await db.insert(userSettings).values({ userId: id }).onConflictDoNothing();
  } else {
    console.log('[seed] no ADMIN_EMAIL/ADMIN_PASSWORD supplied — skipping admin account.');
  }

  const pg = (globalThis as { __shortforgePglite?: { close: () => Promise<void> } }).__shortforgePglite;
  if (pg) await pg.close();
  console.log('[seed] done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
