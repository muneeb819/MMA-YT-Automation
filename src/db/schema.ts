/**
 * ShortForge AI relational schema.
 *
 * Written against PostgreSQL. Locally the same schema runs on PGlite (embedded
 * Postgres), so SQL semantics, indexes and constraints are identical.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const projectStatus = pgEnum('project_status', [
  'DRAFT',
  'QUEUED',
  'RESEARCHING',
  'SCRIPTING',
  'SEO_GENERATING',
  'SCENE_PLANNING',
  'GENERATING_VISUALS',
  'GENERATING_VOICE',
  'GENERATING_CAPTIONS',
  'ASSEMBLING',
  'RENDERING',
  'QUALITY_CHECK',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const jobStatus = pgEnum('job_status', [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const jobType = pgEnum('job_type', [
  'FULL_PIPELINE',
  'SCRIPT',
  'SEO',
  'SCENES',
  'VISUAL',
  'VOICE',
  'CAPTIONS',
  'RENDER',
  'PUBLISH',
]);

export const mediaSourceType = pgEnum('media_source_type', [
  'USER_UPLOADED',
  'AI_GENERATED',
  'LICENSED_STOCK',
  'PUBLIC_DOMAIN',
  'GENERATED_BACKGROUND',
  'TEXT_ONLY',
]);

export const visualType = pgEnum('visual_type', [
  'image',
  'video',
  'stock',
  'background',
  'text',
]);

export const userRole = pgEnum('user_role', ['USER', 'ADMIN']);

export const privacyStatus = pgEnum('privacy_status', ['PRIVATE', 'UNLISTED', 'PUBLIC']);

export const providerName = pgEnum('provider_name', [
  'openai',
  'elevenlabs',
  'replicate',
  'creatomate',
  'cloudinary',
  'ffmpeg',
  'mock',
  'wikipedia',
  'youtube',
]);

// ---------------------------------------------------------------------------
// Tenancy + auth
// ---------------------------------------------------------------------------

export const organizations = pgTable('organizations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: userRole('role').notNull().default('USER'),
    organizationId: integer('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    passwordHash: text('password_hash'),
    imageUrl: text('image_url'),
    credits: integer('credits').notNull().default(100),
    onboarded: boolean('onboarded').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(sql`lower(${t.email})`),
    orgIdx: index('users_org_idx').on(t.organizationId),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('sessions_user_idx').on(t.userId) }),
);

// ---------------------------------------------------------------------------
// Settings + brand kit
// ---------------------------------------------------------------------------

export const userSettings = pgTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  defaultVoiceId: text('default_voice_id'),
  defaultVisualStyle: text('default_visual_style').notNull().default('cinematic'),
  defaultCaptionStyle: text('default_caption_style').notNull().default('bold'),
  defaultDuration: integer('default_duration').notNull().default(45),
  defaultMusic: text('default_music').notNull().default('cinematic'),
  defaultCategory: text('default_category').notNull().default('storytelling'),
  defaultLanguage: text('default_language').notNull().default('en'),
  defaultPreset: text('default_preset').notNull().default('youtube_shorts'),
  qualityMode: text('quality_mode').notNull().default('standard'),
  brandName: text('brand_name'),
  brandLogoUrl: text('brand_logo_url'),
  brandPrimaryColor: text('brand_primary_color'),
  brandSecondaryColor: text('brand_secondary_color'),
  brandFont: text('brand_font'),
  brandCta: text('brand_cta'),
  brandIntro: text('brand_intro'),
  brandOutro: text('brand_outro'),
  /** Per-user provider keys, only writable when ALLOW_USER_PROVIDER_KEYS is on. */
  openaiApiKey: text('openai_api_key'),
  elevenLabsApiKey: text('eleven_labs_api_key'),
  replicateApiToken: text('replicate_api_token'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const templates = pgTable(
  'templates',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    beats: jsonb('beats').notNull().$type<string[]>(),
    category: text('category').notNull().default('storytelling'),
    scriptStyle: text('script_style'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('templates_user_idx').on(t.userId),
    slugIdx: uniqueIndex('templates_slug_user_idx').on(sql`${t.slug}, coalesce(${t.userId}, '')`),
  }),
);

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    topic: text('topic').notNull(),
    category: text('category').notNull().default('storytelling'),
    status: projectStatus('status').notNull().default('DRAFT'),
    targetDuration: integer('target_duration').notNull().default(45),
    actualDuration: real('actual_duration').notNull().default(0),
    scriptStyle: text('script_style').notNull().default('documentary'),
    visualStyle: text('visual_style').notNull().default('cinematic'),
    captionStyle: text('caption_style').notNull().default('bold'),
    musicStyle: text('music_style').notNull().default('cinematic'),
    musicVolume: real('music_volume').notNull().default(0.18),
    voiceId: text('voice_id'),
    voiceName: text('voice_name'),
    voiceSpeed: real('voice_speed').notNull().default(1),
    language: text('language').notNull().default('en'),
    preset: text('preset').notNull().default('youtube_shorts'),
    templateId: integer('template_id').references(() => templates.id, { onDelete: 'set null' }),
    qualityMode: text('quality_mode').notNull().default('standard'),
    thumbnailUrl: text('thumbnail_url'),
    publishedVideoId: text('published_video_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    currentVersion: integer('current_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('projects_user_id_idx').on(t.userId),
    statusIdx: index('projects_status_idx').on(t.status),
    createdIdx: index('projects_user_created_idx').on(t.userId, t.createdAt),
  }),
);

