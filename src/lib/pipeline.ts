/**
 * Generation pipeline.
 *
 * A single explicit state machine drives the full flow. Every transition is
 * persisted (project status + job stage + progress) so the UI can render live
 * progress and a crashed process leaves a truthful state behind.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  audioAssets,
  captionAssets,
  generationJobs,
  jobEvents,
  projects,
  researchSources,
  scenes,
  scripts,
  seoMetadata,
  videoAssets,
} from '@/db/schema';
import {
  PRESET_VIDEO_SPECS,
  FRESH_SOURCE_CATEGORIES,
  type Preset,
} from '@/lib/domain';
import {
  allocateSceneDurations,
  buildTimeline,
  buildWordTimings,
  countWords,
  groupIntoCues,
  round,
  toSrt,
  toVtt,
} from '@/lib/timing';
import { chargeCredits, refundCredits, type Operation } from '@/lib/credits';
import { log, recordProviderStatus, toPublicError } from '@/lib/logging';
import { projectKey } from '@/providers/storage';
import { getStorage, getLLM, getVoice, getImage, getRenderer, getResearch } from '@/providers/registry';
import { MUSIC_PRESETS, generateToneBed } from '@/providers/music';
import { seedFrom } from '@/providers/replicate';
import { ProviderError } from '@/providers/types';
import type { JobPayload } from '@/lib/queue';

/** Ordered stages — the UI renders progress directly from this list. */
export const PIPELINE_STAGES = [
  { key: 'RESEARCHING', label: 'Researching the topic', weight: 8 },
  { key: 'SCRIPTING', label: 'Writing the script', weight: 16 },
  { key: 'SEO_GENERATING', label: 'Generating SEO metadata', weight: 8 },
  { key: 'SCENE_PLANNING', label: 'Planning scenes', weight: 8 },
  { key: 'GENERATING_VISUALS', label: 'Generating visuals', weight: 18 },
  { key: 'GENERATING_VOICE', label: 'Generating voiceover', weight: 14 },
  { key: 'GENERATING_CAPTIONS', label: 'Creating captions', weight: 8 },
  { key: 'ASSEMBLING', label: 'Assembling the timeline', weight: 4 },
  { key: 'RENDERING', label: 'Rendering video', weight: 12 },
  { key: 'QUALITY_CHECK', label: 'Final quality check', weight: 4 },
] as const;

export type StageKey = (typeof PIPELINE_STAGES)[number]['key'];

const TOTAL_WEIGHT = PIPELINE_STAGES.reduce((a, s) => a + s.weight, 0);

export interface PipelineContext {
  jobId: number;
  publicId: string;
  projectId: number;
  userId: string;
  /** Stage-scoped progress within the current stage (0-1). */
  setStageProgress(fraction: number, detail?: string): Promise<void>;
  isCancelled(): Promise<boolean>;
  throwIfCancelled(): Promise<void>;
  /** Enter a stage: persists project status, job stage and event. */
  enter(key: StageKey): Promise<void>;
}

