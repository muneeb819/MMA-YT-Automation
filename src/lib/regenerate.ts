/**
 * Targeted regeneration.
 *
 * Each function re-runs exactly one stage so a user never pays to regenerate
 * the whole project to fix a single scene. Each returns a job payload that the
 * caller enqueues.
 */
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  audioAssets,
  captionAssets,
  generationJobs,
  projectVersions,
  projects,
  scenes,
  scripts,
  videoAssets,
} from '@/db/schema';
import { PRESET_VIDEO_SPECS, type Preset } from '@/lib/domain';
import { allocateSceneDurations, buildWordTimings, countWords, groupIntoCues, round, toSrt, toVtt } from '@/lib/timing';
import { chargeCredits, refundCredits, type Operation } from '@/lib/credits';
import { log, toPublicError } from '@/lib/logging';
import { projectKey } from '@/providers/storage';
import { getStorage, getImage, getLLM, getRenderer, getVoice } from '@/providers/registry';
import { MUSIC_PRESETS, generateToneBed } from '@/providers/music';
import { seedFrom } from '@/providers/replicate';
import { ProviderError } from '@/providers/types';
import type { JobPayload } from '@/lib/queue';
import { sceneBackground, qualityCheck } from './pipeline';
import { buildVisualPrompt } from '@/prompts';

/** Re-exported so the scene background palette stays in one place. */
export { sceneBackground };

type RegenerateKind = 'script' | 'voice' | 'captions' | 'render' | 'scene' | 'visual' | 'seo';

/**
 * Capture the current script + scene state as a restorable version.
 * Called before any destructive regeneration.
 */
export async function snapshotProject(
  projectId: number,
  label: string,
): Promise<number> {
  const db = await getDb();
  const [current] = await db
    .select({ v: projectVersions.version })
    .from(projectVersions)
    .where(eq(projectVersions.projectId, projectId))
    .orderBy(projectVersions.version)
    .limit(1);
  const next = (current?.v ?? 0) + 1;

  const [scriptRows, sceneRows, seoRows] = await Promise.all([
    db.select().from(scripts).where(eq(scripts.projectId, projectId)).orderBy(scripts.version),
    db.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(scenes.sceneNumber),
    db.select().from(scripts).where(eq(scripts.projectId, projectId)).orderBy(scripts.version).limit(1),
  ]);
  void seoRows;

  await db.insert(projectVersions).values({
    projectId,
    version: next,
    label,
    snapshot: {
      script: scriptRows[scriptRows.length - 1] ?? null,
      scenes: sceneRows,
    },
  });
  return next;
}

/** Regenerate the script (and re-plan scenes), then re-render. */
export async function regenerateScriptAndDownstream(payload: JobPayload): Promise<void> {
  const db = await getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId)).limit(1);
  if (!project) throw new Error('Project not found.');

  const charged: Operation[] = [];
  try {
    await db.update(projects).set({ status: 'SCRIPTING', updatedAt: new Date() }).where(eq(projects.id, payload.projectId));
    await db.update(generationJobs).set({ stage: 'SCRIPTING', progress: 10 }).where(eq(generationJobs.id, payload.jobId));

    const llm = getLLM();
    const [latest] = await db.select().from(scripts).where(eq(scripts.projectId, payload.projectId))
      .orderBy(scripts.version).limit(1);

    const revision = (payload.options.instruction as string) || 'Generate a fresh alternative take.';

    const result = await llm.generateScript({
      topic: project.topic,
      category: project.category,
      style: project.scriptStyle,
      targetDuration: project.targetDuration,
      language: project.language,
      voiceSpeed: project.voiceSpeed,
      revisionInstruction: revision,
    });

    await chargeCredits(payload.userId, ['script_regen'], { projectId: payload.projectId });
    charged.push('script_regen');

    const nextVersion = (latest?.version ?? 0) + 1;
    await db.insert(scripts).values({
      projectId: payload.projectId,
      hook: result.hook,
      body: result.script,
      cta: result.cta,
      version: nextVersion,
      wordCount: countWords(result.script),
      estimatedDuration: result.estimatedDuration,
    });

    // Re-plan scenes from the new narration.
    const narrations = result.scenes.map((s) => s.text).filter(Boolean);
    const durations = allocateSceneDurations(narrations, project.targetDuration, project.voiceSpeed);
    let cursor = 0;
    await db.delete(scenes).where(eq(scenes.projectId, payload.projectId));
    await db.insert(scenes).values(
      result.scenes.slice(0, narrations.length).map((s, i) => {
        const start = round(cursor, 3);
        cursor += durations[i] ?? 0;
        return {
          projectId: payload.projectId,
          sceneNumber: i + 1,
          narration: s.text,
          visualPrompt: s.visualPrompt,
          visualType: s.visualType as 'image',
          sourceType: 'AI_GENERATED' as const,
          duration: durations[i] ?? 0,
          startTime: start,
          caption: s.caption,
          transition: s.transition,
          status: 'PENDING',
        };
      }),
    );

    await renderProject(payload, project, charged);
  } catch (err) {
    await db.update(projects).set({ status: 'FAILED' }).where(eq(projects.id, payload.projectId));
    if (charged.length) await refundCredits(payload.userId, charged, { reason: 'regen_failed' }).catch(() => undefined);
    const pe = toPublicError(err);
    await db.update(generationJobs).set({ error: pe.publicMessage, errorDetail: pe.detail })
      .where(eq(generationJobs.id, payload.jobId));
    throw err;
  }
}

