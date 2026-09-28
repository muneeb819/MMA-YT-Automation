/**
 * Environment access. All secrets stay server-side; this module must never be
 * imported from a client component.
 */

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function str(v: string | undefined, fallback = ''): string {
  return v && v.trim() !== '' ? v.trim() : fallback;
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isProd = NODE_ENV === 'production';

/** Mock/demo mode. Demo mode still performs real FFmpeg rendering. */
export const MOCK_MODE = bool(process.env.MOCK_MODE, !isProd);

export const config = {
  nodeEnv: NODE_ENV,
  isProd,
  isDev: !isProd,

  /** Public origin, no trailing slash. */
  appUrl: str(process.env.NEXTAUTH_URL, 'http://localhost:4310').replace(/\/+$/, ''),

  auth: {
    secret: str(process.env.AUTH_SECRET, str(process.env.NEXTAUTH_SECRET)),
    demoLogin: bool(process.env.ALLOW_DEMO_LOGIN, !isProd),
    allowUserProviderKeys: bool(process.env.ALLOW_USER_PROVIDER_KEYS, false),
  },

  db: {
    url: str(process.env.DATABASE_URL),
    pgliteDir: str(process.env.PGLITE_DATA_DIR, '.data/pglite'),
    get isPglite() {
      return str(process.env.DATABASE_URL) === '';
    },
  },

  queue: {
    redisUrl: str(process.env.REDIS_URL),
    get isRedis() {
      return str(process.env.REDIS_URL) !== '';
    },
  },

  storage: {
    driver: str(process.env.STORAGE_DRIVER, 'local') as 'local' | 's3' | 'cloudinary',
    bucket: str(process.env.STORAGE_BUCKET),
    endpoint: str(process.env.STORAGE_ENDPOINT),
    accessKey: str(process.env.STORAGE_ACCESS_KEY),
    secretKey: str(process.env.STORAGE_SECRET_KEY),
    cloudinary: {
      cloudName: str(process.env.CLOUDINARY_CLOUD_NAME),
      apiKey: str(process.env.CLOUDINARY_API_KEY),
      apiSecret: str(process.env.CLOUDINARY_API_SECRET),
    },
    get configured() {
      return this.driver === 's3'
        ? !!(this.bucket && this.endpoint && this.accessKey && this.secretKey)
        : this.driver === 'cloudinary'
          ? !!(this.cloudinary.cloudName && this.cloudinary.apiKey && this.cloudinary.apiSecret)
          : true;
    },
  },

  llm: {
    apiKey: str(process.env.OPENAI_API_KEY),
    baseUrl: str(process.env.OPENAI_BASE_URL, 'https://api.openai.com/v1'),
    model: str(process.env.OPENAI_MODEL, 'gpt-4o-mini'),
    get configured() {
      return this.apiKey !== '';
    },
  },

  voice: {
    apiKey: str(process.env.ELEVENLABS_API_KEY),
    model: str(process.env.ELEVENLABS_MODEL, 'eleven_multilingual_v2'),
    get configured() {
      return this.apiKey !== '';
    },
  },

  replicate: {
    token: str(process.env.REPLICATE_API_TOKEN),
    get configured() {
      return this.token !== '';
    },
  },

  creatomate: {
    apiKey: str(process.env.CREATOMATE_API_KEY),
    get configured() {
      return this.apiKey !== '';
    },
  },

  youtube: {
    clientId: str(process.env.YOUTUBE_CLIENT_ID),
    clientSecret: str(process.env.YOUTUBE_CLIENT_SECRET),
    redirectUri: str(
      process.env.YOUTUBE_REDIRECT_URI,
      `${str(process.env.NEXTAUTH_URL, 'http://localhost:4310').replace(/\/+$/, '')}/api/youtube/callback`,
    ),
    get configured() {
      return this.clientId !== '' && this.clientSecret !== '';
    },
  },

  tokenEncryptionKey: str(process.env.TOKEN_ENCRYPTION_KEY),

  cleanup: {
    tempAfterHours: Number(process.env.CLEANUP_TEMP_AFTER_HOURS ?? 24),
    assetRetentionDays: Number(process.env.ASSET_RETENTION_DAYS ?? 0),
  },

  /**
   * Signing secret. In production a missing AUTH_SECRET is fatal — we refuse to
   * boot rather than silently signing session cookies with a guessable value.
   */
  get signingSecret(): string {
    if (this.auth.secret) return this.auth.secret;
    if (isProd) {
      throw new Error(
        'AUTH_SECRET is required in production. Generate one with: ' +
          'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    return 'shortforge-development-only-secret-do-not-use-in-production';
  },
} as const;

export type AppConfig = typeof config;
