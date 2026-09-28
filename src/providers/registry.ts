/**
 * Provider registry.
 *
 * Chooses concrete implementations at runtime from configuration. Application
 * code depends only on the interfaces in `./types`, so swapping (or adding) a
 * vendor never requires touching the pipeline.
 */
import { config } from '@/lib/config';
import { FFmpegRenderer } from './ffmpeg-renderer';
import { MockImageProvider } from './mock';
import { MockLLMProvider, MockVoiceProvider } from './mock';
import { OpenAIProvider } from './openai';
import { ElevenLabsProvider } from './elevenlabs';
import { ReplicateProvider } from './replicate';
import {
  CloudinaryStorageProvider,
  LocalStorageProvider,
  S3StorageProvider,
} from './storage';
import {
  type ImageProvider,
  type LLMProvider,
  type ResearchProvider,
  type RendererProvider,
  type StorageProvider,
  type VoiceProvider,
} from './types';
import path from 'node:path';

export function getLLM(): LLMProvider {
  if (config.llm.configured) return new OpenAIProvider();
  return new MockLLMProvider();
}

export function getVoice(): VoiceProvider {
  if (config.voice.configured) return new ElevenLabsProvider();
  return new MockVoiceProvider();
}

export function getImage(): ImageProvider {
  if (config.replicate.configured) return new ReplicateProvider();
  return new MockImageProvider();
}

export function getRenderer(): RendererProvider {
  // Local FFmpeg always wins: it is the only path that renders locally with no
  // external dependency. Creatomate is an optional managed alternative.
  return new FFmpegRenderer();
}

/**
 * Research capability.
 *
 * Falls back to the mock provider so the research stage still runs and records
 * an explicitly UNVERIFIED source list. Silently skipping research would hide
 * from the user that nothing is fact-checked.
 */
export function getResearch(): ResearchProvider {
  if (config.llm.configured) return new OpenAIProvider();
  return new MockLLMProvider();
}

let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (storageInstance) return storageInstance;

  if (config.storage.driver === 's3' && config.storage.configured) {
    storageInstance = new S3StorageProvider({
      bucket: config.storage.bucket,
      endpoint: config.storage.endpoint,
      accessKey: config.storage.accessKey,
      secretKey: config.storage.secretKey,
    });
  } else if (config.storage.driver === 'cloudinary' && config.storage.configured) {
    storageInstance = new CloudinaryStorageProvider({
      cloudName: config.storage.cloudinary.cloudName,
      apiKey: config.storage.cloudinary.apiKey,
      apiSecret: config.storage.cloudinary.apiSecret,
    });
  } else {
    storageInstance = new LocalStorageProvider(
      path.resolve(process.cwd(), '.data', 'storage'),
    );
  }
  return storageInstance;
}

export { LocalStorageProvider };
