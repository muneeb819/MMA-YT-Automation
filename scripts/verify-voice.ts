/**
 * Real ElevenLabs adapter test.
 *
 * Calls the live TTS endpoint through our own provider class, then verifies the
 * returned audio is genuine, playable and correctly measured.
 *
 * Run: node --env-file=.env.local --import tsx scripts/verify-voice.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ElevenLabsProvider } from '../src/providers/elevenlabs';
import { probeMedia, getFfmpegPath } from '../src/providers/ffmpeg-runner';
import { buildWordTimings, groupIntoCues, toSrt } from '../src/lib/timing';

async function main() {
  const provider = new ElevenLabsProvider();

  console.log('ffmpeg:', await getFfmpegPath());
  console.log('health:', JSON.stringify(await provider.health()));

  const voices = await provider.listVoices();
  console.log(`\nvoices: ${voices.length}`);

  // Pick a narrator voice when available.
  const preferred =
    voices.find((v) => /adam|onyx|roger|george/i.test(v.name)) ?? voices[0];
  console.log(`using: ${preferred.name} (${preferred.id})`);

  const text =
    'Nobody expected what happened next. The detail everyone missed changed the ending entirely.';

  const started = Date.now();
  const result = await provider.synthesize(text, {
    voiceId: preferred.id,
    voiceName: preferred.name,
    speed: 1,
    stability: 0.5,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\nsynthesis succeeded in ${elapsed}s`);
  console.log('  provider    :', result.provider);
  console.log('  contentType :', result.contentType);
  console.log('  audio bytes :', result.audio.byteLength);
  console.log('  duration    :', result.durationSeconds, 's');
  console.log('  generationId:', result.generationId);

  // Verify the audio is a real, decodable WAV.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-tts-'));
  const wav = path.join(dir, 'out.wav');
  await fs.writeFile(wav, result.audio);

  const magic = result.audio.subarray(0, 4).toString('latin1');
  console.log('  magic bytes :', magic, magic === 'RIFF' ? '(valid WAV)' : '(NOT a WAV!)');

  const probe = await probeMedia(wav);
  console.log('  probed      :', `${probe.width}x${probe.height}`, `dur=${probe.duration}s`, `audio=${probe.hasAudio}`);

  // Independent decode to prove playability.
  const ffmpeg = await getFfmpegPath();
  const outPcm = path.join(dir, 'pcm.wav');
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', wav, '-f', 'wav', outPcm], {
    windowsHide: true,
  });
  const decoded = (await fs.stat(outPcm).catch(() => null))?.size ?? 0;
  console.log('  re-decoded  :', r.status === 0 ? `OK (${Math.round(decoded / 1024)} KB)` : `FAILED (${r.status})`);

  // Build captions from the measured duration to prove the caption path works.
  const sceneText = [text];
  const durations = [result.durationSeconds];
  const words = buildWordTimings(sceneText, durations);
  const cues = groupIntoCues(words, 4, 2.4);
  console.log(`\ncaptions: ${words.length} word timings -> ${cues.length} cues`);
  console.log(toSrt(cues).split('\n').slice(0, 8).join('\n'));

  const ok =
    magic === 'RIFF' &&
    result.audio.byteLength > 10_000 &&
    probe.hasAudio &&
    probe.duration > 0 &&
    r.status === 0;

  await fs.rm(dir, { recursive: true, force: true });

  console.log(`\n${ok ? 'PASS' : 'FAIL'}: real ElevenLabs synthesis verified end to end.`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
