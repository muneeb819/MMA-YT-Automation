/**
 * Redis connection factory (used only when REDIS_URL is configured).
 * Kept separate so the in-process path never imports ioredis.
 */
import { config } from './config';

type Redis = import('ioredis').Redis;

let client: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!config.queue.redisUrl) {
    throw new Error('REDIS_URL is not configured; the in-process queue driver is in use.');
  }
  if (!client) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IORedis = require('ioredis');
    const Ctor = IORedis.default ?? IORedis;
    client = new Ctor(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
  }
  return client as Redis;
}

export async function redisHealth(): Promise<{ status: string; detail: string }> {
  if (!config.queue.isRedis) {
    return { status: 'healthy', detail: 'in-process queue driver (no Redis configured)' };
  }
  try {
    const client = getRedisConnection();
    const pong = await client.ping();
    return { status: pong === 'PONG' ? 'healthy' : 'degraded', detail: 'redis ping' };
  } catch (err) {
    return {
      status: 'unhealthy',
      detail: err instanceof Error ? err.message : 'redis unreachable',
    };
  }
}