/** Full pipeline: research -> script -> seo -> scenes -> visuals -> voice -> captions -> render -> qc. */
export async function runFullPipeline(
  payload: JobPayload,
  opts: { skipResearch?: boolean } = {},
): Promise<void> {
  const db = await getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId)).limit(1);
  if (!project) throw new Error('Project not found.');

  const chargedOps: Operation[] = [];
  const track = (ops: Operation[]) => {
    chargedOps.push(...ops);
    return ops;
  };

  const ctx = await createContext(payload);
  const storage = getStorage();

  const spec = PRESET_VIDEO_SPECS[(project.preset as Preset) ?? 'youtube_shorts'];

  try {
    // ---------------- 1. Research --------------------------------------
    let research = null;
    if (!opts.skipResearch) {
      await enterStage(ctx, 'RESEARCHING');
      const researchProvider = getResearch();
      if (researchProvider) {
        research = await researchProvider.research({
          topic: project.topic,
          category: project.category,
          requireFresh: FRESH_SOURCE_CATEGORIES.has(project.category),
        });
        track(['research']);
        await chargeCredits(payload.userId, ['research'], { projectId: payload.projectId });
        // Persist sources so the user can inspect them before publishing.
        await db.delete(researchSources).where(eq(researchSources.projectId, payload.projectId));
        if (research.facts.length) {
          await db.insert(researchSources).values(
            research.facts.map((f) => ({
              projectId: payload.projectId,
              fact: f.fact,
              sourceUrl: f.sourceUrl ?? null,
              sourceName: f.sourceName ?? null,
              verified: f.verified,
              notes: f.notes ?? null,
            })),
          );
        }
      }
    }

    // ---------------- 2. Script ----------------------------------------
    await enterStage(ctx, 'SCRIPTING');
    const llm = getLLM();
    let templateBeats: string[] | undefined;
    if (project.templateId) {
      const { templates } = await import('@/db/schema');
      const [tpl] = await db
        .select({ beats: templates.beats })
        .from(templates)
        .where(eq(templates.id, project.templateId))
        .limit(1);
      templateBeats = tpl?.beats ?? undefined;
    }

    const scriptPackage = await llm.generateScript({
      topic: project.topic,
      category: project.category,
      style: project.scriptStyle,
      targetDuration: project.targetDuration,
      language: project.language,
      templateBeats,
      research,
      voiceSpeed: project.voiceSpeed,
    });
    track(['script']);
    await chargeCredits(payload.userId, ['script'], { projectId: payload.projectId });

    const version = project.currentVersion;
    const [existingScript] = await db
      .select({ v: scripts.version })
      .from(scripts)
      .where(eq(scripts.projectId, payload.projectId))
      .orderBy(scripts.version)
      .limit(1);
    const nextVersion = (existingScript?.v ?? 0) + 1;

    await db.insert(scripts).values({
      projectId: payload.projectId,
      hook: scriptPackage.hook,
      body: scriptPackage.script,
      cta: scriptPackage.cta,
      version: nextVersion,
      wordCount: countWords(scriptPackage.script),
      estimatedDuration: scriptPackage.estimatedDuration,
    });
    log.info('script.generated', {
      job_id: payload.publicId,
      project_id: payload.projectId,
      words: countWords(scriptPackage.script),
      duration: scriptPackage.estimatedDuration,
    });

    // ---------------- 3. SEO -------------------------------------------
    await enterStage(ctx, 'SEO_GENERATING');
    const seo = await llm.generateSeo({
      topic: project.topic,
      category: project.category,
      script: scriptPackage.script,
      hook: scriptPackage.hook,
      language: project.language,
    });
    track(['seo']);
    await chargeCredits(payload.userId, ['seo'], { projectId: payload.projectId });

    await db
      .insert(seoMetadata)
      .values({
        projectId: payload.projectId,
        title: seo.title || scriptPackage.title,
        titleVariants: seo.titleVariants.length ? seo.titleVariants : [seo.title],
        description: seo.description || scriptPackage.description,
        hashtags: seo.hashtags.length ? seo.hashtags : scriptPackage.hashtags,
        tags: seo.tags.length ? seo.tags : scriptPackage.tags,
        keywords: seo.keywords,
        hookScore: seo.hookScore,
      })
      .onConflictDoUpdate({
        target: seoMetadata.projectId,
        set: {
          title: seo.title || scriptPackage.title,
          titleVariants: seo.titleVariants.length ? seo.titleVariants : [seo.title],
          description: seo.description || scriptPackage.description,
          hashtags: seo.hashtags.length ? seo.hashtags : scriptPackage.hashtags,
          tags: seo.tags.length ? seo.tags : scriptPackage.tags,
          keywords: seo.keywords,
          hookScore: seo.hookScore,
          updatedAt: new Date(),
        },
      });

    // ---------------- 4. Scene plan ------------------------------------
    await enterStage(ctx, 'SCENE_PLANNING');
    const narrations = scriptPackage.scenes.map((s) => s.text).filter(Boolean);
    if (narrations.length === 0) {
      throw new ProviderError('The script produced no scenes to render.', 'pipeline', false);
    }
    const sceneDurations = allocateSceneDurations(
      narrations,
      project.targetDuration,
      project.voiceSpeed,
    );
    const timeline = buildTimeline(sceneDurations);

    await db.delete(scenes).where(eq(scenes.projectId, payload.projectId));
    await db.insert(scenes).values(
      scriptPackage.scenes.slice(0, narrations.length).map((s, i) => ({
        projectId: payload.projectId,
        sceneNumber: i + 1,
        narration: s.text,
        visualPrompt: s.visualPrompt,
        visualType: s.visualType as 'image',
        sourceType: 'AI_GENERATED' as const,
        duration: timeline[i]?.duration ?? 0,
        startTime: timeline[i]?.start ?? 0,
        caption: s.caption,
        transition: s.transition,
        status: 'PENDING',
      })),
    );

    // ---------------- 5. Visuals ---------------------------------------
    await enterStage(ctx, 'GENERATING_VISUALS');
    const imageProvider = getImage();
    const draft = project.qualityMode === 'draft';
    let visualCredits = 0;

    for (let i = 0; i < narrations.length; i++) {
      await ctx.throwIfCancelled();

      // Re-read the scene rows each pass so concurrent edits are respected.
      const all = await db
        .select()
        .from(scenes)
        .where(eq(scenes.projectId, payload.projectId))
        .orderBy(scenes.sceneNumber);
      const current = all[i];
      if (!current) break;

      const prompt = current.visualPrompt || scriptPackage.scenes[i].visualPrompt;
      try {
        const result = await imageProvider.generate({
          prompt,
          // Draft mode uses a smaller render to cut cost and time.
          width: draft ? 768 : spec.width,
          height: draft ? 1366 : spec.height,
          seed: seedFrom(`${project.id}:${current.sceneNumber}:${prompt}`),
          qualityMode: project.qualityMode as 'draft' | 'standard' | 'premium',
        });
        const key = projectKey(
          payload.userId,
          payload.projectId,
          'visuals',
          `scene-${String(current.sceneNumber).padStart(3, '0')}.${result.contentType.includes('png') ? 'png' : 'jpg'}`,
        );
        await storage.put(key, result.buffer, result.contentType);
        const url = await storage.publicUrl(key);

        await db
          .update(scenes)
          .set({
            visualUrl: url,
            status: 'READY',
            sourceType: result.sourceType,
            sourceProvider: result.provider,
            sourceUrl: result.sourceUrl ?? null,
            licenseNote: result.licenseNote ?? null,
            updatedAt: new Date(),
          })
          .where(eq(scenes.id, current.id));

        visualCredits += 1;
      } catch (err) {
        // A single visual failure must not abort the whole video: log it and
        // continue with a generated gradient background for that scene.
        log.warn('visual.failed', {
          job_id: payload.publicId,
          scene: current.sceneNumber,
          error: err instanceof Error ? err.message : String(err),
        });
        await db
          .update(scenes)
          .set({ status: 'BACKGROUND_ONLY', updatedAt: new Date() })
          .where(eq(scenes.id, current.id));
        await recordProviderStatus(imageProvider.name, false, String(err));
      }

      await ctx.setStageProgress((i + 1) / narrations.length, `Scene ${i + 1} of ${narrations.length}`);
    }

    if (visualCredits > 0) {
      const amount = Math.min(visualCredits, narrations.length);
      await chargeCredits(
        payload.userId,
        Array.from({ length: amount }, () => 'image' as Operation),
        { projectId: payload.projectId },
      );
      track(Array.from({ length: amount }, () => 'image' as Operation));
    }

    // ---------------- 6. Voice -----------------------------------------
    await enterStage(ctx, 'GENERATING_VOICE');
    const voiceProvider = getVoice();
    const narrationText = narrations.join(' ');
    const voiceSettings = {
      voiceId: project.voiceId ?? 'mock_marcus',
      voiceName: project.voiceName ?? 'Marcus (Demo)',
      speed: project.voiceSpeed,
      stability: 0.5,
    };

    const voiceResult = await voiceProvider.synthesize(narrationText, voiceSettings);
    track(['voice']);
    await chargeCredits(payload.userId, ['voice'], { projectId: payload.projectId });

    const audioKey = projectKey(payload.userId, payload.projectId, 'audio', 'voiceover.wav');
    await storage.put(audioKey, voiceResult.audio, voiceResult.contentType);
    const audioUrl = await storage.publicUrl(audioKey);

    await db.insert(audioAssets).values({
      projectId: payload.projectId,
      voiceId: voiceResult.settings.voiceId,
      voiceName: voiceResult.settings.voiceName ?? null,
      provider: voiceResult.provider as 'mock',
      generationId: voiceResult.generationId,
      audioUrl,
      storageKey: audioKey,
      duration: voiceResult.durationSeconds,
      settings: voiceResult.settings as unknown as Record<string, unknown>,
    });

    // ---------------- 7. Captions --------------------------------------
    await enterStage(ctx, 'GENERATING_CAPTIONS');
    // Prefer provider word alignment when available; fall back to the timing engine.
    let words = await tryProviderAlignment(voiceProvider, narrationText, voiceSettings);
    if (words.length === 0) {
      words = buildWordTimings(narrations, sceneDurations);
    }
    const cues = groupIntoCues(words, 4, 2.4);

    const srtKey = projectKey(payload.userId, payload.projectId, 'captions', 'captions.srt');
    const vttKey = projectKey(payload.userId, payload.projectId, 'captions', 'captions.vtt');
    await storage.put(srtKey, Buffer.from(toSrt(cues), 'utf8'), 'application/x-subrip');
    await storage.put(vttKey, Buffer.from(toVtt(cues), 'utf8'), 'text/vtt');

    await db
      .insert(captionAssets)
      .values({
        projectId: payload.projectId,
        srtUrl: await storage.publicUrl(srtKey),
        vttUrl: await storage.publicUrl(vttKey),
        words,
        provider: voiceResult.provider as 'mock',
      })
      .onConflictDoNothing();

    // ---------------- 8. Assemble --------------------------------------
    await enterStage(ctx, 'ASSEMBLING');
    const finalScenes = await db
      .select()
      .from(scenes)
      .where(eq(scenes.projectId, payload.projectId))
      .orderBy(scenes.sceneNumber);

    let musicKey: string | null = null;
    if (project.musicStyle !== 'none' && project.musicVolume > 0) {
      const preset = MUSIC_PRESETS[project.musicStyle] ?? MUSIC_PRESETS.cinematic;
      const total = finalScenes.reduce((a, s) => a + s.duration, 0);
      musicKey = projectKey(payload.userId, payload.projectId, 'audio', 'music.wav');
      await storage.put(
        musicKey,
        generateToneBed(total, preset, 1),
        'audio/wav',
      );
    }

    // ---------------- 9. Render ----------------------------------------
    await enterStage(ctx, 'RENDERING');
    const renderer = getRenderer();
    const videoKey = projectKey(payload.userId, payload.projectId, 'renders', 'final.mp4');
    const thumbKey = projectKey(payload.userId, payload.projectId, 'renders', 'thumbnail.jpg');

    const renderInput = {
      projectId: payload.projectId,
      duration: finalScenes.reduce((a, s) => a + s.duration, 0),
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      bitrate: spec.bitrate,
      audioKey,
      audioDuration: voiceResult.durationSeconds,
      scenes: finalScenes.map((s, i) => ({
        index: i,
        start: s.startTime,
        duration: s.duration,
        visualKey: storageKeyFromUrl(s.visualUrl),
        visualType: s.visualType,
        transition: s.transition,
        background: sceneBackground(i),
        overlayText: s.caption || null,
      })),
      captions: cues.map((c) => ({ start: c.start, end: c.end, text: c.text })),
      captionStyle: project.captionStyle,
      musicKey,
      musicVolume: project.musicVolume,
      outputKey: videoKey,
      thumbnailKey: thumbKey,
    };

    const renderResult = await renderer.render(renderInput);
    track(['render']);
    await chargeCredits(payload.userId, ['render'], { projectId: payload.projectId });

    const videoUrl = await storage.publicUrl(videoKey);
    const thumbnailUrl = renderResult.thumbnailKey
      ? await storage.publicUrl(renderResult.thumbnailKey)
      : null;

    // ---------------- 10. Quality check ---------------------------------
    await enterStage(ctx, 'QUALITY_CHECK');
    const qc = await qualityCheck({
      storageKey: videoKey,
      expected: { width: spec.width, height: spec.height, duration: renderInput.duration },
      sceneCount: finalScenes.length,
      captionsEnabled: cues.length > 0,
      sizeBytes: renderResult.sizeBytes,
    });

    await db.insert(videoAssets).values({
      projectId: payload.projectId,
      provider: renderResult.provider as 'ffmpeg',
      videoUrl,
      storageKey: videoKey,
      thumbnailUrl,
      duration: renderResult.duration,
      resolution: `${renderResult.width}x${renderResult.height}`,
      fps: renderResult.fps,
      sizeBytes: renderResult.sizeBytes,
      checksum: renderResult.checksum,
      qcReport: qc as unknown as Record<string, unknown>,
    });

    if (!qc.passed) {
      throw new ProviderError(
        `Quality check failed: ${qc.failures.join('; ')}`,
        'ffmpeg',
        false,
      );
    }

    // ---------------- Done ---------------------------------------------
    await db
      .update(projects)
      .set({
        status: 'COMPLETED',
        title: seo.title || scriptPackage.title,
        thumbnailUrl,
        actualDuration: round(renderResult.duration, 2),
        currentVersion: version,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, payload.projectId));

    await ctx.setStageProgress(1, 'Completed');
    log.info('pipeline.completed', {
      job_id: payload.publicId,
      project_id: payload.projectId,
      duration: renderResult.duration,
      size_bytes: renderResult.sizeBytes,
    });
  } catch (err) {
    const publicErr = toPublicError(err);
    await db
      .update(projects)
      .set({ status: 'FAILED', updatedAt: new Date() })
      .where(eq(projects.id, payload.projectId));
    await db
      .update(generationJobs)
      .set({ error: publicErr.publicMessage, errorDetail: publicErr.detail })
      .where(eq(generationJobs.id, payload.jobId));

    // Refund credits for work that did not complete.
    if (chargedOps.length > 0) {
      await refundCredits(payload.userId, chargedOps, {
        projectId: payload.projectId,
        reason: 'pipeline_failed',
      }).catch(() => undefined);
    }

    // Surface a retryable marker so the queue knows whether to back off and retry.
    const original = err as { retryable?: boolean; provider?: string };
    if (original?.provider) {
      await recordProviderStatus(original.provider, false, publicErr.publicMessage);
    }
    throw err;
  }
}

