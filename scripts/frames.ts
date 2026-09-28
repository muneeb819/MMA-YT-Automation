/**
 * Visual proof: generate one short, then extract real frames from the rendered
 * MP4 so the output can be inspected as images rather than trusted on metrics.
 *
 * Run: node --import tsx scripts/frames.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db';
import { migrate } from '../src/db/push';
import { users, projects, videoAssets, generationJobs, templates } from '../src/db/schema';
import { runFullPipeline } from '../src/lib/pipeline';
import { getStorage } from '../src/providers/registry';
import { SYSTEM_TEMPLATES } from '../src/lib/templates';

const execFileAsync = promisify(execFile);
const OUT_DIR = path.join(process.cwd(), '.data', 'frames');

async function main() {
  await migrate();
  const db = await getDb();

  for (const tpl of SYSTEM_TEMPLATES) {
    const [existing] = await db.select().from(templates).where(eq(templates.slug, tpl.slug)).limit(1);
    if (!existing) {
      await db.insert(templates).values({
        userId: null, slug: tpl.slug, name: tpl.name, description: tpl.description,
        beats: tpl.beats, category: tpl.category, scriptStyle: tpl.scriptStyle, isSystem: true,
      });
    }
  }
  const [template] = await db.select().from(templates).where(eq(templates.slug, 'viral-fact')).limit(1);

  const userId = `usr_frames_${Date.now()}`;
  await db.insert(users).values({
    id: userId, email: `frames-${Date.now()}@shortforge.test`, name: 'Frames', credits: 100,
  });

  const [project] = await db.insert(projects).values({
    userId,
    title: 'How AI changed photography',
    topic: 'Explain how artificial intelligence changed the way photographers edit and shoot photos.',
    category: 'technology',
    status: 'DRAFT',
    targetDuration: 15,
    scriptStyle: 'educational',
    visualStyle: 'futuristic',
    captionStyle: 'highlighted',
    musicStyle: 'corporate',
    musicVolume: 0.2,
    voiceId: 'mock_elena',
    voiceName: 'Elena (Demo)',
    preset: 'youtube_shorts',
    templateId: template?.id,
    qualityMode: 'standard',
  }).returning();

  const publicId = `job_frames_${Date.now()}`;
  const [job] = await db.insert(generationJobs).values({
    publicId, projectId: project.id, userId, type: 'FULL_PIPELINE', status: 'RUNNING', stage: 'QUEUED',
  }).returning();

  console.log('[frames] rendering…');
  await runFullPipeline({ jobId: job.id, publicId, type: 'FULL_PIPELINE', projectId: project.id, userId, options: {} });

  const [video] = await db.select().from(videoAssets).where(eq(videoAssets.projectId, project.id)).limit(1);
  const storage = getStorage();
  const mp4 = await storage.get(video.storageKey!);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const mp4Path = path.join(os.tmpdir(), `frames-${Date.now()}.mp4`);
  await fs.writeFile(mp4Path, mp4);

  const ffmpeg = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
  const stamps = ['0.5', '4', '8', '12'];
  for (const [i, t] of stamps.entries()) {
    const out = path.join(OUT_DIR, `frame-${i + 1}.png`);
    await execFileAsync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-ss', t, '-i', mp4Path,
      '-frames:v', '1', out,
    ], { windowsHide: true });
    const size = (await fs.stat(out)).size;
    console.log(`[frames] t=${t}s -> ${path.relative(process.cwd(), out)} (${Math.round(size / 1024)} KB)`);
  }

  await fs.rm(mp4Path, { force: true });
  console.log(`\nMP4: ${Math.round(mp4.byteLength / 1024)} KB at ${video.resolution}`);
  console.log(`Frames written to ${path.relative(process.cwd(), OUT_DIR)}`);

  const pg = (globalThis as { __shortforgePglite?: { close: () => Promise<void> } }).__shortforgePglite;
  if (pg) await pg.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[frames] failed:', err);
  process.exit(1);
});
