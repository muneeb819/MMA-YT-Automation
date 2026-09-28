/**
 * Domain constants and option catalogues.
 * Single source of truth for the UI, validation and the generation engine.
 */

export const CONTENT_CATEGORIES = [
  'education',
  'history',
  'crime_documentary',
  'business',
  'technology',
  'ai',
  'finance',
  'motivation',
  'facts',
  'storytelling',
  'news',
  'entertainment',
  'custom',
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ContentCategory, string> = {
  education: 'Education',
  history: 'History',
  crime_documentary: 'Crime Documentary',
  business: 'Business',
  technology: 'Technology',
  ai: 'AI',
  finance: 'Finance',
  motivation: 'Motivation',
  facts: 'Facts',
  storytelling: 'Storytelling',
  news: 'News',
  entertainment: 'Entertainment',
  custom: 'Custom',
};

export const SCRIPT_STYLES = [
  'documentary',
  'cinematic',
  'fast_paced',
  'educational',
  'storytelling',
  'dark_documentary',
  'news',
  'motivational',
  'conversational',
] as const;
export type ScriptStyle = (typeof SCRIPT_STYLES)[number];

export const SCRIPT_STYLE_LABELS: Record<ScriptStyle, string> = {
  documentary: 'Documentary',
  cinematic: 'Cinematic',
  fast_paced: 'Fast-paced',
  educational: 'Educational',
  storytelling: 'Storytelling',
  dark_documentary: 'Dark Documentary',
  news: 'News',
  motivational: 'Motivational',
  conversational: 'Conversational',
};

/** Durations offered in the UI. Max is configurable — see `assertDurationAllowed`. */
export const TARGET_DURATIONS = [15, 30, 45, 60, 90] as const;
export const MAX_TARGET_DURATION = 180;

export const VISUAL_STYLES = [
  'cinematic',
  'documentary',
  'realistic',
  'dark_noir',
  'anime',
  'comic',
  'graphic_novel',
  'minimal',
  'corporate',
  'futuristic',
  'custom',
] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number];

export const VISUAL_STYLE_LABELS: Record<VisualStyle, string> = {
  cinematic: 'Cinematic',
  documentary: 'Documentary',
  realistic: 'Realistic',
  dark_noir: 'Dark Noir',
  anime: 'Anime',
  comic: 'Comic',
  graphic_novel: 'Graphic Novel',
  minimal: 'Minimal',
  corporate: 'Corporate',
  futuristic: 'Futuristic',
  custom: 'Custom',
};

export const CAPTION_STYLES = [
  'clean',
  'bold',
  'cinematic',
  'highlighted',
  'documentary',
  'minimal',
] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export const CAPTION_STYLE_LABELS: Record<CaptionStyle, string> = {
  clean: 'Clean',
  bold: 'Bold',
  cinematic: 'Cinematic',
  highlighted: 'Highlighted',
  documentary: 'Documentary',
  minimal: 'Minimal',
};

export const MUSIC_STYLES = ['none', 'cinematic', 'suspense', 'corporate', 'emotional', 'energetic'] as const;
export type MusicStyle = (typeof MUSIC_STYLES)[number];

export const MUSIC_STYLE_LABELS: Record<MusicStyle, string> = {
  none: 'None',
  cinematic: 'Cinematic',
  suspense: 'Suspense',
  corporate: 'Corporate',
  emotional: 'Emotional',
  energetic: 'Energetic',
};

export const QUALITY_MODES = ['draft', 'standard', 'premium'] as const;
export type QualityMode = (typeof QUALITY_MODES)[number];

export const PRESETS = ['youtube_shorts', 'tiktok', 'instagram_reels', 'facebook_reels'] as const;
export type Preset = (typeof PRESETS)[number];

export const PRESET_LABELS: Record<Preset, string> = {
  youtube_shorts: 'YouTube Shorts',
  tiktok: 'TikTok',
  instagram_reels: 'Instagram Reels',
  facebook_reels: 'Facebook Reels',
};

export const TRANSITIONS = ['fade', 'cut', 'dissolve', 'slide', 'zoom'] as const;
export type Transition = (typeof TRANSITIONS)[number];

/** Aspect + resolution per content preset. All outputs are vertical 9:16. */
export const PRESET_VIDEO_SPECS: Record<Preset, { width: number; height: number; fps: number; bitrate: string }> = {
  youtube_shorts: { width: 1080, height: 1920, fps: 30, bitrate: '8M' },
  tiktok: { width: 1080, height: 1920, fps: 30, bitrate: '8M' },
  instagram_reels: { width: 1080, height: 1920, fps: 30, bitrate: '7M' },
  facebook_reels: { width: 1080, height: 1920, fps: 30, bitrate: '6M' },
};

/** Categories that must be grounded in fresh sources. */
export const FRESH_SOURCE_CATEGORIES: ReadonlySet<string> = new Set([
  'news',
  'finance',
  'technology',
  'ai',
]);

/** Political framing guardrail. */
export const POLITICAL_SENSITIVE_CATEGORIES: ReadonlySet<string> = new Set(['news', 'finance']);

/** Narration pacing. Base band is 2.0–2.8 words/sec per the spec. */
export const WORDS_PER_SECOND_MIN = 2.0;
export const WORDS_PER_SECOND_MAX = 2.8;
export const WORDS_PER_SECOND_DEFAULT = 2.4;

export function assertDurationAllowed(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 5) {
    throw new Error('Target duration must be at least 5 seconds.');
  }
  if (seconds > MAX_TARGET_DURATION) {
    throw new Error(
      `Target duration must be ${MAX_TARGET_DURATION}s or less. Note: YouTube Shorts currently caps ` +
        `vertical uploads at ${MAX_TARGET_DURATION}s — verify current platform limits before publishing.`,
    );
  }
}
