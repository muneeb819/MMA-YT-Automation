/**
 * Narration timing engine.
 *
 * Pure functions only — no I/O, no clock reads — so they are trivially unit
 * testable and safe to use inside the renderer.
 */
import { WORDS_PER_SECOND_DEFAULT, WORDS_PER_SECOND_MAX, WORDS_PER_SECOND_MIN } from './domain';

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

/** Words that should not be counted as spoken content. */
const NON_SPOKEN = new Set([
  '',
  ' ',
  '.',
  ',',
  '!',
  '?',
  ';',
  ':',
  '-',
  '—',
  '…',
  '"',
  "'",
  '(',
  ')',
  '[',
  ']',
]);

export function countWords(text: string): number {
  if (!text) return 0;
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0 && !NON_SPOKEN.has(token))
    .length;
}

/**
 * Effective words-per-second given a voice speed multiplier.
 * Speed 1.0 = default cadence; >1 compresses time (faster delivery).
 */
export function effectiveWordsPerSecond(voiceSpeed = 1): number {
  const speed = clamp(voiceSpeed || 1, 0.5, 2);
  return WORDS_PER_SECOND_DEFAULT * speed;
}

/** Words a narration should contain to fill `seconds` at the given speed. */
export function wordsForDuration(seconds: number, voiceSpeed = 1): number {
  return Math.max(1, Math.round(seconds * effectiveWordsPerSecond(voiceSpeed)));
}

/** Estimated spoken duration of `text` in seconds. */
export function estimateDuration(text: string, voiceSpeed = 1): number {
  return countWords(text) / effectiveWordsPerSecond(voiceSpeed);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Distribute a target duration across scenes proportional to their word count.
 *
 * Every scene receives at least MIN_SCENE_SECONDS so rapid cuts stay readable;
 * leftover time from the floor is redistributed proportionally.
 */
const MIN_SCENE_SECONDS = 1.0;
const MAX_SCENE_SECONDS = 12.0;

export function allocateSceneDurations(
  narrations: string[],
  totalDuration: number,
  voiceSpeed = 1,
): number[] {
  const n = narrations.length;
  if (n === 0) return [];
  if (n === 1) return [round(totalDuration)];

  const words = narrations.map((t) => Math.max(1, countWords(t)));
  const totalWords = words.reduce((a, b) => a + b, 0);

  // Proportional share of the budget.
  let durations = words.map((w) => (w / totalWords) * totalDuration);

  // Enforce a readable floor, then redistribute the surplus.
  let surplus = 0;
  durations = durations.map((d) => {
    if (d < MIN_SCENE_SECONDS) {
      surplus += MIN_SCENE_SECONDS - d;
      return MIN_SCENE_SECONDS;
    }
    return d;
  });

  if (surplus > 0) {
    const flexibleTotal = durations.reduce((a, d, i) => a + (d > MIN_SCENE_SECONDS ? words[i] : 0), 0);
    if (flexibleTotal > 0) {
      durations = durations.map((d, i) =>
        d > MIN_SCENE_SECONDS ? d + (surplus * words[i]) / flexibleTotal : d,
      );
    } else {
      // Every scene was at the floor: grow them evenly and remove the surplus.
      durations = durations.map((d) => d + surplus / n);
    }
  }

  // Clamp long scenes, then fix drift so the sum matches the target exactly.
  let excess = 0;
  durations = durations.map((d) => {
    if (d > MAX_SCENE_SECONDS) {
      excess += d - MAX_SCENE_SECONDS;
      return MAX_SCENE_SECONDS;
    }
    return d;
  });
  if (excess > 0) {
    const flexibleIdx = durations.map((d, i) => (d < MAX_SCENE_SECONDS ? i : -1)).filter((i) => i >= 0);
    if (flexibleIdx.length > 0) {
      const per = excess / flexibleIdx.length;
      durations = durations.map((d, i) => (flexibleIdx.includes(i) ? d + per : d));
    }
  }

  const sum = durations.reduce((a, b) => a + b, 0);
  const scale = sum > 0 ? totalDuration / sum : 1;
  durations = durations.map((d) => round(d * scale, 3));

  // Absorb rounding drift into the longest scene so the timeline is exact.
  const drift = round(totalDuration - durations.reduce((a, b) => a + b, 0), 3);
  if (drift !== 0) {
    const longest = durations.indexOf(Math.max(...durations));
    durations[longest] = round(durations[longest] + drift, 3);
  }

  return durations;
}

export interface TimelineSegment {
  index: number;
  start: number;
  end: number;
  duration: number;
}

/** Convert per-scene durations into a contiguous, non-overlapping timeline. */
export function buildTimeline(durations: number[]): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  let cursor = 0;
  durations.forEach((duration, index) => {
    const d = round(Math.max(0, duration), 3);
    segments.push({ index, start: round(cursor, 3), end: round(cursor + d, 3), duration: d });
    cursor += d;
  });
  return segments;
}

