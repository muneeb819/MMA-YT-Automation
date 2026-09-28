/**
 * Provider contracts.
 *
 * The application depends on these interfaces only. Concrete providers (OpenAI,
 * ElevenLabs, Replicate, Cloudinary, Creatomate, FFmpeg, research) are selected
 * at runtime by the provider registry, so a new vendor never touches app code.
 */

export interface ProviderHealth {
  provider: string;
  status: 'healthy' | 'degraded' | 'unconfigured' | 'disabled' | 'unhealthy';
  detail: string;
  latencyMs?: number;
}

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

export interface ResearchResult {
  summary: string;
  facts: { fact: string; sourceUrl?: string; sourceName?: string; verified: boolean; notes?: string }[];
  sources: ResearchSource[];
  /** True when no search provider was available; facts must be marked UNVERIFIED. */
  unverified: boolean;
}

export interface ScenePlan {
  sceneNumber: number;
  text: string;
  visualPrompt: string;
  visualType: 'image' | 'video' | 'stock' | 'background' | 'text';
  caption: string;
  transition: string;
}

export interface ScriptPackage {
  hook: string;
  script: string;
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
  cta: string;
  estimatedDuration: number;
  scenes: ScenePlan[];
}

export interface HookScore {
  curiosity: number;
  clarity: number;
  emotionalPull: number;
  specificity: number;
  overall: number;
}

export interface SeoPackage {
  title: string;
  titleVariants: string[];
  description: string;
  hashtags: string[];
  tags: string[];
  keywords: { primary: string[]; secondary: string[] };
  hookScore: HookScore;
}

export interface LLMProvider {
  readonly name: string;
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  generateScript(input: ScriptRequest): Promise<ScriptPackage>;
  generateSeo(input: SeoRequest): Promise<SeoPackage>;
  generateVisualPrompt(input: VisualPromptRequest): Promise<string>;
  research(input: ResearchRequest): Promise<ResearchResult>;
}

export interface ScriptRequest {
  topic: string;
  category: string;
  style: string;
  targetDuration: number;
  language: string;
  templateBeats?: string[];
  research?: ResearchResult | null;
  brandCta?: string | null;
  userNotes?: string | null;
  voiceSpeed?: number;
  /** Revision guidance used when regenerating. */
  revisionInstruction?: string | null;
}

export interface SeoRequest {
  topic: string;
  category: string;
  script: string;
  hook: string;
  language: string;
}

export interface VisualPromptRequest {
  sceneText: string;
  visualStyle: string;
  category: string;
}

export interface ResearchRequest {
  topic: string;
  category: string;
  requireFresh: boolean;
}

/**
 * Standalone research capability. Separate from the LLM so a dedicated search
 * provider can be added later without touching the content pipeline.
 */
export interface ResearchProvider {
  readonly name: string;
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  research(input: ResearchRequest): Promise<ResearchResult>;
}

export interface VoiceSettings {
  voiceId: string;
  voiceName?: string;
  speed: number;
  stability: number;
  similarityBoost?: number;
  style?: number;
  model?: string;
}

export interface VoiceResult {
  audio: Buffer;
  contentType: string;
  durationSeconds: number;
  generationId: string;
  provider: string;
  settings: VoiceSettings;
}

export interface VoiceProvider {
  readonly name: string;
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  listVoices(): Promise<VoiceOption[]>;
  synthesize(text: string, settings: VoiceSettings): Promise<VoiceResult>;
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'neutral';
  accent: string;
  language: string;
  previewUrl?: string;
  provider: string;
  description?: string;
}

export interface ImageRequest {
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  qualityMode: 'draft' | 'standard' | 'premium';
}

export interface ImageResult {
  buffer: Buffer;
  contentType: string;
  provider: string;
  sourceType: 'AI_GENERATED' | 'LICENSED_STOCK' | 'PUBLIC_DOMAIN' | 'USER_UPLOADED' | 'GENERATED_BACKGROUND';
  sourceUrl?: string;
  licenseNote?: string;
}

export interface ImageProvider {
  readonly name: string;
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  generate(req: ImageRequest): Promise<ImageResult>;
}

export interface StorageProvider {
  readonly name: string;
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Remove every object under a key prefix (used for project teardown). */
  deletePrefix(prefix: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  /** Public URL (or signed URL) for retrieval by the browser. */
  publicUrl(key: string): Promise<string>;
}

export interface RenderInput {
  projectId: number;
  /** Total timeline duration in seconds. */
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: string;
  audioKey: string;
  audioDuration: number;
  scenes: {
    index: number;
    start: number;
    duration: number;
    visualKey: string | null;
    visualType: string;
    transition: string;
    background: string;
    overlayText: string | null;
  }[];
  captions: { start: number; end: number; text: string }[];
  captionStyle: string;
  musicKey: string | null;
  musicVolume: number;
  outputKey: string;
  thumbnailKey?: string;
}

export interface RenderResult {
  storageKey: string;
  thumbnailKey?: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  sizeBytes: number;
  checksum: string;
  provider: string;
}

export interface RendererProvider {
  readonly name: string;
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  render(input: RenderInput): Promise<RenderResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable = false,
    readonly statusCode?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
