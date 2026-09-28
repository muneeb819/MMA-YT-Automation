/**
 * YouTube Data API v3 client.
 *
 * OAuth 2.0 Authorization Code flow. We never request or store a password.
 * Tokens are encrypted at rest with AES-256-GCM before being persisted.
 */
import { config } from '@/lib/config';
import { decryptSecret, encryptSecret } from '@/lib/security';
import { ProviderError } from '@/providers/types';

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

export interface YouTubeChannel {
  channelId: string;
  channelName: string;
  thumbnail?: string;
}

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

export function isYouTubeConfigured(): boolean {
  return config.youtube.configured;
}

export function getAuthUrl(state: string): string {
  if (!config.youtube.configured) {
    throw new ProviderError(
      'YouTube is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET.',
      'youtube',
      false,
      503,
    );
  }
  const params = new URLSearchParams({
    client_id: config.youtube.clientId,
    redirect_uri: config.youtube.redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCode(code: string): Promise<StoredToken> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.youtube.clientId,
      client_secret: config.youtube.clientSecret,
      redirect_uri: config.youtube.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new ProviderError(
      `YouTube authorization failed: ${json.error_description ?? json.error ?? res.status}`,
      'youtube',
      false,
      401,
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    scope: json.scope,
  };
}

/** Exchange a stored refresh token for a fresh access token. */
export async function refreshAccessToken(refreshToken: string): Promise<StoredToken> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.youtube.clientId,
      client_secret: config.youtube.clientSecret,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new ProviderError(
      'Your YouTube connection has expired. Please reconnect your channel.',
      'youtube',
      false,
      401,
    );
  }
  return {
    accessToken: json.access_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    scope: json.scope,
  };
}

export function encryptToken(token: StoredToken) {
  return {
    accessToken: encryptSecret(token.accessToken),
    refreshToken: token.refreshToken ? encryptSecret(token.refreshToken) : null,
    expiresAt: token.expiresAt ? new Date(token.expiresAt) : null,
    scope: token.scope ?? null,
  };
}

export function decryptToken(row: {
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: Date | null;
  scope: string | null;
}): StoredToken {
  if (!row.encryptedAccessToken) {
    throw new ProviderError('No YouTube token is stored for this account.', 'youtube', false, 401);
  }
  return {
    accessToken: decryptSecret(row.encryptedAccessToken),
    refreshToken: row.encryptedRefreshToken ? decryptSecret(row.encryptedRefreshToken) : undefined,
    expiresAt: row.tokenExpiresAt ? row.tokenExpiresAt.getTime() : undefined,
    scope: row.scope ?? undefined,
  };
}

export async function getChannel(accessToken: string): Promise<YouTubeChannel> {
  const params = new URLSearchParams({
    part: 'snippet',
    mine: 'true',
  });
  const res = await fetch(`${API_BASE}/channels?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(
      `Could not read your YouTube channel: ${text.slice(0, 200)}`,
      'youtube',
      res.status >= 500,
      res.status,
    );
  }
  const json = (await res.json()) as {
    items?: {
      id: string;
      snippet?: { title?: string; thumbnails?: { default?: { url?: string } } };
    }[];
  };
  const item = json.items?.[0];
  if (!item) {
    throw new ProviderError(
      'No YouTube channel is associated with this account.',
      'youtube',
      false,
      404,
    );
  }
  return {
    channelId: item.id,
    channelName: item.snippet?.title ?? 'YouTube channel',
    thumbnail: item.snippet?.thumbnails?.default?.url,
  };
}

export interface UploadRequest {
  buffer: Buffer;
  filename: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: 'PRIVATE' | 'UNLISTED' | 'PUBLIC';
  /** Reserved; YouTube does not support server-side scheduled publishing. */
  notifySubscribers?: boolean;
}

export interface UploadResult {
  videoId: string;
  url: string;
}

/**
 * Resumable upload of a finished video.
 *
 * Publishing is only ever called from the publish route, which requires an
 * explicit user confirmation and defaults to PRIVATE.
 */
export async function uploadVideo(accessToken: string, req: UploadRequest): Promise<UploadResult> {
  // 1. Initiate the resumable session.
  const metadata = {
    snippet: {
      title: req.title.slice(0, 100),
      description: req.description.slice(0, 5000),
      tags: req.tags.slice(0, 30),
      categoryId: '27', // Education
    },
    status: {
      privacyStatus: req.privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };

  const init = await fetch(`${UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(req.buffer.byteLength),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(30_000),
  });

  if (!init.ok) {
    const text = await init.text().catch(() => '');
    throw new ProviderError(
      `YouTube rejected the upload request: ${text.slice(0, 300)}`,
      'youtube',
      init.status >= 500,
      init.status,
    );
  }

  const sessionUri = init.headers.get('location');
  if (!sessionUri) {
    throw new ProviderError('YouTube did not return an upload session URL.', 'youtube', true);
  }

  // 2. Upload the bytes in a single chunk (shorts are small).
  const upload = await fetch(sessionUri, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(req.buffer.byteLength),
    },
    body: new Uint8Array(req.buffer),
    signal: AbortSignal.timeout(600_000),
  });

  if (!upload.ok) {
    const text = await upload.text().catch(() => '');
    throw new ProviderError(
      `YouTube upload failed: ${text.slice(0, 300)}`,
      'youtube',
      true,
      upload.status,
    );
  }

  const json = (await upload.json()) as { id?: string };
  if (!json.id) {
    throw new ProviderError('YouTube did not return a video id.', 'youtube', true);
  }

  return { videoId: json.id, url: `https://www.youtube.com/watch?v=${json.id}` };
}

export { SCOPES };
