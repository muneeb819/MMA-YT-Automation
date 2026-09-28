import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { youtubeConnections } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { isYouTubeConfigured } from '@/lib/youtube';
import { log } from '@/lib/logging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/youtube — current connection status. */
export const GET = route(async () => {
  const user = await requireUser();
  const db = await getDb();
  const [row] = await db
    .select({
      channelId: youtubeConnections.channelId,
      channelName: youtubeConnections.channelName,
      channelThumbnail: youtubeConnections.channelThumbnail,
      tokenExpiresAt: youtubeConnections.tokenExpiresAt,
      createdAt: youtubeConnections.createdAt,
    })
    .from(youtubeConnections)
    .where(eq(youtubeConnections.userId, user.id))
    .limit(1);

  return ok({
    configured: isYouTubeConfigured(),
    connected: !!row,
    channel: row ?? null,
  });
}, { route: 'GET /api/youtube' });

/** DELETE /api/youtube — disconnect and destroy stored tokens. */
export const DELETE = route(async () => {
  const user = await requireUser();
  const db = await getDb();
  await db.delete(youtubeConnections).where(eq(youtubeConnections.userId, user.id));
  log.info('youtube.disconnected', { user_id: user.id });
  return ok({ connected: false });
}, { route: 'DELETE /api/youtube' });
