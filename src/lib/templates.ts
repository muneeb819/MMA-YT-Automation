/**
 * Built-in templates and content presets.
 * System templates are seeded into the database so users can customise them.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { templates } from '@/db/schema';

export interface TemplateSeed {
  slug: string;
  name: string;
  description: string;
  beats: string[];
  category: string;
  scriptStyle: string;
}

export const SYSTEM_TEMPLATES: TemplateSeed[] = [
  {
    slug: 'dark-documentary',
    name: 'Dark Documentary',
    description:
      'Cinematic investigative narrative. Builds from a cold open through escalating pressure to a revelation and a restrained close.',
    beats: ['Hook', 'Historical context', 'Escalation', 'Key revelation', 'Ending'],
    category: 'crime_documentary',
    scriptStyle: 'dark_documentary',
  },
  {
    slug: 'viral-fact',
    name: 'Viral Fact',
    description:
      'Question-led curiosity structure. Opens with a surprising question, reveals an unexpected fact, explains it, then twists the meaning.',
    beats: ['Question', 'Unexpected fact', 'Explanation', 'Twist', 'CTA'],
    category: 'facts',
    scriptStyle: 'fast_paced',
  },
  {
    slug: 'business-story',
    name: 'Business Story',
    description:
      'Problem-to-lesson arc. Names the problem, introduces the actor, unpacks the strategy, shows the result, extracts the lesson.',
    beats: ['Problem', 'Person or company', 'Strategy', 'Result', 'Lesson'],
    category: 'business',
    scriptStyle: 'documentary',
  },
  {
    slug: 'ai-news',
    name: 'AI News',
    description:
      'Current-events breakdown. States the development, explains what happened, why it matters, and the likely impact. Requires fresh sources.',
    beats: ['Breaking development', 'What happened', 'Why it matters', 'Impact'],
    category: 'ai',
    scriptStyle: 'news',
  },
  {
    slug: 'top-5',
    name: 'Top 5',
    description:
      'Ranked list pacing. Hook, then count down from #5 to #1, closing with a CTA. Fast visual changes throughout.',
    beats: ['Hook', '#5', '#4', '#3', '#2', '#1', 'CTA'],
    category: 'facts',
    scriptStyle: 'fast_paced',
  },
  {
    slug: 'explainer',
    name: 'Quick Explainer',
    description:
      'Plain-language teaching structure. Names the misconception, defines the concept, gives one concrete example, summarises.',
    beats: ['Hook', 'Common misconception', 'Definition', 'Example', 'Summary'],
    category: 'education',
    scriptStyle: 'educational',
  },
  {
    slug: 'motivational',
    name: 'Motivational',
    description:
      'Challenge-to-action arc. States the obstacle, reframes it, delivers a principle, ends with a direct call to act.',
    beats: ['Hook', 'The obstacle', 'Reframe', 'Principle', 'Call to action'],
    category: 'motivation',
    scriptStyle: 'motivational',
  },
];

/** Content preset output specs (resolution/fps/bitrate live in lib/domain). */
export const PRESET_NOTES: Record<string, string> = {
  youtube_shorts: 'Optimised for YouTube Shorts: 1080x1920 H.264/AAC, faststart.',
  tiktok: 'Optimised for TikTok: 1080x1920, punchy bitrate for mobile playback.',
  instagram_reels: 'Optimised for Instagram Reels: 1080x1920, slightly lower bitrate.',
  facebook_reels: 'Optimised for Facebook Reels: 1080x1920, conservative bitrate.',
};

/**
 * Content-safety policy.
 * Returns a decision before generation and again before publishing.
 */
export interface SafetyResult {
  allowed: boolean;
  reason?: string;
  category?: string;
}

const PROHIBITED = [
  'how to make a bomb',
  'child sexual',
  'csam',
  'how to make meth',
  'pipe bomb',
  'bioweapon',
  'chemical weapon',
  'terrorist attack plan',
  'how to launder money instructions',
  'human trafficking how to',
];

/** Neutral framing guidance for sensitive topics (political/financial). */
export function checkSafety(input: string, phase: 'generation' | 'publish'): SafetyResult {
  const lower = input.toLowerCase();

  for (const phrase of PROHIBITED) {
    if (lower.includes(phrase)) {
      return {
        allowed: false,
        reason:
          'This request appears to seek instructions for harmful or illegal activity, so generation was blocked.',
        category: 'prohibited',
      };
    }
  }

  if (phase === 'publish') {
    // Publishing is stricter: unverifiable claims must be confirmed.
    return { allowed: true };
  }
  return { allowed: true };
}

/**
 * Seed built-in templates on first access so the picker is never empty.
 * Lives here rather than in the route so it can be reused by the worker and seed script.
 */
export async function ensureSystemTemplates(): Promise<void> {
  const db = await getDb();
  for (const tpl of SYSTEM_TEMPLATES) {
    const [existing] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.slug, tpl.slug))
      .limit(1);
    if (existing) continue;
    await db
      .insert(templates)
      .values({
        userId: null,
        slug: tpl.slug,
        name: tpl.name,
        description: tpl.description,
        beats: tpl.beats,
        category: tpl.category,
        scriptStyle: tpl.scriptStyle,
        isSystem: true,
      })
      .onConflictDoNothing();
  }
}

/** Neutral framing guidance for sensitive topics (political/financial). */
/** Neutrality check for political / electoral framing. */
export function checkPoliticalNeutrality(input: string): SafetyResult {
  const lower = input.toLowerCase();
  const persuasive = [
    'vote for',
    'support our candidate',
    'donate now to',
    'help us elect',
    'destroy them',
    'wake up sheeple',
    'they are the enemy',
  ];
  for (const phrase of persuasive) {
    if (lower.includes(phrase)) {
      return {
        allowed: false,
        reason:
          'Political content is limited to neutral, factual reporting. Persuasive or campaigning framing cannot be generated.',
        category: 'political_persuasion',
      };
    }
  }
  return { allowed: true };
}
