import { describe, expect, it } from 'vitest';
import {
  allocateSceneDurations,
  buildTimeline,
  buildWordTimings,
  countWords,
  estimateDuration,
  groupIntoCues,
  round,
  toSrt,
  toVtt,
  wordsForDuration,
} from '@/lib/timing';
import {
  WORDS_PER_SECOND_DEFAULT,
  WORDS_PER_SECOND_MAX,
  WORDS_PER_SECOND_MIN,
  assertDurationAllowed,
} from '@/lib/domain';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('word counting & duration', () => {
  it('counts words ignoring punctuation-only tokens', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('  spaced   out  words ')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords('hello, world.')).toBe(2);
  });

  it('stays within the specified 2.0-2.8 wps band at speed 1.0', () => {
    const wps = countWords('x') / estimateDuration('x');
    expect(wps).toBeCloseTo(WORDS_PER_SECOND_DEFAULT, 5);
    expect(WORDS_PER_SECOND_DEFAULT).toBeGreaterThanOrEqual(WORDS_PER_SECOND_MIN);
    expect(WORDS_PER_SECOND_DEFAULT).toBeLessThanOrEqual(WORDS_PER_SECOND_MAX);
  });

  it('faster voice speed yields shorter duration for the same text', () => {
    const text = 'a b c d e f g h i j k l';
    expect(estimateDuration(text, 1.25)).toBeLessThan(estimateDuration(text, 1));
  });

  it('wordsForDuration is the inverse of estimateDuration', () => {
    const seconds = 30;
    const words = wordsForDuration(seconds, 1);
    expect(estimateDuration('x '.repeat(words).trim(), 1)).toBeCloseTo(seconds, 0);
  });
});

describe('scene duration allocation', () => {
  it('allocates durations summing exactly to the target', () => {
    const narrations = ['one two three', 'a much longer line of narration here', 'end'];
    const durations = allocateSceneDurations(narrations, 30);
    expect(sum(durations)).toBeCloseTo(30, 2);
  });

  it('gives longer scenes more time', () => {
    const durations = allocateSceneDurations(['hi', 'this is a much longer sentence'], 20);
    expect(durations[1]).toBeGreaterThan(durations[0]);
  });

  it('respects a readable minimum even for tiny scenes', () => {
    const durations = allocateSceneDurations(['a', 'b', 'c', 'd'], 2);
    durations.forEach((d) => expect(d).toBeGreaterThan(0));
  });

  it('handles a single scene', () => {
    expect(allocateSceneDurations(['only one'], 25)).toEqual([25]);
  });

  it('returns empty for no scenes', () => {
    expect(allocateSceneDurations([], 30)).toEqual([]);
  });

  it('keeps every scene positive with a 5-scene 15s target', () => {
    const durations = allocateSceneDurations(['a b', 'c d', 'e f', 'g h', 'i j'], 15);
    expect(sum(durations)).toBeCloseTo(15, 2);
    durations.forEach((d) => expect(d).toBeGreaterThan(0.5));
  });
});

describe('timeline construction', () => {
  it('produces contiguous non-overlapping segments', () => {
    const segs = buildTimeline([2, 3, 4]);
    expect(segs[0].start).toBe(0);
    expect(segs[0].end).toBe(segs[1].start);
    expect(segs[1].end).toBe(segs[2].start);
    expect(sum(segs.map((s) => s.duration))).toBeCloseTo(9, 3);
  });
});

describe('word timings for captions', () => {
  it('produces monotonically increasing, in-bounds timings', () => {
    const narrations = ['First scene words here', 'Second scene words'];
    const durations = allocateSceneDurations(narrations, 12);
    const words = buildWordTimings(narrations, durations);
    expect(words.length).toBeGreaterThan(0);
    for (let i = 0; i < words.length; i++) {
      expect(words[i].end).toBeGreaterThanOrEqual(words[i].start);
      if (i > 0) expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].start);
    }
    const last = words[words.length - 1];
    expect(last.end).toBeLessThanOrEqual(sum(durations) + 0.01);
  });

  it('groups into cues respecting the max word count', () => {
    const narrations = ['one two three four five six seven eight'];
    const words = buildWordTimings(narrations, [8]);
    const cues = groupIntoCues(words, 4);
    cues.forEach((c) => expect(c.text.split(' ').length).toBeLessThanOrEqual(4));
  });

  it('returns no cues for no words', () => {
    expect(groupIntoCues([], 4)).toEqual([]);
  });
});

describe('subtitle serialization', () => {
  const words = buildWordTimings(['hello brave new world'], [3]);
  const cues = groupIntoCues(words, 3);

  it('produces valid SRT with sequential indices', () => {
    const srt = toSrt(cues);
    expect(srt).toMatch(/^1\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/);
    expect(srt).toContain('hello');
  });

  it('produces a valid WebVTT header', () => {
    expect(toVtt(cues).startsWith('WEBVTT')).toBe(true);
  });
});

describe('duration guardrails', () => {
  it('rejects durations that are too short or too long', () => {
    expect(() => assertDurationAllowed(1)).toThrow();
    expect(() => assertDurationAllowed(999)).toThrow();
    expect(() => assertDurationAllowed(60)).not.toThrow();
  });

  it('mentions verifying platform limits in the long-duration error', () => {
    expect(() => assertDurationAllowed(999)).toThrow(/verify current platform limits/i);
  });
});

describe('rounding', () => {
  it('rounds to the requested precision', () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.23556, 3)).toBe(1.236);
  });
});
