import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { userSettings, users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { config } from '@/lib/config';
import { encryptSecret } from '@/lib/security';
import { sanitizeText } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  defaultVoiceId: z.string().max(120).optional(),
  defaultVoiceName: z.string().max(120).optional(),
  defaultVisualStyle: z.string().max(40).optional(),
  defaultCaptionStyle: z.string().max(40).optional(),
  defaultDuration: z.number().int().min(5).max(180).optional(),
  defaultMusic: z.string().max(40).optional(),
  defaultCategory: z.string().max(40).optional(),
  defaultLanguage: z.string().max(10).optional(),
  defaultPreset: z.string().max(40).optional(),
  qualityMode: z.enum(['draft', 'standard', 'premium']).optional(),
  brandName: z.string().max(120).optional(),
  brandLogoUrl: z.string().max(500).optional(),
  brandPrimaryColor: z.string().max(20).optional(),
  brandSecondaryColor: z.string().max(20).optional(),
  brandFont: z.string().max(80).optional(),
  brandCta: z.string().max(200).optional(),
  brandIntro: z.string().max(500).optional(),
  brandOutro: z.string().max(500).optional(),
  // Only accepted when ALLOW_USER_PROVIDER_KEYS is enabled.
  openaiApiKey: z.string().max(200).optional(),
  elevenLabsApiKey: z.string().max(200).optional(),
  replicateApiToken: z.string().max(200).optional(),
});

/** GET /api/settings — settings plus which providers are wired up. */
export const GET = route(async () => {
  const user = await requireUser();
  const db = await getDb();
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);

  // Secrets are never returned. Only whether one is set.
  const sanitised = row
    ? {
        ...row,
        openaiApiKey: row.openaiApiKey ? '[set]' : null,
        elevenLabsApiKey: row.elevenLabsApiKey ? '[set]' : null,
        replicateApiToken: row.replicateApiToken ? '[set]' : null,
      }
    : null;

  return ok({
    settings: sanitised,
    providers: {
      openai: config.llm.configured,
      elevenlabs: config.voice.configured,
      replicate: config.replicate.configured,
      creatomate: config.creatomate.configured,
      youtube: config.youtube.configured,
      storage: config.storage.driver,
      userKeysAllowed: config.auth.allowUserProviderKeys,
    },
    mockMode: config.isProd ? undefined : true,
  });
}, { route: 'GET /api/settings' });

/** PATCH /api/settings — autosave settings and brand kit. */
export const PATCH = route(async (request: Request) => {
  const user = await requireUser();
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Invalid input.', 400, 'VALIDATION');
  }

  const input = parsed.data;
  const db = await getDb();

  // Reject provider keys when the feature is off rather than silently dropping.
  if (!config.auth.allowUserProviderKeys) {
    if (input.openaiApiKey || input.elevenLabsApiKey || input.replicateApiToken) {
      return fail(
        'Per-user API keys are disabled on this deployment. Set them as server environment variables instead.',
        403,
        'USER_KEYS_DISABLED',
      );
    }
  }

  await db.insert(userSettings).values({ userId: user.id }).onConflictDoNothing();

  const text = (v: string | undefined) => (v === undefined ? undefined : sanitizeText(v, 500));

  await db
    .update(userSettings)
    .set({
      ...(input.defaultVoiceId !== undefined ? { defaultVoiceId: input.defaultVoiceId } : {}),
      ...(input.defaultVisualStyle ? { defaultVisualStyle: input.defaultVisualStyle } : {}),
      ...(input.defaultCaptionStyle ? { defaultCaptionStyle: input.defaultCaptionStyle } : {}),
      ...(input.defaultDuration !== undefined ? { defaultDuration: input.defaultDuration } : {}),
      ...(input.defaultMusic ? { defaultMusic: input.defaultMusic } : {}),
      ...(input.defaultCategory ? { defaultCategory: input.defaultCategory } : {}),
      ...(input.defaultLanguage ? { defaultLanguage: input.defaultLanguage } : {}),
      ...(input.defaultPreset ? { defaultPreset: input.defaultPreset } : {}),
      ...(input.qualityMode ? { qualityMode: input.qualityMode } : {}),
      ...(text(input.brandName) !== undefined ? { brandName: text(input.brandName) } : {}),
      ...(text(input.brandLogoUrl) !== undefined ? { brandLogoUrl: text(input.brandLogoUrl) } : {}),
      ...(text(input.brandPrimaryColor) !== undefined ? { brandPrimaryColor: text(input.brandPrimaryColor) } : {}),
      ...(text(input.brandSecondaryColor) !== undefined ? { brandSecondaryColor: text(input.brandSecondaryColor) } : {}),
      ...(text(input.brandFont) !== undefined ? { brandFont: text(input.brandFont) } : {}),
      ...(text(input.brandCta) !== undefined ? { brandCta: text(input.brandCta) } : {}),
      ...(text(input.brandIntro) !== undefined ? { brandIntro: text(input.brandIntro) } : {}),
      ...(text(input.brandOutro) !== undefined ? { brandOutro: text(input.brandOutro) } : {}),
      ...(input.openaiApiKey ? { openaiApiKey: encryptSecret(input.openaiApiKey) } : {}),
      ...(input.elevenLabsApiKey ? { elevenLabsApiKey: encryptSecret(input.elevenLabsApiKey) } : {}),
      ...(input.replicateApiToken ? { replicateApiToken: encryptSecret(input.replicateApiToken) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(userSettings.userId, user.id));

  const [updated] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);

  return ok({
    saved: true,
    settings: {
      ...updated,
      openaiApiKey: updated?.openaiApiKey ? '[set]' : null,
      elevenLabsApiKey: updated?.elevenLabsApiKey ? '[set]' : null,
      replicateApiToken: updated?.replicateApiToken ? '[set]' : null,
    },
  });
}, { route: 'PATCH /api/settings' });
