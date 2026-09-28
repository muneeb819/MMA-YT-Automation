/**
 * Replicate image/video generation.
 *
 * Implemented against the public HTTP API (no SDK dependency). Also owns the
 * "mock visual" path: when Replicate is not configured it produces genuine
 * FFmpeg-rendered stills so the pipeline is fully exercisable in demo mode.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '@/lib/config';
import { generatePlaceholderImage } from './ffmpeg-renderer';
import {
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
  type ProviderHealth,
  ProviderError,
} from './types';

const API = 'https://api.replicate.com/v1';

/** Style-aware palettes so generated stills feel deliberate, not random. */
const STYLE_PALETTES: Record<string, { primary: string; secondary: string }> = {
  cinematic: { primary: '#7c5cff', secondary: '#1a1030' },
  documentary: { primary: '#c9a227', secondary: '#141210' },
  realistic: { primary: '#4a7ba7', secondary: '#101418' },
  dark_noir: { primary: '#5c6470', secondary: '#08080a' },
  anime: { primary: '#ff5c8a', secondary: '#1a1030' },
  comic: { primary: '#ffcc00', secondary: '#101010' },
  graphic_novel: { primary: '#8a8a8a', secondary: '#0d0d12' },
  minimal: { primary: '#3ddc97', secondary: '#0a0a0c' },
  corporate: { primary: '#3b82f6', secondary: '#0c1220' },
  futuristic: { primary: '#00e5ff', secondary: '#06061a' },
  custom: { primary: '#7c5cff', secondary: '#1a1030' },
};

/** Deterministic seed keeps regeneration reproducible for the same scene. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 2_147_483_647);
}

export class ReplicateProvider implements ImageProvider {
  readonly name = 'replicate';

  isConfigured(): boolean {
    return config.replicate.configured;
  }

  async health(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return { provider: this.name, status: 'unconfigured', detail: 'REPLICATE_API_TOKEN not set' };
    }
    const started = Date.now();
    try {
      const res = await fetch('https://api.replicate.com/', {
        headers: { Authorization: `Bearer ${config.replicate.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok
        ? { provider: this.name, status: 'healthy', detail: 'API reachable', latencyMs: Date.now() - started }
        : { provider: this.name, status: 'degraded', detail: `status ${res.status}` };
    } catch (err) {
      return {
        provider: this.name,
        status: 'degraded',
        detail: err instanceof Error ? err.message : 'unreachable',
      };
    }
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    if (!this.isConfigured()) {
      // Honest fallback: a real image file, clearly attributed as generated locally.
      return this.generateLocally(req);
    }

    const model = req.qualityMode === 'draft' ? 'black-forest-labs/flux-schnell' : 'black-forest-labs/flux-dev';
    const body = {
      input: {
        prompt: req.prompt,
        width: req.width,
        height: req.height,
        aspect_ratio: '9:16',
        num_outputs: 1,
        seed: req.seed,
        output_format: 'jpg',
      },
    };

    const start = await this.post(`/models/${model}/predictions`, body);
    const prediction = await this.poll(start.id);

    const output = prediction.output;
    const url = Array.isArray(output) ? output[0] : output;
    if (typeof url !== 'string') {
      throw new ProviderError(
        `Replicate returned no image (status ${prediction.status}).`,
        this.name,
        true,
      );
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      throw new ProviderError(`Failed to download generated image (${res.status})`, this.name, true, res.status);
    }

    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? 'image/jpeg',
      provider: this.name,
      sourceType: 'AI_GENERATED',
      sourceUrl: url,
      licenseNote: `Generated with ${model} via Replicate.`,
    };
  }

  /**
   * Deterministic locally-rendered still. Used in demo mode and as a resilient
   * fallback when a generation provider fails, so a render never stalls.
   */
  async generateLocally(req: ImageRequest): Promise<ImageResult> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-img-'));
    const outPath = path.join(dir, 'still.jpg');
    const style = extractStyle(req.prompt);
    const palette = STYLE_PALETTES[style] ?? STYLE_PALETTES.cinematic;

    try {
      const subject = req.prompt
        .split(',')
        .slice(0, 2)
        .join(',')
        .replace(/vertical 9:16|high detail|professional grade/g, '')
        .trim()
        .slice(0, 70);

      await generatePlaceholderImage({
        width: req.width,
        height: req.height,
        text: titleCase(subject),
        subtext: 'DEMO VISUAL • GENERATED LOCALLY',
        primary: palette.primary,
        secondary: palette.secondary,
        outPath,
      });

      const buffer = await fs.readFile(outPath);
      return {
        buffer,
        contentType: 'image/jpeg',
        provider: 'ffmpeg',
        sourceType: 'GENERATED_BACKGROUND',
        licenseNote: 'Locally generated placeholder. Not AI-generated artwork.',
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.replicate.token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    };
  }

  private async post(pathname: string, body: unknown): Promise<ReplicatePrediction> {
    const res = await fetch(`${API}${pathname}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(
        `Replicate request failed (${res.status}): ${text.slice(0, 300)}`,
        this.name,
        res.status === 429 || res.status >= 500,
        res.status,
      );
    }
    return (await res.json()) as ReplicatePrediction;
  }

  private async poll(id: string, timeoutMs = 300_000): Promise<ReplicatePrediction> {
    const deadline = Date.now() + timeoutMs;
    let wait = 1500;

    while (Date.now() < deadline) {
      const res = await fetch(`${API}/predictions/${id}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        throw new ProviderError(`Replicate poll failed (${res.status})`, this.name, true, res.status);
      }
      const prediction = (await res.json()) as ReplicatePrediction;

      if (prediction.status === 'succeeded') return prediction;
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new ProviderError(
          `Replicate prediction ${prediction.status}: ${prediction.error ?? 'unknown error'}`,
          this.name,
          false,
        );
      }
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(8000, wait * 1.4);
    }

    throw new ProviderError('Replicate prediction timed out.', this.name, true, 504);
  }
}

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[];
  error?: string;
}

function extractStyle(prompt: string): string {
  for (const style of Object.keys(STYLE_PALETTES)) {
    if (prompt.toLowerCase().includes(style.replace('_', ' '))) return style;
  }
  return 'cinematic';
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
}

export { STYLE_PALETTES };
