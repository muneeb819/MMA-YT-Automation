/**
 * YouTube token lifecycle.
 * Kept out of route files so both the publish route and any future job can use it.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { youtubeConnections } from '@/db/schema';
import { decryptToken, refreshAccessToken } from '@/lib/youtube';
import { rateLimit } from '@/lib/security';

export async function getValidAccessToken(userId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(youtubeConnections)
    .where(eq(youtubeConnections.userId, userId))
    .limit(1);

  if (!row) {
    throw Object.assign(new Error('Connect your YouTube channel before publishing.'), { status: 409 });
  }

  const token = decryptToken(row);
  const expiringSoon = token.expiresAt ? token.expiresAt - Date.now() < 60_000 : false;

  if (expiringSoon && token.refreshToken) {
    const rl = rateLimit(`yt-refresh:${userId}`, 20, 60_000);
    if (!rl.allowed) {
      throw Object.assign(new Error('Too many token refreshes. Try again shortly.'), { status: 429 });
    }
    const refreshed = await refreshAccessToken(token.refreshToken);
    await db
      .update(youtubeConnections)
      .set({
        encryptedAccessToken: refreshed.accessToken,
        tokenExpiresAt: refreshed.expiresAt ? new Date(refreshed.expiresAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(youtubeConnections.userId, userId));
    return refreshed.accessToken;
  }

  if (expiringSoon) {
    throw Object.assign(
      new Error('Your YouTube connection expired. Please reconnect your channel.'),
      { status: 401 },
    );
  }

  return token.accessToken;
}
