/**
 * OAuth state cookie helpers.
 * Kept in a lib module because Next.js route files may only export handlers.
 */
export const OAUTH_STATE_COOKIE = 'sf_yt_state';

export function oauthStateCookieOptions() {
  return {
    name: OAUTH_STATE_COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}
