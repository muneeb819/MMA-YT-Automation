/**
 * Demo/Mock provider.
 *
 * IMPORTANT: mock mode is honest about what it is. The script and SEO are
 * clearly-labelled synthetic samples, and the "voiceover" is a real generated
 * WAV file so downstream timing, caption sync and FFmpeg rendering exercise
 * genuine code paths. Mock output is never presented as production AI output.
 */
import { randomUUID } from 'node:crypto';
import { buildVisualPrompt } from '@/prompts';
import { allocateSceneDurations, countWords, round } from '@/lib/timing';
import {
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
  type LLMProvider,
  type ProviderHealth,
  type ResearchRequest,
  type ResearchResult,
  type ScenePlan,
  type ScriptPackage,
  type ScriptRequest,
  type SeoPackage,
  type SeoRequest,
  type VoiceOption,
  type VoiceProvider,
  type VoiceResult,
  type VoiceSettings,
  type VisualPromptRequest,
} from './types';
import { ReplicateProvider } from './replicate';
import { generateSilentSpeechWav } from './wav';

const DEMO_BANNER = '[Demo content]';

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Builds a structured, genuinely readable short-form narration locally.
 * The narrative beats follow a real documentary structure so the timeline,
 * captions and pacing are all exercised realistically.
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';

  isConfigured(): boolean {
    return true;
  }

  async health(): Promise<ProviderHealth> {
    return { provider: this.name, status: 'healthy', detail: 'Demo mode — synthetic content', latencyMs: 0 };
  }

  async research(input: ResearchRequest): Promise<ResearchResult> {
    return {
      summary:
        `${DEMO_BANNER} No research provider is configured, so no external facts were retrieved. ` +
        `Treat any factual claim about "${input.topic}" as UNVERIFIED and verify before publishing.`,
      facts: [
        {
          fact: `No verified sources are available for "${input.topic}" in demo mode.`,
          verified: false,
          notes: 'Connect an LLM or search provider to ground this script in real sources.',
        },
      ],
      sources: [],
      unverified: true,
    };
  }

  async generateScript(input: ScriptRequest): Promise<ScriptPackage> {
    const topic = input.topic.trim();
    const beats = input.templateBeats?.length
      ? input.templateBeats
      : ['Hook', 'Context', 'Escalation', 'Revelation', 'Conclusion'];

    const targetWords = Math.max(12, Math.round(input.targetDuration * 2.35 * (input.voiceSpeed ?? 1)));
    const topicShort = topic.length > 70 ? `${topic.slice(0, 67)}...` : topic;

    const lines: string[] = [];
    const captionSeeds: string[] = [];

    const perBeat = Math.max(8, Math.floor(targetWords / beats.length));
    beats.forEach((beat, i) => {
      const sentenceBank = this.sentencesForBeat(beat, i, topicShort, input.style);
      const count = i === 0 ? Math.max(8, perBeat - 6) : perBeat;
      let text = '';
      let guard = 0;
      while (countWords(text) < count && guard < 24) {
        text += `${pick(sentenceBank, hashString(topic + beat + guard))} `;
        guard++;
      }
      lines.push(text.trim());
      captionSeeds.push(this.captionFor(beat, topicShort, hashString(topic + beat)));
    });

    const hook = this.hookFor(topicShort, input.style, hashString(topic));
    const cta = this.ctaFor(input.style, input.brandCta);
    const fullScript = [hook, ...lines, cta].filter(Boolean).join(' ');

    // Trim to target by dropping whole sentences from the middle, never mid-word.
    const trimmed = this.trimToTarget(lines, hook, cta, targetWords);
    const narrations = [hook, ...trimmed.lines, cta].filter((s) => s && s.length > 0);
    const durations = allocateSceneDurations(narrations, input.targetDuration, input.voiceSpeed ?? 1);

    const scenes: ScenePlan[] = narrations.map((text, i) => {
      const beat = i === 0 ? 'Hook' : i === narrations.length - 1 ? 'Conclusion' : beats[Math.min(i - 1, beats.length - 1)];
      return {
        sceneNumber: i + 1,
        text,
        visualPrompt: buildVisualPrompt(
          this.visualSubject(text, beat, topicShort),
          input.style === 'dark_documentary' ? 'dark_noir' : 'cinematic',
        ),
        visualType: i % 3 === 0 ? 'background' : 'image',
        caption: captionSeeds[i] ?? this.captionFor(beat, topicShort, i),
        transition: i === 0 ? 'fade' : pick(['fade', 'cut', 'dissolve', 'slide', 'zoom'], hashString(text)),
      };
    });

    return {
      hook,
      script: narrations.join(' '),
      title: `${topicShort}`.slice(0, 70),
      description: `${DEMO_BANNER} Sample description for "${topicShort}". Generated in demo mode.`,
      hashtags: this.hashtags(topic),
      tags: this.tags(topic, input.category),
      cta,
      estimatedDuration: round(durations.reduce((a, b) => a + b, 0), 2),
      scenes,
    };
  }

  async generateSeo(input: SeoRequest): Promise<SeoPackage> {
    const t = input.topic.trim();
    const short = t.length > 60 ? `${t.slice(0, 57)}...` : t;
    return {
      title: `${short}`.slice(0, 70),
      titleVariants: [
        `The Story of ${short}`.slice(0, 70),
        `What Really Happened With ${short}`.slice(0, 70),
        `${short}: What You Need to Know`.slice(0, 70),
      ],
      description:
        `${DEMO_BANNER} A short-form breakdown of ${short}. This description was generated in demo ` +
        `mode for layout testing. Replace with researched, factual metadata before publishing.`,
      hashtags: this.hashtags(t),
      tags: this.tags(t, input.category),
      keywords: {
        primary: [t.toLowerCase().slice(0, 40), input.category.toLowerCase(), 'shorts'],
        secondary: ['explained', 'story', 'facts', 'history', 'documentary', 'short form video'],
      },
      hookScore: {
        curiosity: 72,
        clarity: 68,
        emotionalPull: 64,
        specificity: 58,
        overall: 66,
      },
    };
  }

  async generateVisualPrompt(input: VisualPromptRequest): Promise<string> {
    return buildVisualPrompt(input.sceneText, input.visualStyle);
  }

  // -- internals ------------------------------------------------------------

  private hookFor(topic: string, style: string, seed: number): string {
    const options =
      style === 'news'
        ? [
            `Just confirmed: ${topic} changes everything.`,
            `This is happening right now with ${topic}.`,
          ]
        : style === 'educational'
          ? [`Most people get ${topic} completely wrong.`, `Here's what ${topic} actually means.`]
          : [
              `Nobody expected what happened with ${topic}.`,
              `${topic} sounds simple. It isn't.`,
              `The truth about ${topic} took years to surface.`,
              `Everything you were told about ${topic} was incomplete.`,
            ];
    return pick(options, seed);
  }

  private sentencesForBeat(beat: string, index: number, topic: string, style: string): string[] {
    const lower = beat.toLowerCase();
    if (lower.includes('hook')) {
      return [
        `Here is what actually happened.`,
        `And it changes how you see it.`,
        `Watch to the end for the part nobody mentions.`,
      ];
    }
    if (lower.includes('context') || index === 1) {
      return [
        `To understand ${topic}, you have to start at the beginning.`,
        `Most accounts leave out the early details.`,
        `The setup was simpler than it looked.`,
        `For years the story stayed quiet.`,
        `Context matters more than the headline.`,
      ];
    }
    if (lower.includes('escalat') || index === 2) {
      return [
        `Then the situation escalated fast.`,
        `The pressure built from every direction at once.`,
        `Nobody saw the next move coming.`,
        `Decisions made here were impossible to undo.`,
      ];
    }
    if (lower.includes('revelation') || lower.includes('twist') || index === 3) {
      return [
        `The real turning point was not the obvious one.`,
        `A detail everyone missed turned out to be the whole story.`,
        `This is the part that changes the ending.`,
        `The evidence only lined up later.`,
      ];
    }
    if (lower.includes('conclusion') || lower.includes('cta') || lower.includes('ending')) {
      return [
        `That is the part worth remembering.`,
        `Understanding ${topic} starts with the basics.`,
        `The lesson is simple.`,
        `What happens next is still unclear.`,
      ];
    }
    return [
      `The details around ${topic} matter more than people think.`,
      `Each decision added to the outcome.`,
      `The evidence tells a clear story.`,
    ];
  }

  private captionFor(beat: string, topic: string, seed: number): string {
    const pool = ['The Setup', 'What Changed', 'The Detail', 'The Twist', 'Why It Matters', 'The Truth'];
    const t = topic.split(/\s+/).slice(0, 3).join(' ');
    return `${t} — ${pick(pool, seed)}`.slice(0, 34);
  }

  private visualSubject(text: string, beat: string, topic: string): string {
    return `${beat} stage representing ${topic}; ${text.split(/\s+/).slice(0, 12).join(' ')}`;
  }

  private ctaFor(style: string, brandCta?: string | null): string {
    if (brandCta) return brandCta;
    return style === 'educational'
      ? 'Follow for more explainers like this.'
      : 'If this helped, follow for the next one.';
  }

  /** Drop whole trailing sentences until under the word target. */
  private trimToTarget(
    lines: string[],
    hook: string,
    cta: string,
    targetWords: number,
  ): { lines: string[] } {
    const working = [...lines];
    const total = () => countWords([hook, ...working, cta].join(' '));
    let guard = 0;
    while (total() > targetWords * 1.1 && working.length > 1 && guard < 40) {
      const idx = working.length - 1 - (guard % Math.max(1, working.length - 1));
      if (working[idx]) working.splice(idx, 1);
      guard++;
    }
    return { lines: working.filter((l) => l.trim().length > 0) };
  }

  private hashtags(topic: string): string[] {
    const base = topic
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 3);
    return [
      '#shorts',
      '#shortfilm',
      ...base.map((w) => `#${w}`),
      '#documentary',
      '#storytime',
      '#didyouknow',
      '#facts',
      '#history',
      '#explained',
      '#viral',
      '#trending',
      '#fyp',
      '#learnontiktok',
    ]
      .filter((h, i, arr) => arr.indexOf(h) === i)
      .slice(0, 13);
  }

  private tags(topic: string, category: string): string[] {
    const words = topic.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
    return [
      ...words.slice(0, 6),
      category.toLowerCase().replace('_', ' '),
      'youtube shorts',
      'shorts',
      'short form',
      'documentary',
      'story',
      'explained',
      'facts',
      'viral shorts',
      'trending',
    ]
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, 18);
  }
}