export const projectVersions = pgTable(
  'project_versions',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    label: text('label'),
    snapshot: jsonb('snapshot').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('project_versions_project_idx').on(t.projectId, t.version),
    uniq: uniqueIndex('project_versions_uniq_idx').on(t.projectId, t.version),
  }),
);

export const scripts = pgTable(
  'scripts',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    hook: text('hook').notNull().default(''),
    body: text('body').notNull().default(''),
    cta: text('cta').notNull().default(''),
    version: integer('version').notNull().default(1),
    wordCount: integer('word_count').notNull().default(0),
    estimatedDuration: real('estimated_duration').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('scripts_project_idx').on(t.projectId),
    uniq: uniqueIndex('scripts_project_version_idx').on(t.projectId, t.version),
  }),
);

export const seoMetadata = pgTable(
  'seo_metadata',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    titleVariants: jsonb('title_variants').notNull().$type<string[]>().default([]),
    description: text('description').notNull().default(''),
    hashtags: jsonb('hashtags').notNull().$type<string[]>().default([]),
    tags: jsonb('tags').notNull().$type<string[]>().default([]),
    keywords: jsonb('keywords')
      .notNull()
      .$type<{ primary: string[]; secondary: string[] }>()
      .default({ primary: [], secondary: [] }),
    hookScore: jsonb('hook_score')
      .notNull()
      .$type<{ curiosity: number; clarity: number; emotionalPull: number; specificity: number; overall: number }>()
      .default({
        curiosity: 0,
        clarity: 0,
        emotionalPull: 0,
        specificity: 0,
        overall: 0,
      }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ projectIdx: uniqueIndex('seo_metadata_project_idx').on(t.projectId) }),
);

export const scenes = pgTable(
  'scenes',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sceneNumber: integer('scene_number').notNull(),
    narration: text('narration').notNull().default(''),
    visualPrompt: text('visual_prompt').notNull().default(''),
    visualUrl: text('visual_url'),
    visualType: visualType('visual_type').notNull().default('image'),
    sourceType: mediaSourceType('source_type').notNull().default('AI_GENERATED'),
    sourceProvider: text('source_provider'),
    sourceUrl: text('source_url'),
    licenseNote: text('license_note'),
    duration: real('duration').notNull().default(0),
    startTime: real('start_time').notNull().default(0),
    caption: text('caption').notNull().default(''),
    transition: text('transition').notNull().default('fade'),
    status: text('status').notNull().default('PENDING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('scenes_project_id_idx').on(t.projectId, t.sceneNumber),
    uniq: uniqueIndex('scenes_project_number_idx').on(t.projectId, t.sceneNumber),
  }),
);

export const researchSources = pgTable(
  'research_sources',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fact: text('fact').notNull(),
    sourceUrl: text('source_url'),
    sourceName: text('source_name'),
    verified: boolean('verified').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ projectIdx: index('research_sources_project_idx').on(t.projectId) }),
);

export const audioAssets = pgTable(
  'audio_assets',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    voiceId: text('voice_id'),
    voiceName: text('voice_name'),
    provider: providerName('provider').notNull().default('mock'),
    generationId: text('generation_id'),
    audioUrl: text('audio_url').notNull(),
    storageKey: text('storage_key'),
    duration: real('duration').notNull().default(0),
    settings: jsonb('settings')
      .notNull()
      .$type<Record<string, unknown>>()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ projectIdx: index('audio_assets_project_idx').on(t.projectId) }),
);

