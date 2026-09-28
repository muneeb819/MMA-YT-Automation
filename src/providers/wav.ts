/**
 * Minimal PCM WAV writer + speech-shaped synthetic track.
 *
 * Produces a genuine, playable 16-bit mono WAV whose energy envelope follows the
 * narration word boundaries. This lets caption sync, audio mixing and the
 * duration-aware renderer be exercised for real in demo mode without any
 * third-party voice credentials.
 */

const SAMPLE_RATE = 22050;

export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // format = PCM
  buffer.writeUInt16LE(1, 22); // channels = mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataLength, 40);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }
  return buffer;
}

/** Deterministic pseudo-random so identical text yields identical audio. */
function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a speech-like waveform: a low fundamental with harmonics, amplitude
 * modulated per "word" so silence gaps align with the caption word boundaries.
 */
export function generateSilentSpeechWav(
  seconds: number,
  amplitude = 0.2,
  seedSource = 'shortforge',
): Buffer {
  const total = Math.max(1, Math.round(seconds * SAMPLE_RATE));
  const samples = new Float32Array(total);
  const rand = mulberry32(hashSeed(seedSource));

  // Vocal-ish base frequency with slight downward drift across the clip.
  const baseFreq = 95 + rand() * 45;
  const harmonics = [1, 2, 3, 4, 5].map((h) => 1 / (h * h));

  // ~2.6 words/sec envelope, matching the narration pacing used by the timer.
  const wordsPerSecond = 2.4;
  const wordDuration = 1 / wordsPerSecond;
  const gap = 0.22;

  let phase = 0;
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const progress = i / total;

    // Word envelope: active for wordDuration, silent for gap.
    const slot = t % wordDuration;
    const inWord = slot < wordDuration * (1 - gap);
    // Short attack/decay ramps avoid clicks at boundaries.
    const edge = Math.min(1, Math.min(slot, wordDuration - slot) / 0.02);
    const env = inWord ? Math.max(0, edge) : 0;

    const freq = baseFreq * (1 - progress * 0.08);
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;

    let voice = 0;
    harmonics.forEach((weight, idx) => {
      voice += Math.sin(phase * (idx + 1)) * weight;
    });
    voice /= harmonics.reduce((a, b) => a + b, 0);

    // Breath noise for naturalness.
    const noise = (rand() * 2 - 1) * 0.12;

    // Overall fade in/out so the track never starts or ends abruptly.
    const fade = Math.min(1, t / 0.05, (seconds - t) / 0.08);

    samples[i] = (voice * 0.85 + noise) * env * fade * amplitude;
  }

  return encodeWav(samples, SAMPLE_RATE);
}

export { SAMPLE_RATE };