/** Regenerate voiceover only, then re-mux captions + render. */
export async function regenerateVoice(payload: JobPayload): Promise<void> {
  const db = await getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId)).limit(1);
  if (!project) throw new Error('Project not found.');

  const charged: Operation[] = ['voice'];
  try {
    await db.update(projects).set({ status: 'GENERATING_VOICE' }).where(eq(projects.id, payload.projectId));
    const [latestScript] = await db.select().from(scripts).where(eq(scripts.projectId, payload.projectId))
      .orderBy(scripts.version).limit(1);
    if (!latestScript) throw new ProviderError('Generate a script before creating a voiceover.', 'pipeline', false);

    const voice = getVoice();
    const result = await voice.synthesize(latestScript.body, {
      voiceId: project.voiceId ?? 'mock_marcus',
      voiceName: project.voiceName ?? 'Marcus (Demo)',
      speed: project.voiceSpeed,
      stability: 0.5,
    });

    await chargeCredits(payload.userId, ['voice'], { projectId: payload.projectId });
    const storage = getStorage();
    const key = projectKey(payload.userId, payload.projectId, 'audio', 'voiceover.wav');
    await storage.put(key, result.audio, result.contentType);

    await db.insert(audioAssets).values({
      projectId: payload.projectId,
      voiceId: result.settings.voiceId,
      voiceName: result.settings.voiceName ?? null,
      provider: result.provider as 'mock',
      generationId: result.generationId,
      audioUrl: await storage.publicUrl(key),
      storageKey: key,
      duration: result.durationSeconds,
      settings: result.settings as unknown as Record<string, unknown>,
    });

    await renderProject(payload, project, charged);
  } catch (err) {
    await db.update(projects).set({ status: 'FAILED' }).where(eq(projects.id, payload.projectId));
    await refundCredits(payload.userId, charged, { reason: 'regen_failed' }).catch(() => undefined);
    throw err;
  }
}

/** Regenerate one scene's visual only. */
export async function regenerateVisual(payload: JobPayload): Promise<void> {
  const db = await getDb();
  const sceneId = Number(payload.options.sceneId);
  const [scene] = await db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1);
  if (!scene || scene.projectId !== payload.projectId) throw new Error('Scene not found.');

  const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId)).limit(1);
  if (!project) throw new Error('Project not found.');

  await db.update(scenes).set({ status: 'PENDING' }).where(eq(scenes.id, sceneId));

  const prompt =
    (payload.options.prompt as string) ||
    scene.visualPrompt ||
    buildVisualPrompt(scene.narration, project.visualStyle);

  const image = getImage();
  const spec = PRESET_VIDEO_SPECS[(project.preset as Preset) ?? 'youtube_shorts'];
  const result = await image.generate({
    prompt,
    width: project.qualityMode === 'draft' ? 768 : spec.width,
    height: project.qualityMode === 'draft' ? 1366 : spec.height,
    // A bumped seed guarantees a different image on retry.
    seed: seedFrom(`${prompt}:${Date.now()}`),
    qualityMode: project.qualityMode as 'draft' | 'standard' | 'premium',
  });

  const storage = getStorage();
  const key = projectKey(
    payload.userId,
    payload.projectId,
    'visuals',
    `scene-${String(scene.sceneNumber).padStart(3, '0')}-${Date.now()}.${result.contentType.includes('png') ? 'png' : 'jpg'}`,
  );
  await storage.put(key, result.buffer, result.contentType);

  await db.update(scenes).set({
    visualUrl: await storage.publicUrl(key),
    visualPrompt: prompt,
    status: 'READY',
    sourceType: result.sourceType,
    sourceProvider: result.provider,
    sourceUrl: result.sourceUrl ?? null,
    licenseNote: result.licenseNote ?? null,
    updatedAt: new Date(),
  }).where(eq(scenes.id, sceneId));

  await chargeCredits(payload.userId, ['visual_regen'], { sceneId }).catch(() => undefined);
  log.info('scene.visual_regenerated', { job_id: payload.publicId, scene: scene.sceneNumber });
}

