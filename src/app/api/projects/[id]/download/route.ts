import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { audioAssets, captionAssets, scenes, scripts, seoMetadata, videoAssets, projects } from '@/db/schema';
import { requireUser, requireProject } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { getStorage } from '@/providers/registry';
import { contentTypeForKey } from '@/providers/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

type DownloadKind = 'mp4' | 'audio' | 'script' | 'srt' | 'vtt' | 'json';

/**
 * GET /api/projects/:id/download?kind=mp4|audio|script|srt|vtt|json
 *
 * Serves the real file. Always re-checks project ownership before streaming,
 * so a guessed id cannot expose another user's media.
 */
export const GET = route(async (request: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const projectId = Number(id);
  const project = await requireProject(projectId, user.id);

  const url = new URL(request.url);
  const kind = (url.searchParams.get('kind') ?? 'mp4') as DownloadKind;

  const db = await getDb();
  const storage = getStorage();

  const stream = async (
    key: string,
    contentType: string,
    filename: string,
  ): Promise<Response> => {
    const exists = await storage.exists(key);
    if (!exists) {
      return fail('That file is not available yet. Complete generation first.', 404, 'NOT_FOUND');
    }
    const buffer = await storage.get(key);
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };

  switch (kind) {
    case 'mp4': {
      const [video] = await db
        .select()
        .from(videoAssets)
        .where(eq(videoAssets.projectId, projectId))
        .orderBy(videoAssets.id)
        .limit(1);
      const key = video?.storageKey ?? `users/${user.id}/projects/${projectId}/renders/final.mp4`;
      return stream(key, 'video/mp4', `${safeName(project.title)}.mp4`);
    }

    case 'audio': {
      const [audio] = await db
        .select()
        .from(audioAssets)
        .where(eq(audioAssets.projectId, projectId))
        .orderBy(audioAssets.id)
        .limit(1);
      const key = audio?.storageKey ?? `users/${user.id}/projects/${projectId}/audio/voiceover.wav`;
      return stream(key, 'audio/wav', `${safeName(project.title)}-voiceover.wav`);
    }

    case 'script': {
      const [script] = await db
        .select()
        .from(scripts)
        .where(eq(scripts.projectId, projectId))
        .orderBy(scripts.id)
        .limit(1);
      if (!script) return fail('No script has been generated yet.', 404, 'NOT_FOUND');

      const text = [
        script.hook,
        '',
        script.body,
        '',
        script.cta ? `CTA: ${script.cta}` : '',
        '',
        `Word count: ${script.wordCount}`,
        `Estimated duration: ${script.estimatedDuration}s`,
      ]
        .filter((line) => line !== null)
        .join('\n')
        .trim();

      return new Response(text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeName(project.title)}-script.txt"`,
        },
      });
    }

    case 'srt':
    case 'vtt': {
      const [caption] = await db
        .select()
        .from(captionAssets)
        .where(eq(captionAssets.projectId, projectId))
        .limit(1);

      if (caption?.srtUrl || caption?.vttUrl) {
        const key = `users/${user.id}/projects/${projectId}/captions/captions.${kind}`;
        if (await storage.exists(key)) {
          return stream(key, contentTypeForKey(key, kind === 'srt' ? 'application/x-subrip' : 'text/vtt'), `${safeName(project.title)}.${kind}`);
        }
      }
      return fail('Captions have not been generated yet.', 404, 'NOT_FOUND');
    }

    case 'json': {
      const [script, seo, sceneRows, audio, video, captions] = await Promise.all([
        db.select().from(scripts).where(eq(scripts.projectId, projectId)).orderBy(scripts.id).limit(1),
        db.select().from(seoMetadata).where(eq(seoMetadata.projectId, projectId)).limit(1),
        db.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(scenes.sceneNumber),
        db.select().from(audioAssets).where(eq(audioAssets.projectId, projectId)).orderBy(audioAssets.id).limit(1),
        db.select().from(videoAssets).where(eq(videoAssets.projectId, projectId)).orderBy(videoAssets.id).limit(1),
        db.select().from(captionAssets).where(eq(captionAssets.projectId, projectId)).limit(1),
      ]);

      const payload = {
        exportedAt: new Date().toISOString(),
        project: {
          id: project.id,
          title: project.title,
          topic: project.topic,
          category: project.category,
          status: project.status,
          targetDuration: project.targetDuration,
          actualDuration: project.actualDuration,
          preset: project.preset,
          qualityMode: project.qualityMode,
          createdAt: project.createdAt,
        },
        script: script[0] ?? null,
        seo: seo[0] ?? null,
        scenes: sceneRows,
        audio: audio[0]
          ? { voiceId: audio[0].voiceId, voiceName: audio[0].voiceName, duration: audio[0].duration, provider: audio[0].provider }
          : null,
        video: video[0]
          ? { resolution: video[0].resolution, duration: video[0].duration, fps: video[0].fps, sizeBytes: video[0].sizeBytes, qcReport: video[0].qcReport }
          : null,
        captions: captions[0]?.words ?? [],
      };

      return new Response(JSON.stringify(payload, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${safeName(project.title)}-project.json"`,
        },
      });
    }

    default:
      return fail(`Unsupported download kind "${kind}".`, 400, 'VALIDATION');
  }
}, { route: 'GET /api/projects/:id/download' });

/** Strip characters that are unsafe in a Content-Disposition filename. */
function safeName(title: string): string {
  return (title || 'shortforge-export')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 60) || 'shortforge-export';
}