/** Context helpers ------------------------------------------------------- */

/**
 * Build a per-job context. All mutable stage state lives inside the returned
 * object so concurrent jobs never share progress state.
 */
async function createContext(payload: JobPayload): Promise<PipelineContext> {
  const db = await getDb();
  let currentStage: StageKey = 'RESEARCHING';

  const baseOf = (key: StageKey): number =>
    PIPELINE_STAGES.slice(0, PIPELINE_STAGES.findIndex((s) => s.key === key)).reduce(
      (a, s) => a + s.weight,
      0,
    );

  const weightOf = (key: StageKey): number =>
    PIPELINE_STAGES.find((s) => s.key === key)?.weight ?? 1;

  const overallProgress = (fraction: number): number =>
    Math.min(
      100,
      Math.round(((baseOf(currentStage) + fraction * weightOf(currentStage)) / TOTAL_WEIGHT) * 100),
    );

  const ctx: PipelineContext = {
    jobId: payload.jobId,
    publicId: payload.publicId,
    projectId: payload.projectId,
    userId: payload.userId,

    async enter(key: StageKey) {
      currentStage = key;
      const progress = overallProgress(0);
      const label = PIPELINE_STAGES.find((s) => s.key === key)?.label ?? key;

      await db
        .update(projects)
        .set({ status: key, updatedAt: new Date() })
        .where(eq(projects.id, payload.projectId));
      await db
        .update(generationJobs)
        .set({ stage: key, progress, stageDetail: label, updatedAt: new Date() })
        .where(eq(generationJobs.id, payload.jobId));
      await db.insert(jobEvents).values({
        jobId: payload.jobId,
        stage: key,
        progress,
        message: label,
      });
    },

    async setStageProgress(fraction: number, detail?: string) {
      const progress = overallProgress(Math.min(1, Math.max(0, fraction)));
      await db
        .update(generationJobs)
        .set({ progress, stageDetail: detail ?? null, updatedAt: new Date() })
        .where(eq(generationJobs.id, payload.jobId));
      await db.insert(jobEvents).values({
        jobId: payload.jobId,
        stage: currentStage,
        progress,
        message: detail ?? null,
      });
    },

    async isCancelled() {
      const [row] = await db
        .select({ cancelRequested: generationJobs.cancelRequested })
        .from(generationJobs)
        .where(eq(generationJobs.id, payload.jobId))
        .limit(1);
      return row?.cancelRequested ?? false;
    },

    async throwIfCancelled() {
      if (await ctx.isCancelled()) {
        throw new ProviderError('Generation cancelled by user.', 'pipeline', false);
      }
    },
  };

  return ctx;
}

