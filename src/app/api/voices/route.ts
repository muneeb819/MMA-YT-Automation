import { requireUser } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { getVoice } from '@/providers/registry';
import { MOCK_MODE } from '@/lib/config';
import { log } from '@/lib/logging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/voices
 *
 * Returns voices from the configured provider. When ElevenLabs is not
 * configured the demo voice set is returned and `configured: false` tells the
 * UI to show the demo badge rather than pretending these are ElevenLabs voices.
 */
export const GET = route(async () => {
  await requireUser();
  const provider = getVoice();

  if (!provider.isConfigured()) {
    const voices = await provider.listVoices();
    return ok({
      voices,
      provider: 'mock',
      configured: false,
      demoMode: MOCK_MODE,
      message: 'Demo voices are in use. Add ELEVENLABS_API_KEY to load your ElevenLabs voice library.',
    });
  }

  const voices = await provider.listVoices();
  return ok({
    voices,
    provider: provider.name,
    configured: true,
    demoMode: MOCK_MODE,
    message: null,
  });
}, { route: 'GET /api/voices' });
