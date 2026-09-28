/**
 * FFmpeg process wrapper.
 *
 * Resolves the real ffmpeg binary from `ffmpeg-static` (no system install or
 * admin rights required), and centralises argument construction + error
 * translation so the renderer and image generator share one battle-tested path.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ProviderError } from './types';

const require = createRequire(import.meta.url);

let cachedBinary: string | null = null;

export async function getFfmpegPath(): Promise<string> {
  if (cachedBinary) return cachedBinary;

  // 1. Explicit override (production containers often ship their own build).
  if (process.env.FFMPEG_PATH) {
    cachedBinary = process.env.FFMPEG_PATH;
    return cachedBinary;
  }

  // 2. Bundled static binary.
  try {
    const mod = require('ffmpeg-static');
    const p = typeof mod === 'string' ? mod : (mod as { default?: string }).default;
    if (p) {
      await fs.access(p);
      cachedBinary = p;
      return cachedBinary;
    }
  } catch {
    // fall through to PATH lookup
  }

  // 3. System install.
  cachedBinary = 'ffmpeg';
  return cachedBinary;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface RunOptions {
  timeoutMs?: number;
  /** Injected for tests. */
  cwd?: string;
}

export async function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const bin = await getFfmpegPath();
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
      cwd: opts.cwd,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new ProviderError(
          `FFmpeg timed out after ${Math.round(timeoutMs / 1000)}s.`,
          'ffmpeg',
          true,
          504,
        ),
      );
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new ProviderError(
          `Failed to launch FFmpeg: ${err.message}. Ensure ffmpeg-static is installed or set FFMPEG_PATH.`,
          'ffmpeg',
          false,
          500,
          err,
        ),
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr, durationMs: Date.now() - started });
      } else {
        reject(
          new ProviderError(
            `FFmpeg exited with code ${code}: ${stderr.trim().slice(0, 800) || 'no error output'}`,
            'ffmpeg',
            // Certain failures (bad input) will never succeed on retry.
            false,
            500,
          ),
        );
      }
    });
  });
}

export async function getFfprobePath(): Promise<string | null> {
  const staticDir = path.dirname(await getFfmpegPath());
  const candidate = path.join(staticDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export interface MediaProbe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  sizeBytes: number;
  codec?: string;
  audioCodec?: string;
}

/**
 * Probe a media file. Uses ffprobe when available; otherwise derives duration
 * from the container by parsing ffmpeg's stderr banner.
 */
export async function probeMedia(filePath: string): Promise<MediaProbe> {
  const probePath = await getFfprobePath();

  if (probePath) {
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        probePath,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
        { windowsHide: true },
      );
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (err += d.toString()));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve(out) : reject(new Error(err || `ffprobe exited ${code}`)),
      );
    });

    const parsed = JSON.parse(raw) as {
      format?: { duration?: string; size?: string };
      streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; duration?: string }[];
    };

    const video = parsed.streams?.find((s) => s.codec_type === 'video');
    const audio = parsed.streams?.find((s) => s.codec_type === 'audio');
    const [num, den] = (video?.r_frame_rate ?? '30/1').split('/').map(Number);

    return {
      duration: Number(parsed.format?.duration ?? video?.duration ?? 0),
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      fps: den ? Math.round((num / den) * 100) / 100 : 30,
      hasAudio: !!audio,
      hasVideo: !!video,
      sizeBytes: Number(parsed.format?.size ?? 0),
      codec: video?.codec_name,
      audioCodec: audio?.codec_name,
    };
  }

  // Fallback: run ffmpeg at the default (info) log level so the stream banner
  // is emitted, then parse duration/resolution out of stderr.
  const bin = await getFfmpegPath();
  const info = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-nostdin', '-i', filePath, '-f', 'null', '-'], {
      windowsHide: true,
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.stdout.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    // ffmpeg exits non-zero with no output; stderr is still valid info.
    child.on('close', () => resolve(err));
  });

  const toSeconds = (h: string, m: string, s: string) => Number(h) * 3600 + Number(m) * 60 + Number(s);

  // Containers with a header (WAV/MP4/MOV) report "Duration:" in the banner.
  // Raw/streamed formats only expose progress via "time=".
  const headerDuration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
  const progressDuration = /time=(\d+):(\d+):(\d+\.\d+)/.exec(info);
  const videoLine = /Stream #\d+:\d+.*Video: (\w+).*?(\d{2,5})x(\d{2,5})/.exec(info);
  const hasAudio = /Stream #\d+:\d+.*Audio:/.test(info);
  const hasVideo = !!videoLine;
  const fpsLine = /(\d+(?:\.\d+)?)\s*fps/.exec(info);

  return {
    duration: headerDuration
      ? toSeconds(headerDuration[1], headerDuration[2], headerDuration[3])
      : progressDuration
        ? toSeconds(progressDuration[1], progressDuration[2], progressDuration[3])
        : 0,
    width: videoLine ? Number(videoLine[2]) : 0,
    height: videoLine ? Number(videoLine[3]) : 0,
    fps: fpsLine ? Math.round(Number(fpsLine[1]) * 100) / 100 : 30,
    hasAudio,
    hasVideo,
    sizeBytes: 0,
    codec: videoLine?.[1],
  };
}
