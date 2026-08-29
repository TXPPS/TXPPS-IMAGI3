import { describe, expect, it } from 'vitest';
import {
  MIN_VERIFIED_RATIO_FRACTION,
  THROTTLE_VERIFY_ITERATIONS,
  assertValidThrottlingRate,
  median,
} from '../src/cpu-bench-page.ts';

/**
 * These are four-line pure functions producing every number the throttling
 * gate consumes, and they shipped with no tests at all — a mutation review
 * found that returning the minimum instead of the median, or deleting the CDP
 * call outright, left the whole unit suite green.
 */
describe('median', () => {
  it.each([
    ['a single value', [7], 7],
    ['an odd count', [3, 1, 2], 2],
    ['an unsorted odd count', [10, 1, 5], 5],
    ['identical values', [4, 4, 4], 4],
  ])('%s', (_label, values, expected) => {
    expect(median(values)).toBe(expected);
  });

  it('is not the minimum', () => {
    // The mutation that survived: min and median agree on many inputs but not
    // on this one, and the difference is exactly what hides a slow outlier.
    expect(median([1, 50, 100])).toBe(50);
    expect(median([1, 50, 100])).not.toBe(Math.min(1, 50, 100));
  });

  it('is not the mean', () => {
    expect(median([1, 2, 300])).toBe(2);
  });

  it('averages the two middle values for an even count', () => {
    // `sorted[floor(n/2)]` is the upper middle, so this returned 2 — the
    // maximum — for a two-sample set. Fixed once in the audit package's
    // estimator at the P1 gate and still present in this second copy at pass 2,
    // which is the argument against having two.
    expect(median([1, 2])).toBe(1.5);
    expect(median([10, 1, 5, 4])).toBe(4.5);
  });

  it('is not the upper middle', () => {
    expect(median([1, 100])).not.toBe(100);
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it('refuses an empty sample set rather than returning NaN', () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('assertValidThrottlingRate', () => {
  it.each([1, 2, 4, 6, 1.5])('accepts %s', (rate) => {
    expect(() => {
      assertValidThrottlingRate(rate);
    }).not.toThrow();
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (rate) => {
    expect(() => {
      assertValidThrottlingRate(rate);
    }).toThrow(RangeError);
  });

  it('names the offending value', () => {
    expect(() => {
      assertValidThrottlingRate(0);
    }).toThrow(/got 0/);
  });
});

describe('verification constants', () => {
  it('sizes the probe well above the range where CDP throttling reads low', () => {
    // An 8M-iteration probe measured 2.57x for a requested 6x, because CDP
    // throttling works by periodic sleeps a short probe can fall between.
    expect(THROTTLE_VERIFY_ITERATIONS).toBeGreaterThanOrEqual(20_000_000);
  });

  it('keeps the presence threshold far enough above an unthrottled 1.0x', () => {
    // At rate 4 this requires 1.6x; an unthrottled page reads 1.0x.
    expect(MIN_VERIFIED_RATIO_FRACTION * 4).toBeGreaterThanOrEqual(1.5);
    expect(MIN_VERIFIED_RATIO_FRACTION).toBeLessThan(1);
  });
});
