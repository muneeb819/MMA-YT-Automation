/**
 * Credit system.
 *
 * Costs are configuration, not hard-coded constants spread through the app.
 * Every expensive operation is charged atomically and refunded on failure.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { usage, users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export type Operation =
  | 'research'
  | 'script'
  | 'seo'
  | 'scenes'
  | 'voice'
  | 'image'
  | 'video'
  | 'captions'
  | 'render'
  | 'publish'
  | 'script_regen'
  | 'visual_regen';

export const CREDIT_COSTS: Record<Operation, number> = {
  research: 1,
  script: 1,
  seo: 1,
  scenes: 0,
  voice: 2,
  image: 1,
  video: 5,
  captions: 0,
  render: 2,
  publish: 0,
  script_regen: 1,
  visual_regen: 1,
};

/** Rough provider cost estimates, used only for the admin cost view. */
export const COST_USD: Partial<Record<Operation, number>> = {
  script: 0.002,
  seo: 0.001,
  research: 0.003,
  voice: 0.02,
  image: 0.004,
  video: 0.12,
  render: 0.0,
};

export function costOf(...ops: Operation[]): number {
  return ops.reduce((sum, op) => sum + (CREDIT_COSTS[op] ?? 0), 0);
}

export class InsufficientCreditsError extends Error {
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(
      `This operation will use approximately ${required} credits. ` +
        `You have ${available} available.`,
    );
    this.name = 'InsufficientCreditsError';
  }
}

export interface CreditResult {
  charged: number;
  balance: number;
}

/**
 * Atomically charge credits. Uses a conditional UPDATE so two concurrent jobs
 * cannot both spend the same balance.
 */
export async function chargeCredits(
  userId: string,
  ops: Operation[],
  metadata: Record<string, unknown> = {},
): Promise<CreditResult> {
  const required = costOf(...ops);
  if (required <= 0) {
    return { charged: 0, balance: await getBalance(userId) };
  }

  const db = await getDb();

  const updated = await db
    .update(users)
    .set({ credits: sql`${users.credits} - ${required}`, updatedAt: new Date() })
    .where(sql`${users.id} = ${userId} AND ${users.credits} >= ${required}`)
    .returning({ credits: users.credits });

  if (updated.length === 0) {
    const balance = await getBalance(userId);
    throw new InsufficientCreditsError(required, balance);
  }

  await db.insert(usage).values({
    userId,
    operation: ops.join('+'),
    credits: -required,
    estimatedCostUsd: ops.reduce((s, o) => s + (COST_USD[o] ?? 0), 0),
    metadata,
  });

  return { charged: required, balance: updated[0].credits };
}

/** Return credits when a charged operation ultimately fails. */
export async function refundCredits(
  userId: string,
  ops: Operation[],
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const amount = costOf(...ops);
  if (amount <= 0) return;
  const db = await getDb();
  await db
    .update(users)
    .set({ credits: sql`${users.credits} + ${amount}`, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await db.insert(usage).values({
    userId,
    operation: `${ops.join('+')}:refund`,
    credits: amount,
    metadata,
  });
}

export async function getBalance(userId: string): Promise<number> {
  const db = await getDb();
  const [user] = await db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.credits ?? 0;
}

/** Estimate shown in the UI before an expensive operation runs. */
export function estimateCost(opts: {
  durationSeconds: number;
  sceneCount: number;
  qualityMode: 'draft' | 'standard' | 'premium';
}): { credits: number; seconds: number; breakdown: Record<string, number> } {
  // Scenes drive both image count and render time.
  const images = Math.max(1, opts.sceneCount);
  const videoGen = opts.qualityMode === 'premium' ? Math.ceil(images / 2) : 0;

  const breakdown: Record<string, number> = {
    script: CREDIT_COSTS.script,
    seo: CREDIT_COSTS.seo,
    voice: CREDIT_COSTS.voice,
    image: images * CREDIT_COSTS.image,
    video: videoGen * CREDIT_COSTS.video,
    render: CREDIT_COSTS.render,
  };

  const credits = Object.values(breakdown).reduce((a, b) => a + b, 0);

  // Rough wall-clock estimate: model calls dominate, render scales with duration.
  const modelSeconds = 12 + images * (opts.qualityMode === 'premium' ? 9 : 4);
  const renderSeconds = opts.durationSeconds * (opts.qualityMode === 'draft' ? 1.2 : 2.4);

  return { credits, seconds: Math.round(modelSeconds + renderSeconds), breakdown };
}