export const videoAssets = pgTable(
  'video_assets',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    provider: providerName('provider').notNull().default('mock'),
    videoUrl: text('video_url').notNull(),
    storageKey: text('storage_key'),
    thumbnailUrl: text('thumbnail_url'),
    duration: real('duration').notNull().default(0),
    resolution: text('resolution').notNull().default('1080x1920'),
    fps: integer('fps').notNull().default(30),
    sizeBytes: integer('size_bytes').notNull().default(0),
    checksum: text('checksum'),
    qcReport: jsonb('qc_report').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ projectIdx: index('video_assets_project_idx').on(t.projectId) }),
);

export const captionAssets = pgTable(
  'caption_assets',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    srtUrl: text('srt_url'),
    vttUrl: text('vtt_url'),
    words: jsonb('words')
      .notNull()
      .$type<{ word: string; start: number; end: number }[]>()
      .default([]),
    provider: providerName('provider').notNull().default('mock'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ projectIdx: index('caption_assets_project_idx').on(t.projectId) }),
);

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const generationJobs = pgTable(
  'generation_jobs',
  {
    id: serial('id').primaryKey(),
    publicId: text('public_id').notNull(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: jobType('type').notNull(),
    status: jobStatus('status').notNull().default('QUEUED'),
    stage: projectStatus('stage').notNull().default('QUEUED'),
    progress: integer('progress').notNull().default(0),
    stageDetail: text('stage_detail'),
    error: text('error'),
    errorDetail: text('error_detail'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>().default({}),
    creditsCharged: integer('credits_charged').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('generation_jobs_status_idx').on(t.status),
    projectIdx: index('generation_jobs_project_id_idx').on(t.projectId),
    userIdx: index('generation_jobs_user_idx').on(t.userId, t.createdAt),
    publicIdx: uniqueIndex('generation_jobs_public_id_idx').on(t.publicId),
  }),
);

export const jobEvents = pgTable(
  'job_events',
  {
    id: serial('id').primaryKey(),
    jobId: integer('job_id')
      .notNull()
      .references(() => generationJobs.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    progress: integer('progress').notNull().default(0),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ jobIdx: index('job_events_job_idx').on(t.jobId, t.id) }),
);

export const usage = pgTable(
  'usage',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    credits: integer('credits').notNull().default(0),
    estimatedCostUsd: real('estimated_cost_usd').notNull().default(0),
    provider: text('provider'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('usage_user_id_idx').on(t.userId, t.createdAt),
    opIdx: index('usage_operation_idx').on(t.operation),
  }),
);

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

export const youtubeConnections = pgTable(
  'youtube_connections',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    channelName: text('channel_name').notNull(),
    channelThumbnail: text('channel_thumbnail'),
    encryptedAccessToken: text('encrypted_access_token'),
    encryptedRefreshToken: text('encrypted_refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex('youtube_connections_user_id_idx').on(t.userId),
  }),
);

export const publishRecords = pgTable(
  'publish_records',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    youtubeVideoId: text('youtube_video_id'),
    url: text('url'),
    privacy: privacyStatus('privacy').notNull().default('PRIVATE'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ projectIdx: index('publish_records_project_idx').on(t.projectId) }),
);

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export const requestLogs = pgTable(
  'request_logs',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id'),
    projectId: integer('project_id'),
    jobId: integer('job_id'),
    jobPublicId: text('job_public_id'),
    operation: text('operation').notNull(),
    provider: text('provider'),
    status: text('status').notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('request_logs_user_idx').on(t.userId, t.createdAt),
    jobIdx: index('request_logs_job_idx').on(t.jobPublicId),
  }),
);

export const providerHealth = pgTable('provider_health', {
  provider: text('provider').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  status: text('status').notNull().default('unknown'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastError: text('last_error'),
  failureCount: integer('failure_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many, one }) => ({
  projects: many(projects),
  settings: one(userSettings),
  youtube: one(youtubeConnections),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  script: one(scripts),
  seo: one(seoMetadata),
  scenes: many(scenes),
  audio: many(audioAssets),
  videos: many(videoAssets),
  captions: many(captionAssets),
  jobs: many(generationJobs),
  sources: many(researchSources),
  versions: many(projectVersions),
}));

export const scenesRelations = relations(scenes, ({ one }) => ({
  project: one(projects, { fields: [scenes.projectId], references: [projects.id] }),
}));

export const generationJobsRelations = relations(generationJobs, ({ one, many }) => ({
  project: one(projects, { fields: [generationJobs.projectId], references: [projects.id] }),
  events: many(jobEvents),
}));

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Scene = typeof scenes.$inferSelect;
export type Script = typeof scripts.$inferSelect;
export type SeoMetadata = typeof seoMetadata.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type YoutubeConnection = typeof youtubeConnections.$inferSelect;
export type VideoAsset = typeof videoAssets.$inferSelect;
export type AudioAsset = typeof audioAssets.$inferSelect;
