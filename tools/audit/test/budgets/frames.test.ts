import { describe, expect, it } from 'vitest';
import {
  FRAME_BUDGET_60HZ_MS,
  FrameSampleError,
  MAX_ENGINE_FRAME_SHARE,
  MIN_FRAMES,
  WARMUP_FRAMES,
  cpuFrameMsFrom,
  frameRateFrom,
  type FrameSamples,
} from '../../src/budgets/frames.ts';

/**
 * Frame statistics are derived by the gate from raw per-frame durations, never
 * read from a number the page computed about itself. These tests hold the two
 * derivations to their stated reductions and to their refusals — a measurement
 * this module declines to produce is a measurement the gate cannot mistake for
 * evidence.
 */

function samples(overrides: Partial<FrameSamples> = {}): FrameSamples {
  const count = WARMUP_FRAMES + MIN_FRAMES;
  return {
    frameMs: Array.from({ length: count }, () => 16),
    cpuMs: Array.from({ length: count }, () => 2),
    entityCount: 400,
    steps: 100,
    ...overrides,
  };
}

/** `warm` values of warmup followed by the values a statistic is taken over. */
function withTail(warm: number, tail: readonly number[]): number[] {
  return [...Array.from({ length: WARMUP_FRAMES }, () => warm), ...tail];
}

describe('frameRateFrom', () => {
  it('converts frame duration to a rate', () => {
    expect(frameRateFrom(samples()).fps).toBeCloseTo(1000 / 16, 6);
  });

  /**
   * The whole reason a frame budget is not stated as a mean: 59 fast frames and
   * one 200ms frame averages to a comfortable rate while visibly hitching, and
   * the hitch is the thing a player notices.
   */
  it('is decided by the slow frames, not the average', () => {
    // 27 frames at 8ms and 3 at 200ms averages to 27ms — a comfortable 37fps —
    // while dropping a tenth of its frames. The p95 sees the tenth.
    const hitching = samples({
      frameMs: withTail(8, [...Array.from({ length: 27 }, () => 8), 200, 200, 200]),
    });
    expect(frameRateFrom(hitching).fps).toBeCloseTo(1000 / 200, 6);
  });

  it('discards the warmup frames, where shader compilation lands', () => {
    // A 5000ms first frame must not decide a sustained-rate budget; it belongs
    // to cold load, which already measures it.
    const slowStart = samples({
      frameMs: withTail(
        5000,
        Array.from({ length: 30 }, () => 8),
      ),
    });
    expect(frameRateFrom(slowStart).fps).toBeCloseTo(1000 / 8, 6);
  });

  it('refuses to report from too few frames rather than producing a number', () => {
    expect(() => frameRateFrom(samples({ frameMs: [1, 2, 3] }))).toThrow(FrameSampleError);
  });

  it('refuses when the simulation never ran', () => {
    // A renderer drawing a frozen world meets any frame budget.
    expect(() => frameRateFrom(samples({ steps: 0 }))).toThrow(/no steps/u);
  });

  it('ignores non-positive and non-finite durations rather than dividing by them', () => {
    const clean = Array.from({ length: 30 }, () => 16);
    const dirty = samples({ frameMs: withTail(16, [0, -1, Number.NaN, ...clean]) });
    expect(frameRateFrom(dirty).fps).toBeCloseTo(1000 / 16, 6);
  });

  it('reports the entity and step counts, so a budget cannot be met by drawing less', () => {
    const detail = frameRateFrom(samples()).detail;
    expect(detail).toContain('400 entities');
    expect(detail).toContain('100 simulation steps');
  });
});

describe('cpuFrameMsFrom', () => {
  it('reports the median engine cost', () => {
    expect(cpuFrameMsFrom(samples()).cpuMs).toBe(2);
  });

  /**
   * The opposite reduction from `frameRateFrom`, deliberately. Here the tail is
   * the instrument, not the experience: CDP throttling advances by sleeping the
   * renderer, and whether a sleep lands inside a two-millisecond timed section
   * is a coin flip. Five runs of unchanged code gave a p95 between 6.8 and
   * 8.7ms while the median stayed between 2.5 and 3.9.
   */
  it('is not moved by a handful of outlying frames', () => {
    const spiky = samples({
      cpuMs: withTail(2, [...Array.from({ length: 27 }, () => 2), 90, 90, 90]),
    });
    expect(cpuFrameMsFrom(spiky).cpuMs).toBe(2);
  });

  it('still reports the tail, which is worth watching even when it cannot gate', () => {
    const spiky = samples({
      cpuMs: withTail(2, [...Array.from({ length: 27 }, () => 2), 90, 90, 90]),
    });
    expect(cpuFrameMsFrom(spiky).detail).toContain('p95 90.00ms');
  });

  it('does move when the whole distribution moves', () => {
    // The regression this budget exists to catch must still be caught.
    const slower = Array.from({ length: 30 }, () => 12);
    expect(cpuFrameMsFrom(samples({ cpuMs: withTail(2, slower) })).cpuMs).toBe(12);
  });

  it('accepts a zero-cost frame, unlike the frame-rate reduction', () => {
    // Zero milliseconds of engine work is a plausible reading at timer
    // granularity; zero milliseconds of wall-clock frame is not.
    const free = Array.from({ length: 30 }, () => 0);
    expect(cpuFrameMsFrom(samples({ cpuMs: withTail(0, free) })).cpuMs).toBe(0);
  });

  it('refuses to report from too few frames', () => {
    expect(() => cpuFrameMsFrom(samples({ cpuMs: [1, 2] }))).toThrow(FrameSampleError);
  });

  it('refuses when the simulation never ran', () => {
    expect(() => cpuFrameMsFrom(samples({ steps: 0 }))).toThrow(FrameSampleError);
  });
});

describe('the budget derivation', () => {
  it('states a 60Hz frame as 16.67ms', () => {
    expect(FRAME_BUDGET_60HZ_MS).toBeCloseTo(16.67, 2);
  });

  it('gives the engine at most half of it', () => {
    // The other half covers rasterisation, compositing and the gameplay a real
    // project adds. The committed ceiling of 8ms is this, rounded down.
    expect(FRAME_BUDGET_60HZ_MS * MAX_ENGINE_FRAME_SHARE).toBeGreaterThan(8);
    expect(FRAME_BUDGET_60HZ_MS * MAX_ENGINE_FRAME_SHARE).toBeLessThan(9);
  });
});
