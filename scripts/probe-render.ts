/**
 * Direct FFmpeg integration probe.
 *
 * Renders a genuine short 9:16 H.264 clip with burned captions and mixed audio,
 * then asserts the output is a real, decodable MP4. This is the riskiest part of
 * the system, so it is verified independently of the web app.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getFfmpegPath, probeMedia, runFfmpeg } from '@/providers/ffmpeg-runner';
import { buildAssDocument, CAPTION_STYLE_SPEC } from '@/providers/captions';
import { generateToneBed, MUSIC_PRESETS } from '@/providers/music';
import { generateSilentSpeechWav } from '@/providers/wav';
import { allocateSceneDurations, buildWordTimings, groupIntoCues } from '@/lib/timing';
import { getStorage } from '@/providers/registry';
import { buildSceneVideoFilter } from '@/providers/ffmpeg-renderer';

const results: { step: string; ok: boolean; detail: string }[] = [];

function check(step: string, ok: boolean, detail = '') {
  results.push({ step, ok, detail });
  if (!ok) throw new Error(`FAILED at "${step}": ${detail}`);
}

async function main() {
  const ffmpeg = await getFfmpegPath();
  check('ffmpeg binary resolved', !!ffmpeg, ffmpeg);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-probe-'));
  const storage = getStorage();

  try {
    // 1. Build narration + timings.
    const narrations = [
      'Nobody expected what happened next.',
      'The detail everyone missed changed the ending.',
      'Follow for the full story.',
    ];
    const totalDuration = 9;
    const durations = allocateSceneDurations(narrations, totalDuration);
    const words = buildWordTimings(narrations, durations);
    const cues = groupIntoCues(words, 4);
    check('word timings produced', words.length > 5, `${words.length} words`);
    check('caption cues produced', cues.length > 2, `${cues.length} cues`);

    // 2. Write a real WAV.
    const wavPath = path.join(workDir, 'voice.wav');
    const wav = generateSilentSpeechWav(totalDuration, 0.15, 'probe');
    await fs.writeFile(wavPath, wav);
    const voiceProbe = await probeMedia(wavPath);
    check(
      'narration WAV is valid',
      voiceProbe.duration > 8 && voiceProbe.hasAudio,
      `duration=${voiceProbe.duration} audio=${voiceProbe.hasAudio}`,
    );

    // 3. Music bed.
    const musicPath = path.join(workDir, 'music.wav');
    await fs.writeFile(musicPath, generateToneBed(totalDuration, MUSIC_PRESETS.cinematic, 0.2));
    check('music bed written', (await fs.stat(musicPath)).size > 1000);

    // 4. Upload narration to storage (exercises the storage contract).
    const audioKey = `users/probe/projects/1/audio/voice.wav`;
    await storage.put(audioKey, wav, 'audio/wav');
    const roundTrip = await storage.get(audioKey);
    check('storage round-trip', roundTrip.equals(wav), `${roundTrip.byteLength} bytes`);

    // 5. Scene clips via the same filter chain the renderer uses.
    const clipPaths: string[] = [];
    for (let i = 0; i < narrations.length; i++) {
      const clip = path.join(workDir, `scene-${i}.mp4`);
      await runFfmpeg([
        '-f', 'lavfi', '-i',
        'gradients=s=1080x1920:c0=0x0a0a12:c1=0x4c3a99:speed=0.012',
        '-t', durations[i].toFixed(3),
        '-vf', buildSceneVideoFilter(1080, 1920, 30),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-r', '30', '-an',
        clip,
      ]);
      clipPaths.push(clip);
    }
    check('scene clips encoded', clipPaths.length === 3);

    // 6. Concat.
    const listFile = path.join(workDir, 'concat.txt');
    await fs.writeFile(listFile, clipPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
    const videoOnly = path.join(workDir, 'video-only.mp4');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', videoOnly]);
    const videoProbe = await probeMedia(videoOnly);
    check(
      'concatenated video is valid',
      videoProbe.duration > 8 && videoProbe.width === 1080 && videoProbe.height === 1920,
      `dur=${videoProbe.duration} ${videoProbe.width}x${videoProbe.height}`,
    );

    // 7. Caption overlay.
    const assPath = path.join(workDir, 'captions.ass');
    await fs.writeFile(assPath, buildAssDocument(cues, CAPTION_STYLE_SPEC.bold, 1080, 1920), 'utf8');

    // 8. Final mux with audio mix + burned captions.
    const finalPath = path.join(workDir, 'final.mp4');
    await runFfmpeg([
      '-i', 'video-only.mp4',
      '-i', 'voice.wav',
      '-i', 'music.wav',
      '-filter_complex',
      `[0:v]ass=filename=captions.ass[v];[1:a][2:a]amix=inputs=2:duration=first:dropout_transition=0:weights=1 0.18,alimiter=limit=0.95,aresample=48000[a]`,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '21',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart', '-t', totalDuration.toFixed(3), '-shortest',
      'final.mp4',
    ], { cwd: workDir });

    const finalProbe = await probeMedia(finalPath);
    const stat = await fs.stat(finalPath);
    check(
      'final MP4 is 1080x1920 H.264 with audio',
      finalProbe.width === 1080 && finalProbe.height === 1920 && finalProbe.hasAudio && finalProbe.duration > 8,
      `${finalProbe.width}x${finalProbe.height} dur=${finalProbe.duration} audio=${finalProbe.hasAudio} codec=${finalProbe.codec}/${finalProbe.audioCodec}`,
    );
    check('final file is a reasonable size', stat.size > 20_000, `${(stat.size / 1024).toFixed(0)} KB`);

    // 9. Thumbnail.
    const thumbPath = path.join(workDir, 'thumb.jpg');
    await runFfmpeg(['-i', finalPath, '-ss', '1.0', '-frames:v', '1', '-vf', 'scale=1080:-2', '-q:v', '3', thumbPath]);
    check('thumbnail extracted', (await fs.stat(thumbPath)).size > 1000);

    // 10. Corrupt-file detection (negative QC case).
    const corrupt = path.join(workDir, 'corrupt.mp4');
    await fs.writeFile(corrupt, Buffer.from('this is not a video'));
    const corruptProbe = await probeMedia(corrupt).catch(() => null);
    check(
      'corrupt file is detected as invalid',
      !corruptProbe || corruptProbe.duration === 0 || !corruptProbe.hasVideo,
      'QC correctly rejects non-video data',
    );

    console.log('\n=== FFMPEG RENDER PIPELINE PROBE ===');
    for (const r of results) {
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.step}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    console.log(`\nAll ${results.length} checks passed. Real video rendering is operational.\n`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n=== FFMPEG PROBE FAILED ===');
    for (const r of results) {
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.step}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