/**
 * Distribute words across time for caption alignment.
 *
 * `segments` lets us pin words to their scene so captions never drift across a
 * cut. Falls back to proportional distribution when segment text is unavailable.
 */
export function buildWordTimings(
  narrations: string[],
  durations: number[],
  opts: { minWordDuration?: number; gapRatio?: number } = {},
): WordTiming[] {
  const minWordDuration = opts.minWordDuration ?? 0.12;
  const gapRatio = opts.gapRatio ?? 0.18;
  const out: WordTiming[] = [];
  let cursor = 0;

  narrations.forEach((text, i) => {
    const duration = durations[i] ?? 0;
    const tokens = (text ?? '').split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) {
      cursor += duration;
      return;
    }

    // Longer words take longer to say — weight by length for natural pacing.
    const weights = tokens.map((t) => Math.max(1, t.replace(/[^\w']/g, '').length));
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

    let localCursor = cursor;
    tokens.forEach((token, j) => {
      const share = (weights[j] / totalWeight) * duration;
      const speak = Math.max(minWordDuration, share * (1 - gapRatio));
      const start = round(localCursor, 3);
      const end = round(Math.min(cursor + duration, start + speak), 3);
      out.push({ word: token, start, end });
      localCursor = round(localCursor + share, 3);
    });

    cursor = round(cursor + duration, 3);
  });

  return out;
}

/** Group word timings into readable caption lines of at most `maxWords`. */
export interface CaptionCue {
  index: number;
  start: number;
  end: number;
  text: string;
}

export function groupIntoCues(
  words: WordTiming[],
  maxWords = 4,
  maxDuration = 2.4,
): CaptionCue[] {
  if (words.length === 0) return [];
  const cues: CaptionCue[] = [];
  let current: WordTiming[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const text = current.map((w) => w.word).join(' ');
    cues.push({
      index: cues.length + 1,
      start: current[0].start,
      end: current[current.length - 1].end,
      text,
    });
    current = [];
  };

  for (const w of words) {
    const candidate = [...current, w];
    const span = candidate[candidate.length - 1].end - candidate[0].start;
    // Break on a natural pause (gap > 0.35s) before exceeding limits.
    const pause = current.length > 0 && w.start - current[current.length - 1].end > 0.35;
    if (candidate.length > maxWords || span > maxDuration || pause) flush();
    current.push(w);
  }
  flush();
  return cues;
}

function formatTimestamp(seconds: number, sep: ',' | '.' = ','): string {
  const s = Math.max(0, seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${sep}${pad(ms, 3)}`;
}

export function toSrt(cues: CaptionCue[]): string {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text}\n`,
    )
    .join('\n');
}

export function toVtt(cues: CaptionCue[]): string {
  const body = cues
    .map((c) => `${formatTimestamp(c.start, '.')} --> ${formatTimestamp(c.end, '.')}\n${c.text}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

export { formatTimestamp };
