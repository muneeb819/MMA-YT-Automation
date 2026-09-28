import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { youtubeConnections } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { getAuthUrl, isYouTubeConfigured } from '@/lib/youtube';
import { oauthStateCookieOptions } from '@/lib/oauth-state';
import { log } from '@/lib/logging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/youtube/connect — redirect to Google's consent screen. */
export const GET = route(async () => {
  await requireUser();

  if (!isYouTubeConfigured()) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'YOUTUBE_NOT_CONFIGURED',
          message:
            'YouTube publishing is not configured on this server. Add YOUTUBE_CLIENT_ID, ' +
            'YOUTUBE_CLIENT_SECRET and YOUTUBE_REDIRECT_URI to enable it.',
        },
      },
      { status: 503 },
    );
  }

  const state = crypto.randomUUID();
  const url = getAuthUrl(state);

  const res = ok({ authorizeUrl: url });
  // State is echoed back on the callback and compared, preventing CSRF.
  res.cookies.set({ ...oauthStateCookieOptions(), value: state, maxAge: 600 });
  return res;
}, { route: 'GET /api/youtube/connect' });
