/**
 * Security utilities: secret encryption at rest, rate limiting, SSRF guards,
 * input sanitisation and safe external requests.
 */
import crypto from 'node:crypto';
import { config } from './config';

// ---------------------------------------------------------------------------
// Symmetric encryption for OAuth tokens at rest
// ---------------------------------------------------------------------------

function encryptionKey(): Buffer {
  if (config.tokenEncryptionKey) {
    const raw = config.tokenEncryptionKey;
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
    // Derive a stable 32-byte key from any passphrase.
    return crypto.createHash('sha256').update(raw).digest();
  }
  if (config.isProd) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be set in production to encrypt YouTube OAuth tokens at rest.',
    );
  }
  return crypto.createHash('sha256').update(`${config.signingSecret}:token-encryption`).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== 'v1') throw new Error('Unsupported encrypted secret format.');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Rate limiting (in-process; swap for Redis in multi-instance deployments)
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    buckets.set(key, fresh);
    return { allowed: true, remaining: limit - 1, resetAt: fresh.resetAt, limit };
  }

  bucket.count += 1;
  const allowed = bucket.count <= limit;

  // Opportunistic cleanup to avoid unbounded growth.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }

  return { allowed, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt, limit };
}

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
]);

/**
 * Only http(s) URLs pointing at public hosts may be fetched.
 * Blocks loopback, link-local, private ranges and cloud metadata endpoints.
 */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed.');
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error('Requests to internal or metadata addresses are not allowed.');
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const isPrivate =
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0;
    if (isPrivate) throw new Error('Requests to private network addresses are not allowed.');
  }

  return url;
}

/** Safe fetch: validates the URL, caps response size, enforces a timeout. */
export async function safeFetch(
  raw: string,
  init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Response> {
  assertPublicUrl(raw);
  const { timeoutMs = 15_000, maxBytes = 25 * 1024 * 1024, ...rest } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(raw, { ...rest, signal: controller.signal, redirect: 'follow' });
    if (res.ok) {
      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > maxBytes) {
        throw new Error(`Response exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit.`);
      }
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Sanitisation
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Strip control characters and clamp length. Used for user-supplied text. */
export function sanitizeText(input: unknown, maxLength = 20_000): string {
  if (typeof input !== 'string') return '';
  return input.replace(CONTROL_CHARS, '').trim().slice(0, maxLength);
}

/**
 * Neutralise prompt-injection attempts in untrusted external content
 * (research snippets, uploaded text) before it reaches a model.
 */
export function defuseUntrustedContent(input: string, maxLength = 4000): string {
  return sanitizeText(input, maxLength)
    .replace(/```/g, "'''")
    .replace(
      /\b(ignore|disregard|forget|override)\b\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/gi,
      '[redacted-instruction-like-text]',
    )
    .replace(/<\/?(system|assistant|user|instructions?)>/gi, '[redacted-tag]')
    .replace(/\b(system|developer)\s*:\s*/gi, '[redacted-role]');
}

/** Validate an uploaded file's real type from its magic bytes. */
export function detectContentType(buffer: Buffer): string | null {
  const startsWith = (...bytes: number[]) =>
    buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);

  // ISO-BMFF (MP4/MOV): the 'ftyp' box sits at offset 4, so 8 bytes suffice.
  if (
    buffer.length >= 8 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return 'video/mp4';
  }
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0x52, 0x49, 0x46, 0x46) && buffer[8] === 0x57 && buffer[9] === 0x45) {
    return 'image/webp';
  }
  if (startsWith(0x49, 0x44, 0x33)) return 'audio/mpeg';
  if (startsWith(0x52, 0x49, 0x46, 0x46) && buffer[8] === 0x57 && buffer[9] === 0x41) return 'audio/wav';
  return null;
}

export const ALLOWED_UPLOAD_TYPES = [
  'video/mp4',
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
] as const;

export type AllowedUploadType = (typeof ALLOWED_UPLOAD_TYPES)[number];

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Cryptographically random opaque identifier for jobs. */
export function randomJobId(): string {
  return `job_${crypto.randomBytes(12).toString('hex')}`;
}

export function randomId(): string {
  return crypto.randomUUID();
}
