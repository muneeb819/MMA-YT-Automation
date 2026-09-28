import { NextResponse } from 'next/server';
import { config, MOCK_MODE } from '@/lib/config';
import { redisHealth } from '@/lib/redis';
import { queueHealth } from '@/lib/queue';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * System health. Reports status per dependency and the active provider wiring.
 * Contains no secrets — only booleans and coarse status strings.
 */
export async function GET() {
  const started = Date.now();
  const health: Record<string, string> = {};
  const details: Record<string, string> = {};

  // Database.
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    health.database = 'healthy';
    details.database = config.db.isPglite
      ? 'embedded PGlite (PostgreSQL compatible)'
      : 'PostgreSQL';
  } catch (err) {
    health.database = 'unhealthy';
    details.database = err instanceof Error ? err.message : 'unreachable';
  }

  // Queue / Redis.
  const queue = await queueHealth();
  health.redis = config.queue.isRedis
    ? (await redisHealth()).status
    : 'healthy';
  details.redis = config.queue.isRedis ? 'Redis (BullMQ)' : 'in-process driver (no REDIS_URL)';
  health.queue = queue.status;
  details.queue = `${queue.driver}, depth ${queue.depth}`;

  // Providers.
  const { getLLM, getVoice, getImage, getRenderer, getStorage } = await import('@/providers/registry');
  const checks = await Promise.all([
    getLLM().health(),
    getVoice().health(),
    getImage().health(),
    getRenderer().health(),
    getStorage().health(),
  ]);
  const [llm, voice, image, renderer, storage] = checks;

  health.openai = llm.status;
  details.openai = llm.detail;
  health.elevenlabs = voice.status;
  details.elevenlabs = voice.detail;
  health.replicate = image.status;
  details.replicate = image.detail;
  health.renderer = renderer.status;
  details.renderer = renderer.detail;
  health.storage = storage.status;
  details.storage = storage.detail;

  const values = Object.values(health);
  const overall = values.includes('unhealthy')
    ? 'unhealthy'
    : values.includes('degraded')
      ? 'degraded'
      : 'healthy';

  // Actionable, credential-free guidance for whatever is limiting the user.
  const warnings: string[] = [];
  if (MOCK_MODE) {
    warnings.push(
      'Demo mode is active. Scripts, voices and visuals are synthetic; the video pipeline is real.',
    );
  }
  if (health.openai === 'unhealthy' || health.openai === 'degraded') {
    warnings.push(
      'OpenAI is not usable: check the key, or that the account has remaining API credit.',
    );
  }
  if (health.elevenlabs === 'unhealthy' || health.elevenlabs === 'degraded') {
    warnings.push(
      'ElevenLabs is not usable: the key must be the secret key (starts with sk_), not a key ID.',
    );
  }
  if (health.replicate === 'unconfigured') {
    warnings.push('Replicate is not set, so scene visuals are generated locally.');
  }
  if (health.youtube === 'unconfigured') {
    warnings.push('YouTube publishing is disabled until OAuth credentials are set.');
  }

  return NextResponse.json({
    success: true,
    data: {
      status: overall,
      mode: MOCK_MODE ? 'demo' : 'live',
      durationMs: Date.now() - started,
      components: health,
      // Detailed strings are safe: no keys, no endpoints with credentials.
      details,
      warnings,
    },
    error: null,
  });
}
