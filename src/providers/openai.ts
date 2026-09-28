/**
 * OpenAI (or any OpenAI-compatible) provider.
 *
 * All structured output goes through JSON Schema validation with a repair retry,
 * never blind parsing (per the AI output rule).
 */
import { z } from 'zod';
import { config } from '@/lib/config';
import {
  CAPTION_SYSTEM,
  RESEARCH_SYSTEM,
  SCRIPT_SYSTEM,
  SEO_SYSTEM,
  VISUAL_SYSTEM,
} from '@/prompts';
import { estimateDuration, round } from '@/lib/timing';
import {
  type LLMProvider,
  type ProviderHealth,
  type ResearchProvider,
  type ResearchRequest,
  type ResearchResult,
  type ScriptPackage,
  type ScriptRequest,
  type SeoPackage,
  type SeoRequest,
  type VisualPromptRequest,
  ProviderError,
} from './types';

// ---------------------------------------------------------------------------
// Schema validation — model output is never trusted without this.
// ---------------------------------------------------------------------------

const sceneSchema = z.object({
  scene_number: z.number().int().positive(),
  text: z.string().min(1),
  duration: z.number().nonnegative().default(0),
  visual_prompt: z.string().default(''),
  visual_type: z.string().default('image'),
  caption: z.string().default(''),
  transition: z.string().default('fade'),
});

export const scriptResponseSchema = z.object({
  hook: z.string().min(1),
  script: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  hashtags: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  cta: z.string().default(''),
  estimated_duration: z.number().nonnegative().default(0),
  scenes: z.array(sceneSchema).min(1),
});

export const seoResponseSchema = z.object({
  title: z.string().min(1),
  title_variants: z.array(z.string()).default([]),
  description: z.string().default(''),
  hashtags: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  keywords: z
    .object({
      primary: z.array(z.string()).default([]),
      secondary: z.array(z.string()).default([]),
    })
    .default({ primary: [], secondary: [] }),
  hook_score: z
    .object({
      curiosity: z.number().default(0),
      clarity: z.number().default(0),
      emotionalPull: z.number().default(0),
      specificity: z.number().default(0),
      overall: z.number().default(0),
    })
    .default({ curiosity: 0, clarity: 0, emotionalPull: 0, specificity: 0, overall: 0 }),
});

export const researchResponseSchema = z.object({
  summary: z.string().default(''),
  facts: z
    .array(
      z.object({
        fact: z.string().min(1),
        source_url: z.string().optional(),
        source_name: z.string().optional(),
        verified: z.boolean().default(false),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  sources: z
    .array(
      z.object({
        title: z.string().default(''),
        url: z.string().default(''),
        snippet: z.string().default(''),
      }),
    )
    .default([]),
});

// ---------------------------------------------------------------------------
// JSON extraction — models occasionally wrap JSON in prose or fences.
// ---------------------------------------------------------------------------

export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  // Fenced block.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fence ? fence[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost balanced object.
    const start = candidate.indexOf('{');
    if (start === -1) throw new Error('No JSON object found in model response.');
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (!inString && ch === '{') depth++;
      if (!inString && ch === '}') {
        depth--;
        if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
      }
    }
    throw new Error('Malformed JSON in model response.');
  }
}

export class OpenAIProvider implements LLMProvider, ResearchProvider {
  readonly name = 'openai';

