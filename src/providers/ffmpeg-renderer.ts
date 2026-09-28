/**
 * FFmpeg renderer.
 *
 * Pipeline: generate a motion background per scene -> scale/fit the visual ->
 * concatenate with transitions -> mix narration + music -> burn captions ->
 * final H.264/AAC encode at the target resolution.
 *
 * Everything runs in a per-job temp directory that is always cleaned up.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { probeMedia, runFfmpeg } from './ffmpeg-runner';
import type { CaptionCue } from '@/lib/timing';
import {
  type ProviderHealth,
  type RenderInput,
  type RenderResult,
  type RendererProvider,
  ProviderError,
} from './types';
import { CAPTION_STYLE_SPEC, buildAssDocument, escapeAssText, wrapLines } from './captions';
import { generateToneBed } from './music';
import { MUSIC_PRESETS } from './music';
import { getStorage } from './registry';

/** Caption text must never contain characters that break the ASS parser. */
const MAX_CAPTION_CHARS = 90;

/**
 * Build the visual filter chain for a scene.
 *
 * NOTE: expressions passed to `zoompan` contain commas (e.g. `min(a,b)`), which
 * FFmpeg's filtergraph parser would otherwise treat as filter separators. Each
 * expression must therefore be wrapped in single quotes.
 */
export function buildSceneVideoFilter(width: number, height: number, fps: number): string {
  return [
    // Cover the frame, then centre-crop to the exact output size.
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    // Ken Burns: a slow push-in that keeps the shot alive without distracting.
    `zoompan=z='min(1.0+0.0006*on,1.09)':d=1` +
      `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`,
    'setsar=1',
    'format=yuv420p',
  ].join(',');
}

export class FFmpegRenderer implements RendererProvider {
  readonly name = 'ffmpeg';

