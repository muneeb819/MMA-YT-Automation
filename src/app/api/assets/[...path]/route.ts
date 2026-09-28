import { getStorage, LocalStorageProvider } from '@/providers/registry';
import { requireUser } from '@/lib/auth';
import { fail } from '@/lib/api';
import { contentTypeForKey, assertSafeKey } from '@/providers/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/assets/<key...>
 *
 * Serves a stored object. Two independent guards apply:
 *  1. the key must begin with the authenticated user's own prefix, and
 *  2. traversal segments are rejected by the storage layer.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const user = await requireUser();
  const { path } = await ctx.params;
  const key = (path ?? []).join('/');

  if (!key) return fail('Missing asset key.', 400, 'VALIDATION');

  let safeKey: string;
  try {
    safeKey = assertSafeKey(key);
  } catch {
    return fail('Invalid asset key.', 400, 'VALIDATION');
  }

  // Ownership: only the owner may read their own assets.
  if (!safeKey.startsWith(`users/${user.id}/`)) {
    return fail('Asset not found.', 404, 'NOT_FOUND');
  }

  const storage = getStorage();
  if (!(await storage.exists(safeKey))) {
    return fail('Asset not found.', 404, 'NOT_FOUND');
  }

  // Local driver can stream straight from disk without buffering the whole file.
  if (storage instanceof LocalStorageProvider) {
    const { createReadStream } = await import('node:fs');
    const { stat } = await import('node:fs/promises');
    const filePath = storage.absolutePath(safeKey);
    const info = await stat(filePath);
    const stream = createReadStream(filePath);

    return new Response(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': contentTypeForKey(safeKey),
        'Content-Length': String(info.size),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const buffer = await storage.get(safeKey);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentTypeForKey(safeKey),
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
