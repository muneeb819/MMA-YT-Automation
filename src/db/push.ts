/**
 * Idempotent schema bootstrap.
 *
 * Uses `CREATE TABLE IF NOT EXISTS` so the same code works on PGlite and
 * PostgreSQL. For production schema evolution use `drizzle-kit generate` +
 * `drizzle-kit migrate`; this script guarantees a working local/dev database.
 */
import { sql } from 'drizzle-orm';
import { getDb } from './index';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS organizations (
     id SERIAL PRIMARY KEY,
     name TEXT NOT NULL,
     slug TEXT NOT NULL UNIQUE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     name TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'USER',
     organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
     password_hash TEXT,
     image_url TEXT,
     credits INTEGER NOT NULL DEFAULT 100,
     onboarded BOOLEAN NOT NULL DEFAULT FALSE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (lower(email))`,
  `CREATE INDEX IF NOT EXISTS users_org_idx ON users (organization_id)`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at TIMESTAMPTZ NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`,

  `CREATE TABLE IF NOT EXISTS user_settings (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     default_voice_id TEXT,
     default_visual_style TEXT NOT NULL DEFAULT 'cinematic',
     default_caption_style TEXT NOT NULL DEFAULT 'bold',
     default_duration INTEGER NOT NULL DEFAULT 45,
     default_music TEXT NOT NULL DEFAULT 'cinematic',
     default_category TEXT NOT NULL DEFAULT 'storytelling',
     default_language TEXT NOT NULL DEFAULT 'en',
     default_preset TEXT NOT NULL DEFAULT 'youtube_shorts',
     quality_mode TEXT NOT NULL DEFAULT 'standard',
     brand_name TEXT,
     brand_logo_url TEXT,
     brand_primary_color TEXT,
     brand_secondary_color TEXT,
     brand_font TEXT,
     brand_cta TEXT,
     brand_intro TEXT,
     brand_outro TEXT,
     openai_api_key TEXT,
     eleven_labs_api_key TEXT,
     replicate_api_token TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE TABLE IF NOT EXISTS templates (
     id SERIAL PRIMARY KEY,
     user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
     slug TEXT NOT NULL,
     name TEXT NOT NULL,
     description TEXT,
     beats JSONB NOT NULL DEFAULT '[]'::jsonb,
     category TEXT NOT NULL DEFAULT 'storytelling',
     script_style TEXT,
     is_system BOOLEAN NOT NULL DEFAULT FALSE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS templates_user_idx ON templates (user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS templates_slug_user_idx ON templates (slug, COALESCE(user_id, ''))`,

  `DO $$ BEGIN
     CREATE TYPE project_status AS ENUM ('DRAFT','QUEUED','RESEARCHING','SCRIPTING','SEO_GENERATING',
       'SCENE_PLANNING','GENERATING_VISUALS','GENERATING_VOICE','GENERATING_CAPTIONS','ASSEMBLING',
       'RENDERING','QUALITY_CHECK','COMPLETED','FAILED','CANCELLED');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     CREATE TYPE job_status AS ENUM ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     CREATE TYPE job_type AS ENUM ('FULL_PIPELINE','SCRIPT','SEO','SCENES','VISUAL','VOICE','CAPTIONS','RENDER','PUBLISH');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     CREATE TYPE media_source_type AS ENUM ('USER_UPLOADED','AI_GENERATED','LICENSED_STOCK',
       'PUBLIC_DOMAIN','GENERATED_BACKGROUND','TEXT_ONLY');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     CREATE TYPE visual_type AS ENUM ('image','video','stock','background','text');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     CREATE TYPE user_role AS ENUM ('USER','ADMIN');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     CREATE TYPE privacy_status AS ENUM ('PRIVATE','UNLISTED','PUBLIC');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     CREATE TYPE provider_name AS ENUM ('openai','elevenlabs','replicate','creatomate',
       'cloudinary','ffmpeg','mock','wikipedia','youtube');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `CREATE TABLE IF NOT EXISTS projects (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     topic TEXT NOT NULL,
     category TEXT NOT NULL DEFAULT 'storytelling',
     status project_status NOT NULL DEFAULT 'DRAFT',
     target_duration INTEGER NOT NULL DEFAULT 45,
     actual_duration REAL NOT NULL DEFAULT 0,
     script_style TEXT NOT NULL DEFAULT 'documentary',
     visual_style TEXT NOT NULL DEFAULT 'cinematic',
     caption_style TEXT NOT NULL DEFAULT 'bold',
     music_style TEXT NOT NULL DEFAULT 'cinematic',
     music_volume REAL NOT NULL DEFAULT 0.18,
     voice_id TEXT,
     voice_name TEXT,
     voice_speed REAL NOT NULL DEFAULT 1,
     language TEXT NOT NULL DEFAULT 'en',
     preset TEXT NOT NULL DEFAULT 'youtube_shorts',
     template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
     quality_mode TEXT NOT NULL DEFAULT 'standard',
     thumbnail_url TEXT,
     published_video_id TEXT,
     published_at TIMESTAMPTZ,
     current_version INTEGER NOT NULL DEFAULT 1,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects (user_id)`,
  `CREATE INDEX IF NOT EXISTS projects_status_idx ON projects (status)`,
  `CREATE INDEX IF NOT EXISTS projects_user_created_idx ON projects (user_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS project_versions (
     id SERIAL PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     version INTEGER NOT NULL,
     label TEXT,
     snapshot JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS project_versions_uniq_idx ON project_versions (project_id, version)`,
  `CREATE INDEX IF NOT EXISTS project_versions_project_idx ON project_versions (project_id, version)`,

  `CREATE TABLE IF NOT EXISTS scripts (
     id SERIAL PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     hook TEXT NOT NULL DEFAULT '',
     body TEXT NOT NULL DEFAULT '',
     cta TEXT NOT NULL DEFAULT '',
     version INTEGER NOT NULL DEFAULT 1,
     word_count INTEGER NOT NULL DEFAULT 0,
     estimated_duration REAL NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS scripts_project_version_idx ON scripts (project_id, version)`,
  `CREATE INDEX IF NOT EXISTS scripts_project_idx ON scripts (project_id)`,

  `CREATE TABLE IF NOT EXISTS seo_metadata (
     id SERIAL PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     title TEXT NOT NULL DEFAULT '',
     title_variants JSONB NOT NULL DEFAULT '[]'::jsonb,
     description TEXT NOT NULL DEFAULT '',
     hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
     tags JSONB NOT NULL DEFAULT '[]'::jsonb,
     keywords JSONB NOT NULL DEFAULT '{"primary":[],"secondary":[]}'::jsonb,
     hook_score JSONB NOT NULL DEFAULT '{"curiosity":0,"clarity":0,"emotionalPull":0,"specificity":0,"overall":0}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_metadata_project_idx ON seo_metadata (project_id)`,

  `CREATE TABLE IF NOT EXISTS scenes (
     id SERIAL PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     scene_number INTEGER NOT NULL,
     narration TEXT NOT NULL DEFAULT '',
     visual_prompt TEXT NOT NULL DEFAULT '',
     visual_url TEXT,
     visual_type visual_type NOT NULL DEFAULT 'image',
     source_type media_source_type NOT NULL DEFAULT 'AI_GENERATED',
     source_provider TEXT,
     source_url TEXT,
     license_note TEXT,
     duration REAL NOT NULL DEFAULT 0,
     start_time REAL NOT NULL DEFAULT 0,
     caption TEXT NOT NULL DEFAULT '',
     transition TEXT NOT NULL DEFAULT 'fade',
     status TEXT NOT NULL DEFAULT 'PENDING',
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS scenes_project_number_idx ON scenes (project_id, scene_number)`,
  `CREATE INDEX IF NOT EXISTS scenes_project_id_idx ON scenes (project_id, scene_number)`,

  `CREATE TABLE IF NOT EXISTS research_sources (
     id SERIAL PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     fact TEXT NOT NULL,
     source_url TEXT,
     source_name TEXT,
     verified BOOLEAN NOT NULL DEFAULT FALSE,
     notes TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS research_sources_project_idx ON research_sources (project_id)`,

  `CREATE TABLE IF NOT EXISTS audio_assets (
     id SERIAL PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     voice_id TEXT,
     voice_name TEXT,
     provider provider_name NOT NULL DEFAULT 'mock',
     generation_id TEXT,
     audio_url TEXT NOT NULL,
     storage_key TEXT,
     duration REAL NOT NULL DEFAULT 0,
     settings JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS audio_assets_project_idx ON audio_assets (project_id)`,

  `CREATE TABLE IF NOT EXISTS video_assets (
     id SERIAL PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     provider provider_name NOT NULL DEFAULT 'mock',
     video_url TEXT NOT NULL,
     storage_key TEXT,
     thumbnail_url TEXT,
     duration REAL NOT NULL DEFAULT 0,
     resolution TEXT NOT NULL DEFAULT '1080x1920',
     fps INTEGER NOT NULL DEFAULT 30,
     size_bytes INTEGER NOT NULL DEFAULT 0,
     checksum TEXT,
     qc_report JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS video_assets_project_idx ON video_assets (project_id)`,

  `CREATE TABLE IF NOT EXISTS caption_assets (
     id SERIAL PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     srt_url TEXT,
     vtt_url TEXT,
     words JSONB NOT NULL DEFAULT '[]'::jsonb,
     provider provider_name NOT NULL DEFAULT 'mock',
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS caption_assets_project_idx ON caption_assets (project_id)`,

  `CREATE TABLE IF NOT EXISTS generation_jobs (
     id SERIAL PRIMARY KEY,
     public_id TEXT NOT NULL,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     type job_type NOT NULL,
     status job_status NOT NULL DEFAULT 'QUEUED',
     stage project_status NOT NULL DEFAULT 'QUEUED',
     progress INTEGER NOT NULL DEFAULT 0,
     stage_detail TEXT,
     error TEXT,
     error_detail TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     max_attempts INTEGER NOT NULL DEFAULT 3,
     cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
     payload JSONB NOT NULL DEFAULT '{}'::jsonb,
     credits_charged INTEGER NOT NULL DEFAULT 0,
     started_at TIMESTAMPTZ,
     completed_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_public_id_idx ON generation_jobs (public_id)`,
  `CREATE INDEX IF NOT EXISTS generation_jobs_status_idx ON generation_jobs (status)`,
  `CREATE INDEX IF NOT EXISTS generation_jobs_project_id_idx ON generation_jobs (project_id)`,
  `CREATE INDEX IF NOT EXISTS generation_jobs_user_idx ON generation_jobs (user_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS job_events (
     id SERIAL PRIMARY KEY,
     job_id INTEGER NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
     stage TEXT NOT NULL,
     progress INTEGER NOT NULL DEFAULT 0,
     message TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS job_events_job_idx ON job_events (job_id, id)`,

  `CREATE TABLE IF NOT EXISTS usage (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     operation TEXT NOT NULL,
     credits INTEGER NOT NULL DEFAULT 0,
     estimated_cost_usd REAL NOT NULL DEFAULT 0,
     provider TEXT,
     metadata JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS usage_user_id_idx ON usage (user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS usage_operation_idx ON usage (operation)`,

  `CREATE TABLE IF NOT EXISTS youtube_connections (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     channel_id TEXT NOT NULL,
     channel_name TEXT NOT NULL,
     channel_thumbnail TEXT,
     encrypted_access_token TEXT,
     encrypted_refresh_token TEXT,
     token_expires_at TIMESTAMPTZ,
     scope TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS youtube_connections_user_id_idx ON youtube_connections (user_id)`,

  `CREATE TABLE IF NOT EXISTS publish_records (
     id SERIAL PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     youtube_video_id TEXT,
     url TEXT,
     privacy privacy_status NOT NULL DEFAULT 'PRIVATE',
     confirmed_at TIMESTAMPTZ,
     error TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS publish_records_project_idx ON publish_records (project_id)`,

  `CREATE TABLE IF NOT EXISTS request_logs (
     id SERIAL PRIMARY KEY,
     user_id TEXT,
     project_id INTEGER,
     job_id INTEGER,
     job_public_id TEXT,
     operation TEXT NOT NULL,
     provider TEXT,
     status TEXT NOT NULL,
     duration_ms INTEGER NOT NULL DEFAULT 0,
     error TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS request_logs_user_idx ON request_logs (user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS request_logs_job_idx ON request_logs (job_public_id)`,

  `CREATE TABLE IF NOT EXISTS provider_health (
     provider TEXT PRIMARY KEY,
     enabled BOOLEAN NOT NULL DEFAULT TRUE,
     status TEXT NOT NULL DEFAULT 'unknown',
     last_checked_at TIMESTAMPTZ,
     last_error TEXT,
     failure_count INTEGER NOT NULL DEFAULT 0,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
];

export async function migrate(): Promise<void> {
  const database = await getDb();
  for (const statement of STATEMENTS) {
    await database.execute(sql.raw(statement));
  }
}

const isDirectRun =
  typeof process.argv[1] !== 'undefined' && process.argv[1].replace(/\\/g, '/').endsWith('push.ts');

if (isDirectRun) {
  migrate()
    .then(() => {
      // PGlite holds the event loop open; close explicitly so the process exits.
      const pg = (globalThis as { __shortforgePglite?: { close: () => Promise<void> } })
        .__shortforgePglite;
      return pg ? pg.close() : Promise.resolve();
    })
    .then(() => {
      console.log('[db] schema ready');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[db] migration failed:', err);
      process.exit(1);
    });
}