  isConfigured(): boolean {
    return config.llm.configured;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.llm.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /** Raw chat completion with JSON-object response format. */
  private async chat(
    system: string,
    user: unknown,
    opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {},
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: config.llm.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      temperature: opts.temperature ?? 0.85,
      max_tokens: opts.maxTokens ?? 4000,
    };
    if (opts.jsonMode !== false) body.response_format = { type: 'json_object' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const retryable = res.status === 429 || res.status >= 500;
        throw new ProviderError(
          `OpenAI request failed (${res.status}): ${text.slice(0, 300)}`,
          this.name,
          retryable,
          res.status,
        );
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new ProviderError('OpenAI returned an empty completion.', this.name, true);
      }
      return content;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new ProviderError('OpenAI request timed out after 120s.', this.name, true, 504, err);
      }
      throw new ProviderError(
        `Could not reach OpenAI: ${(err as Error).message}`,
        this.name,
        true,
        503,
        err,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Parse + validate with one structured repair attempt, then give up loudly. */
  private async structured<S extends z.ZodTypeAny>(
    raw: string,
    schema: S,
    system: string,
    user: unknown,
  ): Promise<z.infer<S>> {
    const first = this.safeParse(raw, schema);
    if (first.success) return first.data as z.infer<S>;

    // Attempt 1: structured repair.
    const repaired = await this.chat(
      `${system}\n\nYou previously produced invalid JSON. Return ONLY corrected JSON matching the schema. No prose.`,
      { invalid_output: raw.slice(0, 4000), validation_error: first.error.message.slice(0, 500) },
      { temperature: 0.2, maxTokens: 4000 },
    ).catch(() => null);

    if (repaired) {
      const second = this.safeParse(repaired, schema);
      if (second.success) return second.data as z.infer<S>;
    }

    // Attempt 2: regenerate from scratch.
    const regenerated = await this.chat(system, user, { temperature: 0.7 }).catch(() => null);
    if (regenerated) {
      const third = this.safeParse(regenerated, schema);
      if (third.success) return third.data as z.infer<S>;
    }

    throw new ProviderError(
      `Model output failed schema validation after repair: ${first.error.message.slice(0, 200)}`,
      this.name,
      false,
      502,
    );
  }

  private safeParse<S extends z.ZodTypeAny>(raw: string, schema: S) {
    try {
      return { success: true as const, data: schema.parse(extractJson(raw)) };
    } catch (error) {
      const message = error instanceof z.ZodError ? error.message : (error as Error).message;
      return { success: false as const, error: new Error(message) };
    }
  }

  async health(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return { provider: this.name, status: 'unconfigured', detail: 'OPENAI_API_KEY not set' };
    }
    const started = Date.now();
    try {
      const res = await fetch(`${config.llm.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok
        ? { provider: this.name, status: 'healthy', detail: config.llm.model, latencyMs: Date.now() - started }
        : { provider: this.name, status: 'degraded', detail: `models endpoint ${res.status}` };
    } catch (err) {
      return {
        provider: this.name,
        status: 'degraded',
        detail: err instanceof Error ? err.message : 'unreachable',
      };
    }
  }

  async generateScript(input: ScriptRequest): Promise<ScriptPackage> {
    const user = {
      topic: input.topic,
      category: input.category,
      script_style: input.style,
      target_duration_seconds: input.targetDuration,
      target_word_count_estimate: Math.round(input.targetDuration * 2.4 * (input.voiceSpeed ?? 1)),
      language: input.language,
      template_beats: input.templateBeats ?? null,
      research: input.research
        ? { summary: input.research.summary, facts: input.research.facts }
        : null,
      brand_cta: input.brandCta ?? null,
      user_notes: input.userNotes ?? null,
      revision_instruction: input.revisionInstruction ?? null,
    };

    const raw = await this.chat(SCRIPT_SYSTEM, user, { temperature: 0.9, maxTokens: 4000 });
    const parsed = await this.structured(raw, scriptResponseSchema, SCRIPT_SYSTEM, user);

    return {
      hook: parsed.hook,
      script: parsed.script,
      title: parsed.title,
      description: parsed.description,
      hashtags: parsed.hashtags.map(normaliseTag),
      tags: parsed.tags.map(normaliseTag),
      cta: parsed.cta,
      estimatedDuration:
        parsed.estimated_duration > 0
          ? round(parsed.estimated_duration, 2)
          : round(estimateDuration(parsed.script, input.voiceSpeed ?? 1), 2),
      scenes: parsed.scenes.map((s, i) => ({
        sceneNumber: s.scene_number || i + 1,
        text: s.text,
        visualPrompt: s.visual_prompt,
        visualType: normaliseVisualType(s.visual_type),
        caption: s.caption,
        transition: normaliseTransition(s.transition),
      })),
    };
  }

  async generateSeo(input: SeoRequest): Promise<SeoPackage> {
    const user = {
      topic: input.topic,
      category: input.category,
      hook: input.hook,
      script_excerpt: input.script.slice(0, 1500),
      language: input.language,
    };
    const raw = await this.chat(SEO_SYSTEM, user, { temperature: 0.6, maxTokens: 2000 });
    const parsed = await this.structured(raw, seoResponseSchema, SEO_SYSTEM, user);

    return {
      title: parsed.title.slice(0, 100),
      titleVariants: parsed.title_variants.slice(0, 3).map((t) => t.slice(0, 100)),
      description: parsed.description,
      hashtags: parsed.hashtags.map(normaliseTag).slice(0, 15),
      tags: parsed.tags.map(normaliseTag).slice(0, 20),
      keywords: {
        primary: parsed.keywords.primary.map(normaliseTag).slice(0, 6),
        secondary: parsed.keywords.secondary.map(normaliseTag).slice(0, 10),
      },
      hookScore: parsed.hook_score,
    };
  }

  async generateVisualPrompt(input: VisualPromptRequest): Promise<string> {
    const raw = await this.chat(
      VISUAL_SYSTEM,
      { scene_text: input.sceneText, visual_style: input.visualStyle, category: input.category },
      { temperature: 0.7, maxTokens: 400, jsonMode: false },
    );
    return raw.trim().slice(0, 1200);
  }

  async research(input: ResearchRequest): Promise<ResearchResult> {
    // Without a web-search tool we cannot verify facts, so we refuse to invent
    // them: the caller receives an explicitly unverified result.
    const user = {
      topic: input.topic,
      category: input.category,
      require_fresh_sources: input.requireFresh,
      source_material: 'none available — no search provider is configured',
    };
    const raw = await this.chat(RESEARCH_SYSTEM, user, { temperature: 0.3, maxTokens: 3000 });
    const parsed = await this.structured(raw, researchResponseSchema, RESEARCH_SYSTEM, user);

    return {
      summary: parsed.summary,
      facts: parsed.facts.map((f) => ({
        fact: f.fact,
        sourceUrl: f.source_url || undefined,
        sourceName: f.source_name || undefined,
        // A fact is only "verified" if it actually carries a source URL.
        verified: f.verified && !!f.source_url,
        notes: f.notes,
      })),
      sources: parsed.sources.filter((s) => s.url),
      unverified: parsed.sources.length === 0,
    };
  }
}

function normaliseTag(tag: string): string {
  return tag.trim().replace(/^#/, '').toLowerCase();
}

function normaliseVisualType(value: string): 'image' | 'video' | 'stock' | 'background' | 'text' {
  const v = value.toLowerCase();
  if (v.includes('video')) return 'video';
  if (v.includes('stock')) return 'stock';
  if (v.includes('background') || v.includes('abstract') || v.includes('graphic')) return 'background';
  if (v.includes('text')) return 'text';
  return 'image';
}

function normaliseTransition(value: string): string {
  const v = value.toLowerCase();
  return ['fade', 'cut', 'dissolve', 'slide', 'zoom'].includes(v) ? v : 'fade';
}
