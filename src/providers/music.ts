/**
 * Synthetic royalty-free music beds.
 *
 * Generating audio locally guarantees there is never a licensing question with
 * background music, which is a real risk when reusing stock audio in published
 * content. Each preset is a different chord progression + tempo.
 */
import { encodeWav } from './wav';

const SAMPLE_RATE = 44100;

export interface MusicPreset {
  /** Semitone offsets from the root for each chord in the loop. */
  chords: number[][];
  bpm: number;
  waveform: 'sine' | 'triangle' | 'sawtooth';
  brightness: number;
  bassGain: number;
}

export const MUSIC_PRESETS: Record<string, MusicPreset> = {
  cinematic: {
    chords: [
      [0, 3, 7, 10],
      [-2, 2, 5, 9],
      [-4, 0, 3, 7],
      [-5, -1, 2, 7],
    ],
    bpm: 72,
    waveform: 'sine',
    brightness: 0.35,
    bassGain: 0.5,
  },
  suspense: {
    chords: [
      [0, 1, 5],
      [0, 1, 6],
      [-1, 2, 4],
      [0, 1, 5],
    ],
    bpm: 64,
    waveform: 'triangle',
    brightness: 0.22,
    bassGain: 0.62,
  },
  corporate: {
    chords: [
      [0, 4, 7, 11],
      [5, 9, 12, 16],
      [7, 11, 14, 17],
      [5, 9, 12, 16],
    ],
    bpm: 104,
    waveform: 'triangle',
    brightness: 0.55,
    bassGain: 0.4,
  },
  emotional: {
    chords: [
      [0, 4, 7],
      [-3, 0, 4],
      [-5, -1, 2],
      [-7, -3, 0],
    ],
    bpm: 68,
    waveform: 'sine',
    brightness: 0.28,
    bassGain: 0.55,
  },
  energetic: {
    chords: [
      [0, 4, 7],
      [2, 5, 9],
      [5, 9, 12],
      [7, 11, 14],
    ],
    bpm: 124,
    waveform: 'sawtooth',
    brightness: 0.75,
    bassGain: 0.45,
  },
};

const semitone = (root: number, offset: number): number => root * Math.pow(2, offset / 12);

function osc(wave: MusicPreset['waveform'], phase: number): number {
  switch (wave) {
    case 'sine':
      return Math.sin(phase);
    case 'triangle':
      return (2 / Math.PI) * Math.asin(Math.sin(phase));
    case 'sawtooth':
      return 2 * ((phase / (2 * Math.PI)) % 1) - 1;
  }
}

export function generateToneBed(
  seconds: number,
  preset: MusicPreset = MUSIC_PRESETS.cinematic,
  volume = 0.18,
): Buffer {
  const total = Math.max(1, Math.round(seconds * SAMPLE_RATE));
  const samples = new Float32Array(total);
  const beatLength = 60 / preset.bpm;
  const chordLength = beatLength * 4;
  const root = 110; // A2

  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const chordIndex = Math.floor(t / chordLength) % preset.chords.length;
    const chord = preset.chords[chordIndex];
    const chordProgress = (t % chordLength) / chordLength;

    // Gentle pad swell across each chord.
    const swell = 0.55 + 0.45 * Math.sin(Math.PI * chordProgress);

    let pad = 0;
    chord.forEach((note, idx) => {
      const freq = semitone(root * 2, note);
      const detune = 1 + (idx - chord.length / 2) * 0.0015;
      pad += osc(preset.waveform, 2 * Math.PI * freq * detune * t);
    });
    pad /= chord.length;

    // Bass note on the downbeat.
    const bassFreq = semitone(root, chord[0]);
    const bassEnv = Math.exp(-3.2 * (t % chordLength) / chordLength);
    const bass = Math.sin(2 * Math.PI * bassFreq * t) * bassEnv * preset.bassGain;

    const mixed = pad * swell * preset.brightness + bass;

    // Slow tremolo plus global fade to keep the bed unobtrusive.
    const tremolo = 0.94 + 0.06 * Math.sin(2 * Math.PI * 0.25 * t);
    const fade = Math.min(1, t / 1.2, (seconds - t) / 1.5);

    samples[i] = mixed * tremolo * fade * volume;
  }

  return encodeWav(samples, SAMPLE_RATE);
}
