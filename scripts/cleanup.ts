/**
 * Scheduled cleanup worker.
 *
 * Removes expired temporary files and, when configured, old final assets.
 * Final project assets are never deleted unless ASSET_RETENTION_DAYS is set.
 *
 * Note: the renderer already deletes its own per-job temp directory in a
 * `finally` block, so this job targets leftovers from crashed processes.
 *
 * Run: node --import tsx scripts/cleanup.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { and, eq, lt } from 'drizzle-orm';
import { config } from '../src/lib/config';
import { getStorage } from '../src/providers/registry';
import { log } from '../src/lib/logging';

async function main() {
  const cutoff = Date.now() - config.cleanup.tempAfterHours * 3600 * 1000;
  const tmpRoot = os.tmpdir();
  let removed = 0;

  // 1. Leftover render / QC / image temp directories.
  const entries = await fs.readdir(tmpRoot).catch(() => []);
  for (const name of entries) {
    if (!name.startsWith('shortforge-') && !name.startsWith('sf-')) continue;
    const full = path.join(tmpRoot, name);
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fs.rm(full, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // Another process may have already removed it.
    }
  }

  // 2. Optional retention of finished assets (off by default).
  let assetsRemoved = 0;
  if (config.cleanup.assetRetentionDays > 0) {
    const { getDb } = await import('../src/db');
    const { videoAssets } = await import('../src/db/schema');
    const db = await getDb();
    const storage = getStorage();

    const assetCutoff = new Date(Date.now() - config.cleanup.assetRetentionDays * 86_400_000);
    const stale = await db
      .select({ id: videoAssets.id, projectId: videoAssets.projectId, storageKey: videoAssets.storageKey })
      .from(videoAssets)
      .where(lt(videoAssets.createdAt, assetCutoff))
      .catch(() => []);

    for (const asset of stale) {
      try {
        if (asset.storageKey) await storage.delete(asset.storageKey);
        // Remove only this asset row, never the project itself.
        await db.delete(videoAssets).where(eq(videoAssets.id, asset.id));
        assetsRemoved++;
        log.info('cleanup.asset_removed', { project_id: asset.projectId });
      } catch (err) {
        log.warn('cleanup.asset_remove_failed', {
          project_id: asset.projectId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    void and;
  }

  log.info('cleanup.complete', { temp_dirs_removed: removed, assets_removed: assetsRemoved });
  const pg = (globalThis as { __shortforgePglite?: { close: () => Promise<void> } }).__shortforgePglite;
  if (pg) await pg.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[cleanup] failed:', err);
  process.exit(1);
});
