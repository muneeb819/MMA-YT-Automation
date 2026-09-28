/**
 * Project data access.
 *
 * One place that assembles a complete project view, so API routes, the project
 * page and exports all read the same shape.
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  audioAssets,
  captionAssets,
  generationJobs,
  projects,
  publishRecords,
  researchSources,
  scenes,
  scripts,
  seoMetadata,
  videoAssets,
  projectVersions,
} from '@/db/schema';

export async function loadProjectDetail(projectId: number, userId: string) {
  const db = await getDb();

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project || project.userId !== userId) return null;

  const [scriptRows, seoRows, sceneRows, audioRows, videoRows, captionRows, sourceRows, jobRows, versionRows, publishRows] =
    await Promise.all([
      db.select().from(scripts).where(eq(scripts.projectId, projectId)).orderBy(desc(scripts.version)).limit(1),
      db.select().from(seoMetadata).where(eq(seoMetadata.projectId, projectId)).limit(1),
      db.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(scenes.sceneNumber),
      db.select().from(audioAssets).where(eq(audioAssets.projectId, projectId)).orderBy(desc(audioAssets.id)).limit(1),
      db.select().from(videoAssets).where(eq(videoAssets.projectId, projectId)).orderBy(desc(videoAssets.id)).limit(1),
      db.select().from(captionAssets).where(eq(captionAssets.projectId, projectId)).orderBy(desc(captionAssets.id)).limit(1),
      db.select().from(researchSources).where(eq(researchSources.projectId, projectId)),
      db.select().from(generationJobs).where(eq(generationJobs.projectId, projectId)).orderBy(desc(generationJobs.id)).limit(5),
      db.select().from(projectVersions).where(eq(projectVersions.projectId, projectId)).orderBy(desc(projectVersions.version)),
      db.select().from(publishRecords).where(eq(publishRecords.projectId, projectId)).orderBy(desc(publishRecords.id)).limit(1),
    ]);

  return {
    project,
    script: scriptRows[0] ?? null,
    scriptVersions: await db
      .select({ id: scripts.id, version: scripts.version, createdAt: scripts.createdAt, wordCount: scripts.wordCount })
      .from(scripts)
      .where(eq(scripts.projectId, projectId))
      .orderBy(desc(scripts.version)),
    seo: seoRows[0] ?? null,
    scenes: sceneRows,
    audio: audioRows[0] ?? null,
    video: videoRows[0] ?? null,
    captions: captionRows[0] ?? null,
    sources: sourceRows,
    jobs: jobRows,
    versions: versionRows,
    publish: publishRows[0] ?? null,
  };
}

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof loadProjectDetail>>>;

/** The active (most recent) job, used for progress polling. */
export async function loadActiveJob(projectId: number, userId: string) {
  const db = await getDb();
  const [job] = await db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.projectId, projectId), eq(generationJobs.userId, userId)))
    .orderBy(desc(generationJobs.id))
    .limit(1);
  return job ?? null;
}

export async function deleteProject(projectId: number, userId: string): Promise<boolean> {
  const db = await getDb();
  const deleted = await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ id: projects.id });
  return deleted.length > 0;
}