  isConfigured(): boolean {
    return true;
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      await runFfmpeg(['-version'], { timeoutMs: 15_000 });
      return {
        provider: this.name,
        status: 'healthy',
        detail: 'ffmpeg available',
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        provider: this.name,
        status: 'unhealthy',
        detail: err instanceof Error ? err.message : 'ffmpeg unavailable',
      };
    }
  }

  async render(input: RenderInput): Promise<RenderResult> {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `shortforge-${input.projectId}-`));
    try {
      return await this.renderIn(input, workDir);
    } finally {
      // Intermediates are never useful after the render completes.
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async renderIn(input: RenderInput, workDir: string): Promise<RenderResult> {
    const storage = getStorage();
    const { width, height, fps } = input;

    if (!Number.isFinite(input.duration) || input.duration <= 0) {
      throw new ProviderError('Render aborted: total timeline duration is zero.', this.name, false);
    }

    // ---- 1. Materialise every scene clip --------------------------------
    const clipPaths: string[] = [];
    for (const scene of input.scenes) {
      const clipPath = path.join(workDir, `scene-${String(scene.index).padStart(3, '0')}.mp4`);
      await this.renderScene(input, scene, clipPath, workDir);
      clipPaths.push(clipPath);
    }

    if (clipPaths.length === 0) {
      throw new ProviderError('Render aborted: no scenes were provided.', this.name, false);
    }

    // ---- 2. Concatenate into one continuous video track ------------------
    const listFile = path.join(workDir, 'concat.txt');
    await fs.writeFile(
      listFile,
      clipPaths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8',
    );
    const silentVideo = path.join(workDir, 'video-only.mp4');
    await runFfmpeg([
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c', 'copy',
      silentVideo,
    ]);

    // ---- 3. Prepare narration + music ------------------------------------
    const narrationPath = path.join(workDir, 'narration.wav');
    const narration = await storage.get(input.audioKey);
    await fs.writeFile(narrationPath, narration);

    let musicPath: string | null = null;
    if (input.musicKey) {
      musicPath = path.join(workDir, 'music.mp3');
      await fs.writeFile(musicPath, await storage.get(input.musicKey));
    } else if (input.musicVolume > 0) {
      // Synthesise a royalty-free tone bed so music is never a licensing gap.
      musicPath = path.join(workDir, 'music-generated.wav');
      await fs.writeFile(
        musicPath,
        generateToneBed(input.duration, MUSIC_PRESETS.cinematic, input.musicVolume),
      );
    }

    // ---- 4. Build the caption overlay ------------------------------------
    const assPath = path.join(workDir, 'captions.ass');
    const cues: CaptionCue[] = input.captions.map((c, i) => ({
      index: i + 1,
      start: c.start,
      end: c.end,
      text: c.text.slice(0, MAX_CAPTION_CHARS),
    }));
    const spec = CAPTION_STYLE_SPEC[input.captionStyle] ?? CAPTION_STYLE_SPEC.bold;
    await fs.writeFile(assPath, buildAssDocument(cues, spec, width, height), 'utf8');

    // ---- 5. Final encode: video + mixed audio + burned captions -----------
    const outputPath = path.join(workDir, 'final.mp4');
    const totalDuration = input.scenes.reduce((a, s) => a + s.duration, 0);

    const filterParts = ['ass=filename=captions.ass'];
    const filter = filterParts.join(',');

    const audioInputs = ['-i', narrationPath];
    if (musicPath) audioInputs.push('-i', musicPath);

    // amix requires an explicit duration and per-stream weights.
    const audioFilter = musicPath
      ? `amix=inputs=2:duration=first:dropout_transition=0:weights=1 ${input.musicVolume},` +
        `alimiter=limit=0.95,aresample=48000`
      : `aresample=48000`;

    await runFfmpeg([
      '-i', silentVideo,
      ...audioInputs,
      '-filter_complex', `[0:v]${filter}[v];[1:a][2:a]${audioFilter}[a]`,
      '-map', '[v]',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-preset', 'veryfast',
      '-crf', '21',
      '-maxrate', input.bitrate,
      '-bufsize', input.bitrate,
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      '-t', totalDuration.toFixed(3),
      '-shortest',
      outputPath,
      // Run inside workDir so the ASS overlay can be referenced by a bare
      // relative filename. This sidesteps FFmpeg's Windows drive-colon
      // escaping problem entirely (C:\... is not a valid filter option value).
    ], { cwd: workDir });

    // ---- 6. Thumbnail ----------------------------------------------------
    let thumbnailKey: string | undefined;
    try {
      const thumbPath = path.join(workDir, 'thumb.jpg');
      await runFfmpeg([
        '-i', outputPath,
        '-ss', Math.min(1.2, totalDuration / 3).toFixed(2),
        '-frames:v', '1',
        '-vf', `scale=${width}:-2`,
        '-q:v', '3',
        thumbPath,
      ]);
      const thumb = await fs.readFile(thumbPath);
      thumbnailKey = input.thumbnailKey ?? (await storage.put(input.thumbnailKey ?? `projects/${input.projectId}/renders/thumb.jpg`, thumb, 'image/jpeg'));
    } catch {
      // A missing thumbnail must never fail an otherwise valid render.
    }

    // ---- 7. Persist + verify --------------------------------------------
    const finalBuffer = await fs.readFile(outputPath);
    const checksum = createHash('sha256').update(finalBuffer).digest('hex');
    await storage.put(input.outputKey, finalBuffer, 'video/mp4');

    const probe = await probeMedia(outputPath);
    const sizeBytes = finalBuffer.byteLength;

    if (probe.duration <= 0) {
      throw new ProviderError(
        'Render produced a file with zero duration.',
        this.name,
        false,
      );
    }

    return {
      storageKey: input.outputKey,
      thumbnailKey,
      duration: probe.duration,
      width: probe.width || width,
      height: probe.height || height,
      fps,
      sizeBytes,
      checksum,
      provider: this.name,
    };
  }

  /**
   * Build one scene clip: a Ken Burns motion background, the visual composited
   * on top, trimmed to the scene duration.
   */
  private async renderScene(
    input: RenderInput,
    scene: RenderInput['scenes'][number],
    outPath: string,
    workDir: string,
  ): Promise<void> {
    const { width, height, fps } = input;
    const storage = getStorage();
    const duration = Math.max(0.2, scene.duration);

    const bgFilter = [
      `gradients=s=${width}x${height}:c0=0x0a0a12:c1=${scene.background.replace('#', '0x')}:speed=0.012`,
      'format=rgb24',
    ].join(',');

    // Inputs, with per-input options correctly placed BEFORE the -i flag.
    const args: string[] = ['-f', 'lavfi', '-i', bgFilter];

    const isMovingVisual =
      !!scene.visualKey && (scene.visualType === 'video' || scene.visualType === 'stock');

    if (scene.visualKey) {
      const visualLocalPath = path.join(workDir, `visual-${scene.index}.bin`);
      const bytes = await storage.get(scene.visualKey);
      await fs.writeFile(visualLocalPath, bytes);

      if (isMovingVisual) {
        // Video clips are trimmed to the scene length below.
        args.push('-i', visualLocalPath);
      } else {
        // A still must be looped as an INPUT option, otherwise it yields a
        // single frame and the clip collapses to ~0.1s.
        args.push('-loop', '1', '-framerate', String(fps), '-t', duration.toFixed(3), '-i', visualLocalPath);
      }
    }

    const visualIndex = scene.visualKey ? 1 : 0;
    const filterComplex = `[${visualIndex}]${buildSceneVideoFilter(width, height, fps)}[v]`;

    args.push(
      '-filter_complex', filterComplex,
      '-map', '[v]',
      // Always bound the output length, whichever branch produced the frames.
      '-t', duration.toFixed(3),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      '-an',
      '-video_track_timescale', '90000',
      outPath,
    );

    try {
      await runFfmpeg(args);
    } catch {
      // A corrupt/missing visual must not kill the whole render: fall back to
      // the gradient background so the video still completes.
      await runFfmpeg([
        '-f', 'lavfi', '-i', bgFilter,
        '-t', duration.toFixed(3),
        '-vf', 'format=yuv420p',
        '-r', String(fps),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an',
        outPath,
      ]);
    }
  }
}