/** Mock voice: emits a real WAV of the correct length with speech-like envelope. */
export class MockVoiceProvider implements VoiceProvider {
  readonly name = 'mock';

  isConfigured(): boolean {
    return true;
  }

  async health(): Promise<ProviderHealth> {
    return { provider: this.name, status: 'healthy', detail: 'Demo mode — synthetic tone track', latencyMs: 0 };
  }

  async listVoices(): Promise<VoiceOption[]> {
    return MOCK_VOICES;
  }

  async synthesize(text: string, settings: VoiceSettings): Promise<VoiceResult> {
    const words = Math.max(1, countWords(text));
    // Match real narration pacing so scene timing lines up with the audio.
    const duration = words / (2.4 * (settings.speed || 1));
    const audio = generateSilentSpeechWav(Math.min(600, Math.max(2, duration)), 0.12, settings.voiceId);
    return {
      audio,
      contentType: 'audio/wav',
      durationSeconds: round(duration, 2),
      generationId: `mock_${randomUUID().slice(0, 12)}`,
      provider: this.name,
      settings,
    };
  }
}

export const MOCK_VOICES: VoiceOption[] = [
  { id: 'mock_marcus', name: 'Marcus (Demo)', gender: 'male', accent: 'American', language: 'en', provider: 'mock', description: 'Deep documentary narrator' },
  { id: 'mock_elena', name: 'Elena (Demo)', gender: 'female', accent: 'British', language: 'en', provider: 'mock', description: 'Clear British presenter' },
  { id: 'mock_kenji', name: 'Kenji (Demo)', gender: 'male', accent: 'Japanese', language: 'en', provider: 'mock', description: 'Calm measured delivery' },
  { id: 'mock_amara', name: 'Amara (Demo)', gender: 'female', accent: 'Nigerian', language: 'en', provider: 'mock', description: 'Warm conversational tone' },
  { id: 'mock_sofia', name: 'Sofia (Demo)', gender: 'female', accent: 'Spanish', language: 'es', provider: 'mock', description: 'Latin American accent' },
];

/**
 * Demo image provider.
 *
 * Produces a genuine JPEG via FFmpeg so the visual/render stages run for real in
 * demo mode. Output is explicitly labelled as locally generated, never as
 * AI-generated artwork.
 */
export class MockImageProvider implements ImageProvider {
  readonly name = 'mock';

  isConfigured(): boolean {
    return true;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      status: 'healthy',
      detail: 'Demo mode — FFmpeg-rendered placeholder stills',
      latencyMs: 0,
    };
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    // Reuse the deterministic local renderer rather than duplicating the logic.
    return new ReplicateProvider().generateLocally(req);
  }
}
