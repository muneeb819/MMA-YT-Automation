# ShortForge AI

**AI YouTube Shorts Automation Platform**

Turn one idea into a finished, downloadable 9:16 YouTube Short — research, script, SEO, scenes,
visuals, voiceover, captions, rendering and quality control, in one background job.

---

## Table of contents

- [What this actually does](#what-this-actually-does)
- [Architecture](#architecture)
- [Quick start (no API keys required)](#quick-start-no-api-keys-required)
- [Environment variables](#environment-variables)
- [Connecting real providers](#connecting-real-providers)
- [YouTube OAuth setup](#youtube-oauth-setup)
- [Production deployment](#production-deployment)
- [API reference](#api-reference)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Honest limitations](#honest-limitations)

---

## What this actually does

The complete flow, exactly as implemented:

```
Idea → Research → Script → SEO → Scene Plan → Visuals → Voiceover
     → Captions → Timeline → Render → Quality Check → Preview
     → Download → (optional) YouTube Publish
```

**What is real, and what depends on credentials:**

| Capability | Status without any API keys |
|---|---|
| Database, schema, migrations, indexes | **Real** (embedded PostgreSQL via PGlite) |
| Job queue, retries, progress tracking | **Real** (in-process driver; BullMQ + Redis in production) |
| Video assembly, H.264/AAC encoding, 1080×1920 | **Real** (genuine FFmpeg 6.1.1) |
| Word-level caption timing + burn-in | **Real** |
| Background music | **Real** (synthesised locally, so no licensing risk) |
| Quality control, duration/resolution/audio checks | **Real** |
| Script / SEO / voiceover / visual content | **Synthetic** until you add provider keys |
| YouTube publishing | Requires `YOUTUBE_CLIENT_ID` + `YOUTUBE_CLIENT_SECRET` |

Demo mode is labelled everywhere in the UI with a **Demo / Mock Mode** badge, and generated
visuals are watermarked in-image as `DEMO VISUAL • GENERATED LOCALLY`, so demo output can never be
mistaken for production output.

---

## Architecture

```
┌──────────────┐     HTTPS      ┌───────────────────────────────┐
│   Browser    │ ─────────────► │  Next.js (web + API routes)   │
│  (React 19)  │ ◄───────────── │  auth, validation, job create │
└──────────────┘   polling      └───────────────┬───────────────┘
                                                │ enqueue
                                                ▼
                                     ┌────────────────────────┐
                                     │  Redis / BullMQ queue  │
                                     └────────────┬───────────┘
                                                  │
                                     ┌────────────▼───────────────┐
                                     │  Worker (separate process) │
                                     │  state machine + FFmpeg    │
                                     └────────────┬───────────────┘
                                                  │
        ┌───────────────────┬─────────────────────┼──────────────────┐
        ▼                   ▼                     ▼                  ▼
  ┌───────────┐      ┌─────────────┐       ┌────────────┐    ┌──────────────┐
  │ PostgreSQL│      │  Storage    │       │  Providers │    │  Object store│
  │ (Drizzle) │      │  provider   │       │  (LLM/TTS)│    │  S3/Cloudinary│
  └───────────┘      └─────────────┘       └────────────┘    └──────────────┘
```

### Key design decisions

**The worker is a separate process from the web app.** FFmpeg renders are long-running; running them
inside a request would block it. The API returns a job id in ~50ms and the UI polls for progress.

**Provider abstraction.** All external services sit behind interfaces
(`LLMProvider`, `VoiceProvider`, `ImageProvider`, `StorageProvider`, `RendererProvider`,
`ResearchProvider`). Swapping OpenAI for another model means writing one new class — no pipeline
changes. See `src/providers/`.

**The database driver is chosen at runtime.** With `DATABASE_URL` set you get real PostgreSQL via
`node-postgres`; without it you get PGlite, which *is* PostgreSQL compiled to WebAssembly. The SQL,
indexes and constraints are identical either way, so the app is fully runnable with zero
infrastructure.

**AI output is never trusted.** Every structured model response is validated with Zod. On failure the
system attempts a structured repair, then a regeneration, and only then fails loudly. It never
blind-parses model output.

**Research cannot fabricate citations.** Without a search provider the research stage returns an
explicitly `UNVERIFIED` result, and the UI shows it as `UNVERIFIED`. Facts are only marked verified
when they carry a real source URL.

**Publishing is gated.** `POST /api/youtube/publish` requires an explicit `confirmed: true` flag from
the confirmation dialog and defaults to `PRIVATE`. There is no code path that publishes
automatically.

---

## Quick start (no API keys required)

**Prerequisites:** Node.js 20+. Nothing else — FFmpeg comes from `ffmpeg-static`, and the database
runs embedded.

```bash
cd shortforge
npm install

# Create the schema (embedded PGlite database)
npm run db:push

# Start the web app
npm run dev
```

Open <http://localhost:4310>, click **Continue with demo account**, then:

1. Go to **Create Short**
2. Enter an idea, e.g. *"How the Antikythera mechanism predicted the movement of the planets"*
3. Click **GENERATE SHORT**
4. Watch live progress through all 10 stages
5. Preview the rendered 1080×1920 MP4, edit the script/SEO/scenes, download, or re-render

You now have a real, playable, downloaded video file. No API keys required.

To run the queue as a separate worker process:

```bash
npm run worker      # in a second terminal
```

### With Docker

```bash
cp .env.example .env
# Set AUTH_SECRET and TOKEN_ENCRYPTION_KEY (see below)
docker compose up --build
```

---

## Environment variables

Copy `.env.example` to `.env.local`. Full annotated list is in that file. The essentials:

| Variable | Required | Purpose |
|---|---|---|
| `MOCK_MODE` | — | `true` = demo mode (default outside production) |
| `AUTH_SECRET` | **production** | HMAC key for session cookies. App refuses to boot without it in production. |
| `TOKEN_ENCRYPTION_KEY` | **production** | Encrypts YouTube OAuth tokens at rest. |
| `DATABASE_URL` | production | PostgreSQL connection string. Blank = embedded PGlite. |
| `REDIS_URL` | production | Redis for BullMQ. Blank = in-process queue. |
| `STORAGE_DRIVER` | production | `s3` or `cloudinary`. Blank/`local` = filesystem. |
| `OPENAI_API_KEY` | for live AI | Script, SEO, research synthesis, visual prompts. |
| `ELEVENLABS_API_KEY` | for live voice | Narration + word-level alignment. |
| `REPLICATE_API_TOKEN` | for AI visuals | Scene image/video generation. |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | for publishing | YouTube OAuth. |
| `ALLOW_DEMO_LOGIN` | — | Auto-disabled in production. |
| `ALLOW_USER_PROVIDER_KEYS` | — | Off by default; per-user keys are stored encrypted. |

Generate the required secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # TOKEN_ENCRYPTION_KEY
```

**No secret is ever exposed to the browser.** All provider calls happen server-side; the settings API
returns `[set]` instead of key values; logs redact any field whose name looks like a credential.

---

## Connecting real providers

### OpenAI (script, SEO, research, visual prompts)

Set `OPENAI_API_KEY`. Optionally `OPENAI_MODEL` (default `gpt-4o-mini`) and `OPENAI_BASE_URL` for any
OpenAI-compatible endpoint. Structured output uses JSON mode plus Zod validation with repair.

### ElevenLabs (voiceover)

Set `ELEVENLABS_API_KEY`. Voices are loaded from the ElevenLabs API and filtered in the UI. If the
account has access to word-level timestamps, captions use real forced-alignment data; otherwise the
timing engine estimates word boundaries from scene durations.

### Replicate (visuals)

Set `REPLICATE_API_TOKEN`. The adapter uses the public HTTP API directly (no SDK). `draft` mode uses
FLUX schnell at reduced resolution to cut cost; `standard` and `premium` use FLUX dev.

### Storage

- **Filesystem** (default, dev only): `./.data/storage`
- **S3-compatible** (AWS S3, R2, MinIO): set `STORAGE_DRIVER=s3` plus bucket/endpoint/keys. Uses
  SigV4 signing over `fetch`, so no extra SDK is needed.
- **Cloudinary**: set `STORAGE_DRIVER=cloudinary` plus the three Cloudinary credentials.

Asset keys always follow `/users/{userId}/projects/{projectId}/{kind}/...`. Raw filesystem paths are
never exposed to users; files are streamed through `/api/assets/*` with an ownership check.

---

## YouTube OAuth setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create/select a project.
2. Enable the **YouTube Data API v3**.
3. Configure the OAuth consent screen. Add your own email as a test user while the app is in testing
   mode.
4. Create an **OAuth client ID** of type *Web application*.
5. Add the exact redirect URI: `https://your-domain/api/youtube/callback`
   (local: `http://localhost:4310/api/youtube/callback`).
6. Set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI` and `NEXTAUTH_URL`.
7. Restart the server, then open **YouTube → Connect YouTube channel**.

ShortForge requests only `youtube.upload` and `youtube.readonly`. It **never** asks for or stores a
password. Access and refresh tokens are AES-256-GCM encrypted at rest and automatically refreshed
when close to expiry.

**Publishing is always confirmed.** The dialog shows the exact channel, title, description and
visibility; the confirm button is disabled until you tick the acknowledgement. Default visibility is
`PRIVATE`.

> **Note:** the YouTube Data API has no server-side scheduled publishing. A scheduled upload must be
> triggered while the app is running. Verify current platform limits (upload quotas, Shorts duration
> limits) before publishing at scale — do not assume them.

---

## Production deployment

The web app and the worker are **separate services**. Do not run FFmpeg inside a serverless request.

### Option A — Docker (recommended, keeps web and worker together)

```bash
docker compose up --build -d
```

This brings up PostgreSQL, Redis, the web app and the worker with health checks and persistent
volumes.

### Option B — Vercel (web) + separate worker host

1. Deploy the web app to Vercel. Set all env vars in the project settings. Leave `REDIS_URL` pointing
   at managed Redis (Upstash, Redis Cloud).
2. Run the worker on a persistent host (Fly.io, Railway, a VPS, ECS) with `REDIS_URL`,
   `DATABASE_URL`, `STORAGE_*` and the provider keys set. `npm run worker`.
3. Apply migrations: `npx drizzle-kit migrate` (or `npm run db:push` for the idempotent bootstrap).
4. Confirm `/api/health` reports `renderer: healthy` on the worker host.

> If you deploy only to Vercel, generation will queue but never render. Either run the worker
> elsewhere or rely on the in-process driver for a single-user demo.

### Post-deploy checklist

- [ ] `AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY` are set and unique
- [ ] `MOCK_MODE=false` and real provider keys are present
- [ ] `ALLOW_DEMO_LOGIN=false` (auto-disabled when `NODE_ENV=production`)
- [ ] `/api/health` returns `"status": "healthy"`
- [ ] An admin account exists: `ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run seed`
- [ ] Scheduled cleanup: `node --import tsx scripts/cleanup.ts` (daily)

---

## API reference

Every response uses one envelope:

```json
{ "success": true, "data": {}, "error": null }
```

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Status of database, queue, providers, renderer, storage |
| `POST` | `/api/auth` | Sign up or sign in (sets session cookie) |
| `PUT` | `/api/auth/demo` | Demo sign-in (refuses to run in production) |
| `DELETE` | `/api/auth` | Sign out |
| `GET` | `/api/projects` | Paginated, filtered, searchable list |
| `POST` | `/api/projects` | Create a draft project |
| `GET` | `/api/projects/:id` | Full project detail |
| `PATCH` | `/api/projects/:id` | Autosave script / SEO / scene / style edits |
| `DELETE` | `/api/projects/:id` | Delete project and its assets |
| `POST` | `/api/projects/:id/generate` | Start the full pipeline (returns job id) |
| `POST` | `/api/projects/:id/regenerate` | Regenerate one stage: `script`, `scene`, `visual`, `voice`, `captions`, `render` |
| `GET` | `/api/projects/:id/download?kind=` | `mp4`, `audio`, `script`, `srt`, `vtt`, `json` |
| `GET` | `/api/jobs/:id` | Job status, progress and stage list |
| `POST` | `/api/jobs/:id/cancel` | Request cancellation |
| `POST` | `/api/jobs/:id/retry` | Re-queue a failed job |
| `GET` | `/api/voices` | Voices from the configured provider |
| `GET` / `POST` | `/api/templates` | List / create templates |
| `DELETE` | `/api/templates/:id` | Delete a custom template |
| `GET` / `PATCH` | `/api/settings` | Defaults, brand kit, provider status |
| `POST` | `/api/settings/password` | Change password |
| `GET` | `/api/analytics` | Counters, volume, usage, timing |
| `GET` | `/api/youtube` | Connection status |
| `GET` | `/api/youtube/connect` | Begin OAuth |
| `GET` | `/api/youtube/callback` | OAuth callback |
| `POST` | `/api/youtube/publish` | Upload (requires `confirmed: true`) |
| `GET` | `/api/assets/*` | Stream an owned asset |

---

## Testing

```bash
npm test                     # 73 unit tests (timing, parsing, security, validation)
npm run typecheck            # strict TypeScript, no errors
npm run build                # production build

node --import tsx scripts/probe-render.ts   # FFmpeg pipeline probe (12 checks)
node --import tsx scripts/e2e-pipeline.ts   # full pipeline vs real DB + FFmpeg (24 checks)
node --import tsx scripts/journey.ts        # HTTP journey vs a running server (60 checks)
```

`journey.ts` requires the dev server to be running. It exercises sign-up, validation, project
creation, generation, progress polling, preview, downloads (decoding the MP4 with real FFmpeg),
autosave, regeneration, analytics, user-isolation and content-safety.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ffmpeg` not found | `ffmpeg-static` postinstall blocked | `npm rebuild ffmpeg-static`, or set `FFMPEG_PATH` |
| Video is 0.1s long | Scene clip produced a single frame | Ensure `-loop 1` is an *input* option; see `buildSceneVideoFilter` |
| `relation "x" does not exist` | Schema not applied | `npm run db:push` |
| PGlite process won't exit | PGlite holds the event loop | Call `client.close()` or `process.exit()` |
| Job stuck `QUEUED` | No worker running | Start `npm run worker`, or rely on the in-process driver |
| `AUTH_SECRET is required` | Production without a secret | Set `AUTH_SECRET` |
| YouTube reports "not configured" | Credentials absent | Complete the OAuth setup above |
| Captions unreadable | Style/scale mismatch | Try a different caption style; sizes scale with output height |
| Rate limited | Auth endpoints are throttled | Wait; limits are per-IP (10/min) and per-user (publish 10/hour) |

---

## Honest limitations

These are real and worth stating plainly:

1. **No performance guarantees.** The system optimises for craft characteristics (hook strength,
   information density, pacing, pattern interruption, caption readability). It cannot and does not
   predict or promise views, reach or virality.
2. **Demo mode is not AI.** Scripts, voices and visuals are synthetic and labelled as such. Only the
   video pipeline, timing, captions and rendering are real.
3. **Research needs a search provider.** Without one, facts are marked `UNVERIFIED`. The system
   refuses to invent citations.
4. **YouTube scheduled publishing** is not supported by the Data API.
5. **Provider APIs are unverified here.** The OpenAI, ElevenLabs, Replicate and YouTube adapters are
   written against their documented APIs but could not be executed without credentials. They are
   gated on env vars and degrade with clear errors; treat them as untested until you supply keys.
6. **The in-process queue is single-instance.** It is fine for a single user or a demo. For multiple
   instances you must set `REDIS_URL`.
7. **Target duration is validated to 180s**, not assumed from memory. Verify current YouTube Shorts
   limits yourself before publishing.

---

## Project structure

```
shortforge/
├─ src/
│  ├─ app/                    Next.js App Router (pages + API routes)
│  ├─ components/             UI primitives, shell, progress, publish dialog
│  ├─ db/                     schema.ts, connection, idempotent migration
│  ├─ lib/                    domain, timing, pipeline, queue, credits, auth, security
│  ├─ prompts/                Centralised, versioned prompt templates
│  ├─ providers/              LLM / voice / image / storage / renderer + registry
│  ├─ jobs/                   Job handler registry
│  └─ worker/                 Standalone worker entrypoint
├─ scripts/                   seed, cleanup, probes, journey test
├─ tests/                     Vitest unit tests
├─ Dockerfile
├─ docker-compose.yml
└─ .env.example
```
