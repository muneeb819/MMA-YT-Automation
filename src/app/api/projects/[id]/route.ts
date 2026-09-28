import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects, seoMetadata, scripts, userSettings } from '@/db/schema';
import { requireUser, requireProject } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { loadProjectDetail, deleteProject } from '@/lib/project-data';
import { sanitizeText } from '@/lib/security';
import { CAPTION_STYLES, MUSIC_STYLES, PRESETS, QUALITY_MODES, VISUAL_STYLES } from '@/lib/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  script: z.object({ hook: z.string().max(2000), body: z.string().max(20_000), cta: z.string().max(2000) }).optional(),
  seo: z
    .object({
      title: z.string().max(200),
      description: z.string().max(5000),
      hashtags: z.array(z.string().max(80)).max(30),
      tags: z.array(z.string().max(80)).max(40),
    })
    .optional(),
  scene: z
    .object({
      id: z.number().int().positive(),
      narration: z.string().max(4000).optional(),
      caption: z.string().max(300).optional(),
      transition: z.string().max(40).optional(),
    })
    .optional(),
  settings: z
    .object({
      visualStyle: z.enum(VISUAL_STYLES).optional(),
      captionStyle: z.enum(CAPTION_STYLES).optional(),
      musicStyle: z.enum(MUSIC_STYLES).optional(),
      musicVolume: z.number().min(0).max(1).optional(),
      voiceId: z.string().max(120).optional(),
      voiceName: z.string().max(120).optional(),
      voiceSpeed: z.number().min(0.5).max(2).optional(),
      preset: z.enum(PRESETS).optional(),
      qualityMode: z.enum(QUALITY_MODES).optional(),
    })
    .optional(),
});

/** GET /api/projects/:id — full project detail. */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return fail('Invalid project id.', 400, 'VALIDATION');
  }

  const detail = await loadProjectDetail(projectId, user.id);
  if (!detail) return fail('Project not found.', 404, 'NOT_FOUND');
  return ok(detail);
}, { route: 'GET /api/projects/:id' });

/** PATCH /api/projects/:id — autosave for script, SEO, scenes and settings. */
export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const projectId = Number(id);
  const project = await requireProject(projectId, user.id);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Invalid input.', 400, 'VALIDATION');
  }
  const input = parsed.data;
  const db = await getDb();

  // Project-level style settings.
  if (input.settings) {
    const s = input.settings;
    await db
      .update(projects)
      .set({
        ...(s.visualStyle ? { visualStyle: s.visualStyle } : {}),
        ...(s.captionStyle ? { captionStyle: s.captionStyle } : {}),
        ...(s.musicStyle ? { musicStyle: s.musicStyle } : {}),
        ...(s.musicVolume !== undefined ? { musicVolume: s.musicVolume } : {}),
        ...(s.voiceId ? { voiceId: s.voiceId } : {}),
        ...(s.voiceName ? { voiceName: s.voiceName } : {}),
        ...(s.voiceSpeed !== undefined ? { voiceSpeed: s.voiceSpeed } : {}),
        ...(s.preset ? { preset: s.preset } : {}),
        ...(s.qualityMode ? { qualityMode: s.qualityMode } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
  }

  if (input.title !== undefined) {
    await db
      .update(projects)
      .set({ title: sanitizeText(input.title, 200), updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }

  if (input.script) {
    const [latest] = await db
      .select()
      .from(scripts)
      .where(eq(scripts.projectId, projectId))
      .orderBy(scripts.version)
      .limit(1);
    if (latest) {
      await db
        .update(scripts)
        .set({
          hook: sanitizeText(input.script.hook, 2000),
          body: sanitizeText(input.script.body, 20_000),
          cta: sanitizeText(input.script.cta, 2000),
        })
        .where(eq(scripts.id, latest.id));
    }
  }

  if (input.seo) {
    const s = input.seo;
    await db
      .insert(seoMetadata)
      .values({
        projectId,
        title: sanitizeText(s.title, 200),
        description: sanitizeText(s.description, 5000),
        hashtags: s.hashtags.map((h) => sanitizeText(h, 80).replace(/^#/, '')).filter(Boolean),
        tags: s.tags.map((t) => sanitizeText(t, 80).replace(/^#/, '')).filter(Boolean),
      })
      .onConflictDoUpdate({
        target: seoMetadata.projectId,
        set: {
          title: sanitizeText(s.title, 200),
          description: sanitizeText(s.description, 5000),
          hashtags: s.hashtags.map((h) => sanitizeText(h, 80).replace(/^#/, '')).filter(Boolean),
          tags: s.tags.map((t) => sanitizeText(t, 80).replace(/^#/, '')).filter(Boolean),
          updatedAt: new Date(),
        },
      });
  }

  if (input.scene) {
    // Ownership is enforced by checking the scene belongs to this project.
    const { scenes } = await import('@/db/schema');
    const [scene] = await db
      .select()
      .from(scenes)
      .where(eq(scenes.id, input.scene.id))
      .limit(1);
    if (!scene || scene.projectId !== projectId) {
      return fail('Scene not found.', 404, 'NOT_FOUND');
    }
    await db
      .update(scenes)
      .set({
        ...(input.scene.narration !== undefined
          ? { narration: sanitizeText(input.scene.narration, 4000) }
          : {}),
        ...(input.scene.caption !== undefined
          ? { caption: sanitizeText(input.scene.caption, 300) }
          : {}),
        ...(input.scene.transition !== undefined
          ? { transition: sanitizeText(input.scene.transition, 40) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(scenes.id, input.scene.id));
  }

  return ok({ saved: true, projectId, updatedAt: project.updatedAt });
}, { route: 'PATCH /api/projects/:id' });

/** DELETE /api/projects/:id — cascade deletes all child records. */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const projectId = Number(id);

  const removed = await deleteProject(projectId, user.id);
  if (!removed) return fail('Project not found.', 404, 'NOT_FOUND');

  // Best-effort asset cleanup. The database rows are already gone, so a storage
  // failure must not turn a successful delete into an error.
  const prefix = `users/${user.id}/projects/${projectId}`;
  const getStorage = (await import('@/providers/registry')).getStorage;
  getStorage()
    .deletePrefix(prefix)
    .catch(() => 0);

  return ok({ deleted: true, projectId });
}, { route: 'DELETE /api/projects/:id' });