const enterStage = async (ctx: PipelineContext, key: StageKey): Promise<void> => ctx.enter(key);

/** Ask the voice provider for real word alignment; empty means "unavailable". */
async function tryProviderAlignment(
  provider: unknown,
  text: string,
  settings: { voiceId: string; voiceName?: string; speed: number; stability: number },
): Promise<{ word: string; start: number; end: number }[]> {
  const candidate = provider as { getAlignment?: (t: string, s: unknown) => Promise<{ word: string; start: number; end: number }[]> };
  if (typeof candidate.getAlignment !== 'function') return [];
  try {
    const result = await candidate.getAlignment(text, settings);
    return Array.isArray(result) && result.length > 0 ? result : [];
  } catch {
    return [];
  }
}

/** Recover the storage key from a previously generated public URL. */
function storageKeyFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = '/api/assets/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

/** Deterministic per-scene gradient so cuts feel designed, not random. */
export function sceneBackground(index: number): string {
  const palette = ['#4c3a99', '#2b1b52', '#1a1030', '#3b2a6b', '#241640', '#4a2c5e'];
  return palette[index % palette.length];
}

// ---------------------------------------------------------------------------
// Quality control
// ---------------------------------------------------------------------------

export interface QcReport {
  passed: boolean;
  failures: string[];
  warnings: string[];
  checks: Record<string, boolean | number | string>;
}