/** Regenerate a single scene's narration + prompt. */
export async function regenerateScene(payload: JobPayload): Promise<void> {
  const db = await getDb();
  const sceneId = Number(payload.options.sceneId);
  const [scene] = await db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1);
  if (!scene || scene.projectId !== payload.projectId) throw new Error('Scene not found.');

  const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId)).limit(1);
  if (!project) throw new Error('Project not found.');

  const instruction =
    (payload.options.instruction as string) ||
    'Rewrite this beat with a stronger, more specific visual and narration.';

  const llm = getLLM();
  const result = await llm.generateScript({
    topic: `${project.topic} — beat: ${scene.narration.slice(0, 80)}`,
    category: project.category,
    style: project.scriptStyle,
    targetDuration: Math.max(5, Math.round(scene.duration)),
    language: project.language,
    revisionInstruction: instruction,
  });

  const beat = result.scenes[0];
  if (!beat) throw new ProviderError('The model returned no replacement scene.', 'pipeline', false);

  await db.update(scenes).set({
    narration: beat.text,
    visualPrompt: beat.visualPrompt,
    caption: beat.caption,
    transition: beat.transition,
    visualType: beat.visualType as 'image',
    updatedAt: new Date(),
  }).where(eq(scenes.id, sceneId));

  await chargeCredits(payload.userId, ['script_regen'], { sceneId }).catch(() => undefined);
}

/** Rebuild captions from the current scene timings. */
export async function regenerateCaptions(payload: JobPayload): Promise<void> {
  const db = await getDb();
  const sceneRows = await db.select().from(scenes)
    .where(eq(scenes.projectId, payload.projectId)).orderBy(scenes.sceneNumber);
  if (sceneRows.length === 0) throw new ProviderError('No scenes to caption.', 'pipeline', false);

  const narrations = sceneRows.map((s) => s.narration);
  const durations = sceneRows.map((s) => s.duration);
  const words = buildWordTimings(narrations, durations);
  const cues = groupIntoCues(words, 4, 2.4);

  const storage = getStorage();
  const srtKey = projectKey(payload.userId, payload.projectId, 'captions', 'captions.srt');
  const vttKey = projectKey(payload.userId, payload.projectId, 'captions', 'captions.vtt');
  await storage.put(srtKey, Buffer.from(toSrt(cues), 'utf8'), 'application/x-subrip');
  await storage.put(vttKey, Buffer.from(toVtt(cues), 'utf8'), 'text/vtt');

  await db.delete(captionAssets).where(eq(captionAssets.projectId, payload.projectId));
  await db.insert(captionAssets).values({
    projectId: payload.projectId,
    srtUrl: await storage.publicUrl(srtKey),
    vttUrl: await storage.publicUrl(vttKey),
    words,
    provider: 'mock',
  });
}

/** Re-render the video from whatever scenes/assets currently exist. */
export async function rerenderOnly(payload: JobPayload): Promise<void> {
  const db = await getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId)).limit(1);
  if (!project) throw new Error('Project not found.');
  await renderProject(payload, project, []);
}

/**
 * Shared render stage used by every regeneration path.
 * Reads current scenes/audio from the database and produces a new video.
 */
