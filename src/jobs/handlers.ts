/**
 * Job handlers — the single registry mapping a job type to its work.
 *
 * Shared by the HTTP-triggered in-process driver and the standalone worker so
 * both paths behave identically.
 */
import type { JobHandler, JobPayload } from '@/lib/queue';
import { runFullPipeline } from '@/lib/pipeline';
import {
  regenerateCaptions,
  regenerateScene,
  regenerateScriptAndDownstream,
  regenerateVoice,
  rerenderOnly,
} from '@/lib/regenerate';
import { log } from '@/lib/logging';

export type GenerationJobType =
  | 'FULL_PIPELINE'
  | 'SCRIPT'
  | 'SEO'
  | 'SCENES'
  | 'VISUAL'
  | 'VOICE'
  | 'CAPTIONS'
  | 'RENDER'
  | 'PUBLISH';

const handlers = new Map<string, JobHandler>();

function register(type: GenerationJobType, handler: JobHandler) {
  handlers.set(type, handler);
}

let registered = false;

/** Idempotent registration — safe to call from every request and the worker. */
export function registerGenerationHandler(): void {
  if (registered) return;
  registered = true;

  register('FULL_PIPELINE', async (payload) => {
    await runFullPipeline(payload, { skipResearch: !!payload.options.skipResearch });
  });

  register('SCRIPT', async (payload) => {
    await regenerateScriptAndDownstream(payload);
  });

  register('VOICE', async (payload) => {
    await regenerateVoice(payload);
  });

  register('CAPTIONS', async (payload) => {
    await regenerateCaptions(payload);
  });

  register('RENDER', async (payload) => {
    await rerenderOnly(payload);
  });

  // A visual-only job regenerates one scene's image and stops there.
  register('VISUAL', async (payload) => {
    const { regenerateVisual } = await import('@/lib/regenerate');
    await regenerateVisual(payload);
  });

  register('SCENES', async (payload) => {
    await regenerateScene(payload);
  });

  log.debug('jobs.handlers_registered', { count: handlers.size });
}

export function getHandler(type: string): JobHandler | undefined {
  registerGenerationHandler();
  return handlers.get(type);
}

export function allHandlers(): Map<string, JobHandler> {
  registerGenerationHandler();
  return handlers;
}

/** Execute a job payload through the registered handler. */
export async function runJob(payload: JobPayload): Promise<void> {
  const handler = getHandler(payload.type);
  if (!handler) {
    throw new Error(`No handler registered for job type "${payload.type}".`);
  }
  await handler(payload);
}
