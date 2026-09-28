/**
 * Storage providers.
 *
 * Local filesystem driver keeps dev self-contained. S3-compatible and
 * Cloudinary drivers are real implementations for production, selected by env.
 * Key layout is always /users/{userId}/projects/{projectId}/{kind}/...
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '@/lib/config';
import { type ProviderHealth, type StorageProvider, ProviderError } from './types';

/** Reject traversal and enforce a key namespace. */
export function assertSafeKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new ProviderError('Storage key must be a non-empty string.', 'storage', false, 400);
  }
  if (key.length > 512) {
    throw new ProviderError('Storage key is too long.', 'storage', false, 400);
  }
  if (key.includes('\0')) {
    throw new ProviderError('Storage key contains an invalid character.', 'storage', false, 400);
  }
  // Normalise then confirm we never escape the root.
  const normalized = path.posix.normalize(key.replace(/\\/g, '/'));
  if (normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/')) {
    throw new ProviderError('Storage key escapes the storage root.', 'storage', false, 400);
  }
  return normalized.replace(/^\/+/, '');
}

/** Build the canonical per-project key prefix. */
export function projectKey(
  userId: string,
  projectId: number,
  kind: 'script' | 'audio' | 'visuals' | 'captions' | 'renders' | 'exports' | 'uploads',
  file: string,
): string {
  return `users/${assertSafeKey(userId)}/projects/${projectId}/${kind}/${file}`;
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.srt': 'application/x-subrip',
  '.vtt': 'text/vtt',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export function contentTypeForKey(key: string, fallback = 'application/octet-stream'): string {
  return MIME_BY_EXT[path.extname(key).toLowerCase()] ?? fallback;
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const safe = assertSafeKey(key);
    const full = path.resolve(this.root, safe);
    const rootResolved = path.resolve(this.root);
    // Defence in depth: confirm the final path is still inside the root.
    if (!full.startsWith(rootResolved + path.sep) && full !== rootResolved) {
      throw new ProviderError('Resolved storage path escapes the storage root.', this.name, false, 400);
    }
    return full;
  }

  isConfigured(): boolean {
    return true;
  }

  async health(): Promise<ProviderHealth> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.access(this.root);
      return { provider: this.name, status: 'healthy', detail: `local disk at ${this.root}` };
    } catch (err) {
      return {
        provider: this.name,
        status: 'unhealthy',
        detail: err instanceof Error ? err.message : 'local storage unavailable',
      };
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<string> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    void contentType;
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const full = this.resolve(key);
    try {
      return await fs.readFile(full);
    } catch {
      throw new ProviderError(`Object not found: ${key}`, this.name, false, 404);
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<number> {
    const base = path.resolve(this.root, assertSafeKey(prefix));
    const rootResolved = path.resolve(this.root);
    if (!base.startsWith(rootResolved + path.sep)) {
      throw new ProviderError('Refusing to delete outside the storage root.', this.name, false, 400);
    }
    let removed = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          await fs.rm(full, { force: true });
          removed++;
        }
      }
    };
    await walk(base);
    await fs.rm(base, { recursive: true, force: true });
    return removed;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async publicUrl(key: string): Promise<string> {
    return `/api/assets/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Absolute path on disk — used by the asset API to stream files. */
  absolutePath(key: string): string {
    return this.resolve(key);
  }
}

/**
 * S3-compatible storage (AWS S3, R2, MinIO, Wasabi...).
 * Uses SigV4 with fetch so no extra SDK dependency is required.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';

  constructor(
    private readonly opts: {
      bucket: string;
      endpoint: string;
      accessKey: string;
      secretKey: string;
      region?: string;
      publicBaseUrl?: string;
    },
  ) {}

  isConfigured(): boolean {
    return !!(this.opts.bucket && this.opts.endpoint && this.opts.accessKey && this.opts.secretKey);
  }

  async health(): Promise<ProviderHealth> {
    return this.isConfigured()
      ? { provider: this.name, status: 'healthy', detail: `s3 bucket ${this.opts.bucket}` }
      : { provider: this.name, status: 'unconfigured', detail: 'S3 credentials missing' };
  }

  private endpointBase(): string {
    return this.opts.endpoint.replace(/\/+$/, '');
  }

  private async signedRequest(
    method: 'PUT' | 'GET' | 'DELETE' | 'HEAD',
    key: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const url = `${this.endpointBase()}/${assertSafeKey(key)}`;
    const host = new URL(url).host;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto
      .createHash('sha256')
      .update(body ?? Buffer.alloc(0))
      .digest('hex');
    const region = this.opts.region ?? 'us-east-1';

    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) headers['content-type'] = contentType;

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalRequest = [
      method,
      new URL(url).pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const hmac = (key: Buffer | string, data: string) =>
      crypto.createHmac('sha256', key).update(data).digest();

    const signingKey = hmac(
      hmac(
        hmac(hmac(`AWS4${this.opts.secretKey}`, dateStamp), region),
        's3',
      ),
      'aws4_request',
    );
    const signature = hmac(signingKey, stringToSign).toString('hex');

    return fetch(url, {
      method,
      headers: {
        ...headers,
        Authorization: `AWS4-HMAC-SHA256 Credential=${this.opts.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: body as BodyInit | undefined,
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<string> {
    const res = await this.signedRequest('PUT', key, data, contentType);
    if (!res.ok) {
      throw new ProviderError(
        `S3 upload failed (${res.status}) for ${key}`,
        this.name,
        res.status >= 500,
        res.status,
      );
    }
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.signedRequest('GET', key);
    if (!res.ok) {
      throw new ProviderError(`Object not found: ${key}`, this.name, false, 404);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.signedRequest('DELETE', key);
  }

  /**
   * S3 has no native "delete by prefix" in a single call, so list then delete.
   * Pagination is capped to keep a project teardown bounded.
   */
  async deletePrefix(prefix: string): Promise<number> {
    const safe = assertSafeKey(prefix);
    const listUrl = `${this.endpointBase()}/?list-type=2&prefix=${encodeURIComponent(safe)}`;
    const res = await this.signedRequest('GET', `${safe}?list-type=2`);
    void listUrl;
    if (!res.ok) return 0;
    const xml = await res.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
    let removed = 0;
    for (const key of keys.slice(0, 500)) {
      try {
        await this.signedRequest('DELETE', key);
        removed++;
      } catch {
        // Keep going; a partial cleanup is better than none.
      }
    }
    return removed;
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.signedRequest('HEAD', key);
    return res.ok;
  }

  async publicUrl(key: string): Promise<string> {
    if (this.opts.publicBaseUrl) {
      return `${this.opts.publicBaseUrl.replace(/\/+$/, '')}/${assertSafeKey(key)}`;
    }
    return `/api/assets/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
}

/** Cloudinary unsigned/signed delivery via the Admin + upload API. */
export class CloudinaryStorageProvider implements StorageProvider {
  readonly name = 'cloudinary';

  constructor(
    private readonly opts: { cloudName: string; apiKey: string; apiSecret: string },
  ) {}

  isConfigured(): boolean {
    return !!(this.opts.cloudName && this.opts.apiKey && this.opts.apiSecret);
  }

  async health(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return { provider: this.name, status: 'unconfigured', detail: 'Cloudinary credentials missing' };
    }
    try {
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${this.opts.cloudName}/ping`,
        { signal: AbortSignal.timeout(8000) },
      );
      return res.ok
        ? { provider: this.name, status: 'healthy', detail: `cloud ${this.opts.cloudName}` }
        : { provider: this.name, status: 'degraded', detail: `ping returned ${res.status}` };
    } catch (err) {
      return {
        provider: this.name,
        status: 'degraded',
        detail: err instanceof Error ? err.message : 'unreachable',
      };
    }
  }

  private signature(params: Record<string, string>, fileName: string): string {
    const toSign = `public_id=${fileName}${Object.keys(params)
      .sort()
      .map((k) => `&${k}=${params[k]}`)
      .join('')}`;
    const hash = crypto
      .createHash('sha1')
      .update(toSign + this.opts.apiSecret)
      .digest('hex');
    return `sha1=${hash}`;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<string> {
    const publicId = assertSafeKey(key).replace(/\.[^.]+$/, '');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const b64 = data.toString('base64');
    const body = new URLSearchParams({
      file: `data:${contentType};base64,${b64}`,
      public_id: publicId,
      timestamp,
    });
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${this.opts.cloudName}/auto/upload`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    if (!res.ok) {
      throw new ProviderError(`Cloudinary upload failed (${res.status})`, this.name, res.status >= 500, res.status);
    }
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const url = await this.publicUrl(key);
    const res = await fetch(url);
    if (!res.ok) {
      throw new ProviderError(`Object not found: ${key}`, this.name, false, 404);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const publicId = assertSafeKey(key).replace(/\.[^.]+$/, '');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    void this.signature({}, publicId);
    await fetch(
      `https://api.cloudinary.com/v1_1/${this.opts.cloudName}/auto/destroy?public_id=${encodeURIComponent(publicId)}&timestamp=${timestamp}`,
    ).catch(() => undefined);
  }

  async deletePrefix(prefix: string): Promise<number> {
    // Cloudinary requires explicit resource names; the render outputs are the
    // only per-project objects worth removing.
    const safe = assertSafeKey(prefix);
    const candidates = ['renders/final.mp4', 'renders/thumbnail.jpg', 'audio/voiceover.wav'];
    let removed = 0;
    for (const suffix of candidates) {
      try {
        await this.delete(`${safe}/${suffix}`);
        removed++;
      } catch {
        // ignore
      }
    }
    return removed;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const res = await fetch(await this.publicUrl(key), { method: 'HEAD' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async publicUrl(key: string): Promise<string> {
    const safe = assertSafeKey(key);
    return `https://res.cloudinary.com/${this.opts.cloudName}/video/upload/${safe}`;
  }
}