async function renderProject(
  payload: JobPayload,
  project: typeof projects.$inferSelect,
  charged: Operation[],
): Promise<void> {
  const db = await getDb();
  const storage = getStorage();
  const spec = PRESET_VIDEO_SPECS[(project.preset as Preset) ?? 'youtube_shorts'];

  const sceneRows = await db.select().from(scenes)
    .where(eq(scenes.projectId, payload.projectId)).orderBy(scenes.sceneNumber);
  if (sceneRows.length === 0) throw new ProviderError('No scenes to render.', 'pipeline', false);

  const [latestAudio] = await db.select().from(audioAssets)
    .where(eq(audioAssets.projectId, payload.projectId))
    .orderBy(audioAssets.id).limit(1);
  if (!latestAudio?.storageKey) {
    throw new ProviderError(
      'No voiceover exists for this project yet. Generate a voiceover first.',
      'pipeline',
      false,
    );
  }

  const [captionRow] = await db.select().from(captionAssets)
    .where(eq(captionAssets.projectId, payload.projectId)).limit(1);
  const words = captionRow?.words ?? buildWordTimings(
    sceneRows.map((s) => s.narration),
    sceneRows.map((s) => s.duration),
  );
  const cues = groupIntoCues(words, 4, 2.4);

  let musicKey: string | null = null;
  if (project.musicStyle !== 'none' && project.musicVolume > 0) {
    const total = sceneRows.reduce((a, s) => a + s.duration, 0);
    musicKey = projectKey(payload.userId, payload.projectId, 'audio', 'music.wav');
    await storage.put(musicKey, generateToneBed(total, MUSIC_PRESETS[project.musicStyle] ?? MUSIC_PRESETS.cinematic, 1), 'audio/wav');
  }

  await db.update(projects).set({ status: 'RENDERING', updatedAt: new Date() })
    .where(eq(projects.id, payload.projectId));
  await db.update(generationJobs).set({ stage: 'RENDERING', progress: 70 }).where(eq(generationJobs.id, payload.jobId));

  const videoKey = projectKey(payload.userId, payload.projectId, 'renders', 'final.mp4');
  const thumbKey = projectKey(payload.userId, payload.projectId, 'renders', 'thumbnail.jpg');

  const result = await getRenderer().render({
    projectId: payload.projectId,
    duration: sceneRows.reduce((a, s) => a + s.duration, 0),
    width: spec.width,
    height: spec.height,
    fps: spec.fps,
    bitrate: spec.bitrate,
    audioKey: latestAudio.storageKey,
    audioDuration: latestAudio.duration,
    scenes: sceneRows.map((s, i) => ({
      index: i,
      start: s.startTime,
      duration: s.duration,
      visualKey: keyFromUrl(s.visualUrl),
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
  });

  await chargeCredits(payload.userId, ['render'], { projectId: payload.projectId });
  charged.push('render');

  const qc = await qualityCheck({
    storageKey: videoKey,
    expected: { width: spec.width, height: spec.height, duration: sceneRows.reduce((a, s) => a + s.duration, 0) },
    sceneCount: sceneRows.length,
    captionsEnabled: cues.length > 0,
    sizeBytes: result.sizeBytes,
  });

  await db.insert(videoAssets).values({
    projectId: payload.projectId,
    provider: result.provider as 'ffmpeg',
    videoUrl: await storage.publicUrl(videoKey),
    storageKey: videoKey,
    thumbnailUrl: result.thumbnailKey ? await storage.publicUrl(result.thumbnailKey) : null,
    duration: result.duration,
    resolution: `${result.width}x${result.height}`,
    fps: result.fps,
    sizeBytes: result.sizeBytes,
    checksum: result.checksum,
    qcReport: qc as unknown as Record<string, unknown>,
  });

  if (!qc.passed) {
    throw new ProviderError(`Quality check failed: ${qc.failures.join('; ')}`, 'ffmpeg', false);
  }

  await db.update(projects).set({
    status: 'COMPLETED',
    actualDuration: round(result.duration, 2),
    thumbnailUrl: result.thumbnailKey ? await storage.publicUrl(result.thumbnailKey) : null,
    updatedAt: new Date(),
  }).where(eq(projects.id, payload.projectId));
}

function keyFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = '/api/assets/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

export type { RegenerateKind };
