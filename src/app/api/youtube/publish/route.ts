import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects, publishRecords, seoMetadata, videoAssets, youtubeConnections } from '@/db/schema';
import { requireUser, requireProject } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { getStorage } from '@/providers/registry';
import { uploadVideo } from '@/lib/youtube';
import { getValidAccessToken } from '@/lib/youtube-tokens';
import { checkSafety } from '@/lib/templates';
import { log } from '@/lib/logging';
import { rateLimit } from '@/lib/security';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  projectId: z.number().int().positive(),
  privacyStatus: z.enum(['PRIVATE', 'UNLISTED', 'PUBLIC']).default('PRIVATE'),
  /** Must be true. Guards against accidental one-click publishing. */
  confirmed: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm the publish details before publishing.' }),
  }),
});

/**
 * POST /api/youtube/publish
 *
 * Uploads a finished video. Refuses to run without an explicit confirmation flag
 * from the publish dialog. Defaults to PRIVATE — going PUBLIC is always a
 * deliberate user choice.
 */
export const POST = route(async (request: Request) => {
  const user = await requireUser();

  const rl = rateLimit(`yt-publish:${user.id}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) {
    return fail('Publishing limit reached. Try again later.', 429, 'RATE_LIMITED');
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? 'Invalid publish request.',
      400,
      'VALIDATION',
    );
  }
  const { projectId, privacyStatus, confirmed } = parsed.data;
  void confirmed;

  const project = await requireProject(projectId, user.id);
  const db = await getDb();

  const [connection] = await db
    .select({ channelName: youtubeConnections.channelName })
    .from(youtubeConnections)
    .where(eq(youtubeConnections.userId, user.id))
    .limit(1);
  if (!connection) {
    return fail(
      'Connect your YouTube channel before publishing.',
      409,
      'YOUTUBE_NOT_CONNECTED',
    );
  }

  const [video] = await db
    .select()
    .from(videoAssets)
    .where(eq(videoAssets.projectId, projectId))
    .orderBy(videoAssets.id)
    .limit(1);
  if (!video?.storageKey) {
    return fail('This project has no finished video to publish yet.', 409, 'NO_VIDEO');
  }

  const [seo] = await db
    .select()
    .from(seoMetadata)
    .where(eq(seoMetadata.projectId, projectId))
    .limit(1);

  // Final metadata safety check before anything leaves the platform.
  const safety = checkSafety(
    `${project.topic} ${seo?.title ?? ''} ${seo?.description ?? ''}`,
    'publish',
  );
  if (!safety.allowed) {
    return fail(safety.reason ?? 'This content cannot be published.', 422, 'CONTENT_SAFETY');
  }

  const accessToken = await getValidAccessToken(user.id);
  const storage = getStorage();
  const buffer = await storage.get(video.storageKey);

  const title = seo?.title || project.title;
  const description = seo?.description || '';
  // Hashtags belong at the end of the description for YouTube.
  const hashtags = (seo?.hashtags ?? []).map((h) => `#${h}`).join(' ');
  const fullDescription = hashtags ? `${description}\n\n${hashtags}`.trim() : description;

  const result = await uploadVideo(accessToken, {
    buffer,
    filename: `${project.id}.mp4`,
    title,
    description: fullDescription,
    tags: seo?.tags ?? [],
    privacyStatus,
  });

  await db.insert(publishRecords).values({
    projectId,
    userId: user.id,
    youtubeVideoId: result.videoId,
    url: result.url,
    privacy: privacyStatus,
    confirmedAt: new Date(),
  });

  await db
    .update(projects)
    .set({
      publishedVideoId: result.videoId,
      publishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  log.info('youtube.published', {
    user_id: user.id,
    project_id: projectId,
    channel: connection.channelName,
    privacy: privacyStatus,
  });

  return ok({
    videoId: result.videoId,
    url: result.url,
    privacy: privacyStatus,
    channelName: connection.channelName,
  });
}, { route: 'POST /api/youtube/publish' });

/** Admin helper retained for completeness of the admin surface. */
