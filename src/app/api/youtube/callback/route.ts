import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { youtubeConnections } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { exchangeCode, getChannel } from '@/lib/youtube';
import { log } from '@/lib/logging';
import { OAUTH_STATE_COOKIE, oauthStateCookieOptions } from '@/lib/oauth-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/youtube/callback
 * Exchanges the authorization code and stores encrypted tokens.
 */
export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;

  if (error) {
    return fail(`YouTube authorization was declined: ${error}`, 400, 'YOUTUBE_AUTH_DECLINED');
  }
  if (!code) return fail('No authorization code was returned by YouTube.', 400, 'NO_CODE');
  if (!state || !expectedState || state !== expectedState) {
    return fail('OAuth state mismatch. Please restart the connection.', 400, 'STATE_MISMATCH');
  }

  const user = await requireUser();
  const token = await exchangeCode(code);
  const channel = await getChannel(token.accessToken);
  const db = await getDb();

  await db
    .insert(youtubeConnections)
    .values({
      userId: user.id,
      channelId: channel.channelId,
      channelName: channel.channelName,
      channelThumbnail: channel.thumbnail ?? null,
      encryptedAccessToken: token.accessToken,
      encryptedRefreshToken: token.refreshToken ?? null,
      tokenExpiresAt: token.expiresAt ? new Date(token.expiresAt) : null,
      scope: token.scope ?? null,
    })
    .onConflictDoUpdate({
      target: youtubeConnections.userId,
      set: {
        channelId: channel.channelId,
        channelName: channel.channelName,
        channelThumbnail: channel.thumbnail ?? null,
        encryptedAccessToken: token.accessToken,
        encryptedRefreshToken: token.refreshToken ?? null,
        tokenExpiresAt: token.expiresAt ? new Date(token.expiresAt) : null,
        scope: token.scope ?? null,
        updatedAt: new Date(),
      },
    });

  log.info('youtube.connected', { user_id: user.id, channel_id: channel.channelId });

  const res = ok({ connected: true, channel });
  res.cookies.set({ ...oauthStateCookieOptions(), value: '', maxAge: 0 });
  return res;
}, { route: 'GET /api/youtube/callback' });
