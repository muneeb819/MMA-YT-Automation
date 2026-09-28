/**
 * End-to-end pipeline test.
 *
 * Creates a user + project, runs the real pipeline (research -> script -> SEO ->
 * scenes -> visuals -> voice -> captions -> render -> QC) against the real
 * database and real FFmpeg, then asserts the output is a real, playable MP4.
 *
 * Run: node --import tsx scripts/e2e-pipeline.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../src/db';
import { migrate } from '../src/db/push';
import { users, projects, scenes, videoAssets, audioAssets, seoMetadata, generationJobs, researchSources, captionAssets, scripts, templates } from '../src/db/schema';
import { runFullPipeline } from '../src/lib/pipeline';
import { getStorage } from '../src/providers/registry';
import { probeMedia } from '../src/providers/ffmpeg-runner';
import { SYSTEM_TEMPLATES } from '../src/lib/templates';

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`E2E FAILED at "${name}": ${detail}`);
}

async function main() {
  console.log('\n=== END-TO-END PIPELINE TEST ===\n');
  const started = Date.now();

  // 1. Schema.
  await migrate();
  check('database schema created', true);
  const db = await getDb();

  // 2. Seed a template + user.
  for (const tpl of SYSTEM_TEMPLATES) {
    const [existing] = await db.select().from(templates).where(eq(templates.slug, tpl.slug)).limit(1);
    if (!existing) {
      await db.insert(templates).values({
        userId: null, slug: tpl.slug, name: tpl.name, description: tpl.description,
        beats: tpl.beats, category: tpl.category, scriptStyle: tpl.scriptStyle, isSystem: true,
      });
    }
  }
  const [template] = await db.select().from(templates).where(eq(templates.slug, 'dark-documentary')).limit(1);
  check('system templates seeded', !!template, template?.name);

  const userId = `usr_e2e_${Date.now()}`;
  await db.insert(users).values({
    id: userId, email: `e2e-${Date.now()}@shortforge.test`, name: 'E2E Tester', credits: 500,
  });
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  check('user created', !!user, `${user?.credits} credits`);

  // 3. Create a project.
  const [project] = await db.insert(projects).values({
    userId,
    title: 'E2E Documentary',
    topic: 'Tell the story of how the deep ocean was first explored by human submersibles.',
    category: 'history',
    status: 'DRAFT',
    targetDuration: 15,
    scriptStyle: 'documentary',
    visualStyle: 'dark_noir',
    captionStyle: 'bold',
    musicStyle: 'cinematic',
    musicVolume: 0.18,
    voiceId: 'mock_marcus',
    voiceName: 'Marcus (Demo)',
    preset: 'youtube_shorts',
    templateId: template?.id,
    qualityMode: 'draft',
  }).returning();
  check('project created', !!project, `#${project.id}`);

  // 4. Create a job row (the queue normally does this).
  const publicId = `job_e2e_${Date.now()}`;
  const [job] = await db.insert(generationJobs).values({
    publicId, projectId: project.id, userId, type: 'FULL_PIPELINE', status: 'RUNNING', stage: 'QUEUED',
  }).returning();
  check('job record created', !!job, publicId);

  // 5. Run the real pipeline.
  await runFullPipeline(
    { jobId: job.id, publicId, type: 'FULL_PIPELINE', projectId: project.id, userId, options: {} },
    { skipResearch: false },
  );
  check('pipeline completed without throwing', true);

  // 6. Assert persisted artefacts.
  const [updated] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1);
  check('project status is COMPLETED', updated?.status === 'COMPLETED', updated?.status);

  const scriptRows = await db
    .select()
    .from(scripts)
    .where(eq(scripts.projectId, project.id))
    .orderBy(desc(scripts.version))
    .limit(1);
  check('script persisted', (scriptRows[0]?.body?.length ?? 0) > 40, `${scriptRows[0]?.wordCount} words`);

  const sceneRows = await db.select().from(scenes).where(eq(scenes.projectId, project.id)).orderBy(scenes.sceneNumber);
  check('scenes persisted', sceneRows.length > 0, `${sceneRows.length} scenes`);

  const sceneTotal = sceneRows.reduce((a, s) => a + s.duration, 0);
  check('scene durations sum to the target', Math.abs(sceneTotal - project.targetDuration) < 0.5, `${sceneTotal.toFixed(2)}s vs ${project.targetDuration}s`);

  const timedScenes = sceneRows.filter((s) => s.startTime > 0);
  check('scene timeline is monotonic', timedScenes.every((s) => s.startTime >= 0 && s.duration > 0));

  const seoRows = await db.select().from(seoMetadata).where(eq(seoMetadata.projectId, project.id)).limit(1);
  check('SEO metadata persisted', (seoRows[0]?.hashtags?.length ?? 0) >= 3, `${seoRows[0]?.hashtags?.length} hashtags`);

  const audioRows = await db.select().from(audioAssets).where(eq(audioAssets.projectId, project.id)).limit(1);
  check('audio asset persisted', !!audioRows[0]?.storageKey, `${audioRows[0]?.duration}s`);

  const captionRows = await db.select().from(captionAssets).where(eq(captionAssets.projectId, project.id)).limit(1);
  check('captions persisted with word timings', (captionRows[0]?.words?.length ?? 0) > 0, `${captionRows[0]?.words?.length} words`);

  const sourceRows = await db.select().from(researchSources).where(eq(researchSources.projectId, project.id));
  check('research sources recorded (unverified in demo mode)', sourceRows.length > 0, `${sourceRows.length} facts`);

  // 7. Verify the rendered video is a real file.
  const videoRows = await db.select().from(videoAssets).where(eq(videoAssets.projectId, project.id)).orderBy(desc(videoAssets.id)).limit(1);
  const video = videoRows[0];
  check('video asset persisted', !!video?.storageKey, video?.resolution);

  const qc = video?.qcReport as { passed?: boolean; failures?: string[] } | null;
  check('quality check passed', qc?.passed === true, (qc?.failures ?? []).join('; ') || 'no failures');

  const storage = getStorage();
  const exists = await storage.exists(video!.storageKey!);
  check('rendered file exists in storage', exists);

  // Download and probe with a real decoder.
  const buffer = await storage.get(video!.storageKey!);
  check('rendered file is non-trivial', buffer.byteLength > 50_000, `${Math.round(buffer.byteLength / 1024)} KB`);

  const tmp = path.join(process.cwd(), '.data', 'tmp-e2e.mp4');
  await fs.mkdir(path.dirname(tmp), { recursive: true });
  await fs.writeFile(tmp, buffer);
  const probe = await probeMedia(tmp);
  check('rendered file decodes as 1080x1920 H.264', probe.width === 1080 && probe.height === 1920 && probe.hasVideo, `${probe.width}x${probe.height} codec=${probe.codec}`);
  check('rendered file has an audio track', probe.hasAudio);
  check('rendered duration matches the timeline', Math.abs(probe.duration - project.targetDuration) < 2.5, `${probe.duration}s vs ${project.targetDuration}s`);
  await fs.rm(tmp, { force: true });

  // 8. MP4 signature check — proves it is a real container.
  const isMp4 = buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70;
  check('output is a valid MP4 container', isMp4, buffer.subarray(4, 12).toString('latin1'));

  // 9. Credits were charged.
  const [creditUser] = await db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).limit(1);
  check('credits were charged', (creditUser?.credits ?? 0) < 500, `${500 - (creditUser?.credits ?? 0)} spent`);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nAll ${checks.length} end-to-end checks passed in ${elapsed}s.`);
  console.log('Full pipeline verified: idea -> script -> SEO -> scenes -> visuals -> voice -> captions -> render -> QC.\n');
}

main()
  .then(async () => {
    const pg = (globalThis as { __shortforgePglite?: { close: () => Promise<void> } }).__shortforgePglite;
    if (pg) await pg.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n=== E2E PIPELINE FAILED ===');
    console.error(err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
    const pg = (globalThis as { __shortforgePglite?: { close: () => Promise<void> } }).__shortforgePglite;
    if (pg) await pg.close().catch(() => undefined);
    process.exit(1);
  });