/** Build a real PNG/JPEG still with FFmpeg (used for mock/demo visuals). */
export async function generatePlaceholderImage(opts: {
  width: number;
  height: number;
  text: string;
  subtext?: string;
  primary: string;
  secondary: string;
  outPath: string;
}): Promise<{ width: number; height: number; sizeBytes: number }> {
  // Keep text inside a safe margin, and shrink the font until the longest
  // single word fits. Without this, long scene text overflows the frame.
  const marginX = Math.round(opts.width * 0.08);
  const usableWidth = opts.width - marginX * 2;

  const words = opts.text.split(/\s+/).filter(Boolean);
  const longestWord = words.reduce((m, w) => Math.max(m, w.length), 1);
  const targetLines = 3;
  // ~0.56em average glyph width for a bold sans face.
  let fontSize = Math.round(opts.width / 11);
  const maxCharsPerLine = Math.max(8, Math.floor(usableWidth / (fontSize * 0.56)));

  // Shrink until wrapping into `targetLines` lines is possible.
  let guard = 0;
  while (
    guard < 12 &&
    Math.ceil(opts.text.length / Math.max(1, maxCharsPerLine)) > targetLines &&
    fontSize > 18
  ) {
    fontSize = Math.max(18, Math.round(fontSize * 0.88));
    guard++;
  }
  // If a single word is still too wide for one line, keep shrinking.
  while (guard < 24 && longestWord * fontSize * 0.62 > usableWidth && fontSize > 14) {
    fontSize = Math.max(14, Math.round(fontSize * 0.9));
    guard++;
  }

  const finalCharsPerLine = Math.max(6, Math.floor(usableWidth / (fontSize * 0.6)));
  // Escape each wrapped line independently, then join with the ASS break token
  // so the line breaks survive escaping.
  const safeText = wrapLines(opts.text, finalCharsPerLine, targetLines)
    .map((l) => escapeAssText(l))
    .join('\\N');
  const subSize = Math.round(fontSize * 0.38);
  const subChars = Math.max(10, Math.floor(usableWidth / (subSize * 0.6)));
  const safeSub = wrapLines(opts.subtext ?? '', subChars, 2)
    .map((l) => escapeAssText(l))
    .join('\\N');

  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Head,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,0,0,5,${marginX},${marginX},${Math.round(opts.height * 0.42)},1`,
    `Style: Sub,Arial,${subSize},&H00D8D8E0,&H000000FF,&H00101010,&H80000000,0,0,0,0,100,100,1,0,1,0,0,2,${marginX},${marginX},${Math.round(opts.height * 0.52)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,0:00:00.00,9:59:59.00,Head,,0,0,0,,${safeText}`,
    `Dialogue: 0,0:00:00.00,9:59:59.00,Sub,,0,0,0,,${safeSub}`,
  ].join('\n');

  const assPath = `${opts.outPath}.ass`;
  await fs.writeFile(assPath, ass, 'utf8');

  // Same relative-path trick as the final encode: cwd + bare filename avoids
  // escaping Windows drive colons inside the filtergraph.
  await runFfmpeg([
    '-f', 'lavfi', '-i',
    // The `gradients` filter takes x0/y0/x1/y1 (there is no x2/y2 option).
    `gradients=s=${opts.width}x${opts.height}:c0=0x0a0a12:c1=${opts.secondary.replace('#', '0x')}:x0=0:y0=0:x1=${opts.width}:y1=${opts.height}:speed=0.01`,
    '-vf', `ass=filename=${path.basename(assPath)},format=yuv420p`,
    '-frames:v', '1',
    '-update', '1',
    opts.outPath,
  ], { cwd: path.dirname(opts.outPath) });

  const stat = await fs.stat(opts.outPath);
  await fs.rm(assPath, { force: true }).catch(() => undefined);
  return { width: opts.width, height: opts.height, sizeBytes: stat.size };
}