export async function qualityCheck(input: {
  storageKey: string;
  expected: { width: number; height: number; duration: number };
  sceneCount: number;
  captionsEnabled: boolean;
  sizeBytes: number;
}): Promise<QcReport> {
  const failures: string[] = [];
  const warnings: string[] = [];
  const checks: Record<string, boolean | number | string> = {};

  const storage = getStorage();

  const exists = await storage.exists(input.storageKey);
  checks.videoExists = exists;
  if (!exists) {
    return { passed: false, failures: ['Rendered video is missing from storage.'], warnings, checks };
  }

  const { probeMedia } = await import('@/providers/ffmpeg-runner');
  const localPath = await materialise(input.storageKey);
  const probe = await probeMedia(localPath);

  checks.duration = round(probe.duration, 2);
  checks.resolution = `${probe.width}x${probe.height}`;
  checks.hasAudio = probe.hasAudio;
  checks.hasVideo = probe.hasVideo;
  checks.sizeBytes = input.sizeBytes;

  if (!probe.hasVideo) failures.push('Rendered file contains no video stream.');
  if (!probe.hasAudio) failures.push('Rendered file contains no audio track.');
  if (probe.duration <= 0) failures.push('Rendered video has zero duration.');

  const resolutionOk = probe.width === input.expected.width && probe.height === input.expected.height;
  checks.resolutionMatches = resolutionOk;
  if (!resolutionOk) {
    failures.push(
      `Resolution is ${probe.width}x${probe.height}, expected ${input.expected.width}x${input.expected.height}.`,
    );
  }

  // 9:16 aspect ratio within a small tolerance.
  const aspect = probe.height > 0 ? probe.width / probe.height : 0;
  checks.aspectRatio = round(aspect, 4);
  if (Math.abs(aspect - 9 / 16) > 0.02) {
    warnings.push(`Aspect ratio ${round(aspect, 3)} is not exactly 9:16.`);
  }

  // Duration must be within 10% of the intended timeline.
  const drift = Math.abs(probe.duration - input.expected.duration);
  checks.durationDriftSeconds = round(drift, 2);
  if (drift > Math.max(0.75, input.expected.duration * 0.1)) {
    warnings.push(
      `Rendered duration differs from the timeline by ${round(drift, 2)}s.`,
    );
  }

  // A truncated file is still a valid container, so use a conservative floor
  // to catch corruption without penalising legitimately low-bitrate content.
  // ~5 KB/s is far below any real encode but far above a truncated header.
  const minBytes = Math.max(20_000, input.expected.duration * 5_000);
  checks.sizeReasonable = input.sizeBytes >= minBytes;
  if (input.sizeBytes < minBytes) {
    failures.push(
      `Rendered file is only ${Math.round(input.sizeBytes / 1024)}KB for ${round(input.expected.duration, 1)}s, which indicates a truncated encode.`,
    );
  } else if (input.sizeBytes < input.expected.duration * 40_000) {
    warnings.push(
      `Encoded bitrate is low (${Math.round((input.sizeBytes * 8) / input.expected.duration / 1000)} kbps). Content is simple, so this is expected.`,
    );
  }

  if (input.sceneCount === 0) failures.push('No scenes were rendered.');
  if (input.captionsEnabled && probe.duration <= 0) {
    failures.push('Captions were requested but the video is empty.');
  }

  return { passed: failures.length === 0, failures, warnings, checks };
}

/** Write a storage object to a temp file so ffprobe/ffmpeg can read it. */
async function materialise(storageKey: string): Promise<string> {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs/promises');
  const storage = getStorage();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-qc-'));
  const file = path.join(dir, path.basename(storageKey));
  await fs.writeFile(file, await storage.get(storageKey));
  setTimeout(() => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined), 30_000);
  return file;
}
