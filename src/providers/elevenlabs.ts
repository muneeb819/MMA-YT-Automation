/**
 * ElevenLabs voice provider.
 *
 * Word-level alignment is requested where the model supports it, so captions
 * come from real forced-alignment timestamps rather than estimation.
 */
import { config } from '@/lib/config';
import { probeMedia, runFfmpeg } from './ffmpeg-runner';
import { getFfmpegPath } from './ffmpeg-runner';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  type ProviderHealth,
  type VoiceOption,
  type VoiceProvider,
  type VoiceResult,
  type VoiceSettings,
  ProviderError,
} from './types';

const API_BASE = 'https://api.elevenlabs.io/v1';

export interface ElevenLabsWord {
  text: string;
  start: number;
  end: number;
}

export class ElevenLabsProvider implements VoiceProvider {
  readonly name = 'elevenlabs';

  isConfigured(): boolean {
    return config.voice.configured;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'xi-api-key': config.voice.apiKey, ...extra };
  }

  async health(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return { provider: this.name, status: 'unconfigured', detail: 'ELEVENLABS_API_KEY not set' };
    }
    const started = Date.now();
    try {
      const res = await fetch(`${API_BASE}/voices`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok
        ? { provider: this.name, status: 'healthy', detail: 'API reachable', latencyMs: Date.now() - started }
        : {
            provider: this.name,
            status: 'degraded',
            detail: `voices endpoint returned ${res.status}`,
          };
    } catch (err) {
      return {
        provider: this.name,
        status: 'degraded',
        detail: err instanceof Error ? err.message : 'unreachable',
      };
    }
  }

  async listVoices(): Promise<VoiceOption[]> {
    if (!this.isConfigured()) return [];

    const res = await fetch(`${API_BASE}/voices`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new ProviderError(
        `ElevenLabs voice list failed (${res.status}).`,
        this.name,
        res.status >= 500,
        res.status,
      );
    }

    const json = (await res.json()) as {
      voices?: {
        voice_id: string;
        name: string;
        labels?: Record<string, string>;
        description?: string | null;
        preview_url?: string;
      }[];
    };

    return (json.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      gender: normaliseGender(v.labels?.gender),
      accent: v.labels?.accent ?? 'International',
      language: v.labels?.language ?? 'en',
      previewUrl: v.preview_url,
      description: v.description ?? undefined,
      provider: this.name,
    }));
  }

  async synthesize(text: string, settings: VoiceSettings): Promise<VoiceResult> {
    if (!this.isConfigured()) {
      throw new ProviderError(
        'ElevenLabs is not configured. Set ELEVENLABS_API_KEY or run in demo mode.',
        this.name,
        false,
        503,
      );
    }

    const voiceId = encodeURIComponent(settings.voiceId);
    const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json', Accept: 'audio/mpeg' }),
      body: JSON.stringify({
        text,
        model_id: settings.model ?? config.voice.model,
        voice_settings: {
          stability: clamp01(settings.stability),
          similarity_boost: clamp01(settings.similarityBoost ?? 0.75),
          style: clamp01(settings.style ?? 0),
          use_speaker_boost: true,
          // ElevenLabs expresses rate change as a percentage delta.
          speed: clamp(settings.speed, 0.7, 1.2),
        },
      }),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const text2 = await res.text().catch(() => '');
      throw new ProviderError(
        `ElevenLabs synthesis failed (${res.status}): ${text2.slice(0, 300)}`,
        this.name,
        res.status === 429 || res.status >= 500,
        res.status,
      );
    }

    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.byteLength === 0) {
      throw new ProviderError('ElevenLabs returned an empty audio payload.', this.name, true);
    }

    // Normalise to WAV so the renderer gets a consistent input format.
    const normalized = await this.toWav(audio);
    const probe = await probeMedia(normalized.path);

    return {
      audio: normalized.buffer,
      contentType: 'audio/wav',
      durationSeconds: probe.duration,
      generationId: res.headers.get('x-request-id') ?? `el_${Date.now()}`,
      provider: this.name,
      settings,
    };
  }

  private async toWav(input: Buffer): Promise<{ buffer: Buffer; path: string }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-voice-'));
    const inPath = path.join(dir, 'in.mp3');
    const outPath = path.join(dir, 'out.wav');
    await fs.writeFile(inPath, input);
    try {
      await runFfmpeg(['-i', inPath, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outPath]);
      const buffer = await fs.readFile(outPath);
      return { buffer, path: outPath };
    } finally {
      // Keep the file for probeMedia, then clean up.
      setTimeout(() => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined), 10_000);
    }
  }

  /**
   * Request word-level alignment. Supported on some models; callers fall back
   * to estimated timings when this returns nothing.
   */
  async getAlignment(
    text: string,
    settings: VoiceSettings,
  ): Promise<{ word: string; start: number; end: number }[]> {
    if (!this.isConfigured()) return [];
    try {
      const res = await fetch(`${API_BASE}/text-to-speech/${encodeURIComponent(settings.voiceId)}/with-timestamps`, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          text,
          model_id: settings.model ?? config.voice.model,
          voice_settings: { stability: clamp01(settings.stability) },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as {
        alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
      };
      const a = json.alignment;
      if (!a?.characters) return [];

      const out: { word: string; start: number; end: number }[] = [];
      let current = '';
      let startIdx = 0;
      a.characters.forEach((ch, i) => {
        if (/\s/.test(ch)) {
          if (current) {
            out.push({
              word: current,
              start: a.character_start_times_seconds[startIdx] ?? 0,
              end: a.character_end_times_seconds[i - 1] ?? 0,
            });
            current = '';
          }
          return;
        }
        if (!current) startIdx = i;
        current += ch;
      });
      if (current) {
        out.push({
          word: current,
          start: a.character_start_times_seconds[startIdx] ?? 0,
          end: a.character_end_times_seconds[a.characters.length - 1] ?? 0,
        });
      }
      return out;
    } catch {
      return [];
    }
  }
}

function normaliseGender(value?: string): 'male' | 'female' | 'neutral' {
  const v = (value ?? '').toLowerCase();
  if (v.includes('male')) return 'male';
  if (v.includes('female')) return 'female';
  return 'neutral';
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export { getFfmpegPath };
