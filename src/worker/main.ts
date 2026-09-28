/**
 * Standalone background worker.
 *
 * Run with `npm run worker`. In production this is a separate long-running
 * process (or container) from the web/API service, so FFmpeg renders never
 * block an HTTP request.
 */
import { allHandlers } from '../jobs/handlers';
import { startBullWorker, queueHealth } from '../lib/queue';
import { config, MOCK_MODE } from '../lib/config';
import { log } from '../lib/logging';
import { getFfmpegPath } from '../providers/ffmpeg-runner';

async function main() {
  log.info('worker.starting', {
    mode: MOCK_MODE ? 'demo' : 'live',
    database: config.db.isPglite ? 'pglite' : 'postgres',
  });

  // Confirm a usable renderer before accepting work.
  try {
    const ffmpeg = await getFfmpegPath();
    log.info('worker.ffmpeg', { path: ffmpeg });
  } catch (err) {
    log.error('worker.ffmpeg_missing', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  await startBullWorker(allHandlers());

  const health = await queueHealth();
  log.info('worker.ready', { driver: health.driver, depth: health.depth });

  // Periodic health beacon so orchestration can observe the worker.
  const timer = setInterval(() => {
    void queueHealth().then((h) => log.info('worker.health', h));
  }, 60_000);
  timer.unref?.();

  const shutdown = (signal: string) => {
    log.info('worker.shutdown', { signal });
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // PGlite holds the event loop open; keep the process alive deliberately.
  setInterval(() => undefined, 1 << 30);
}

main().catch((err) => {
  log.error('worker.fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
