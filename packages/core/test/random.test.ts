import { describe, expect, it } from 'vitest';
import { createRandom } from '../src/random.ts';

/**
 * The seeded generator had no test file at all.
 *
 * It is exercised indirectly everywhere — every determinism test runs through
 * it — which is exactly why the gaps were invisible: an indirect exercise
 * pins the behaviour the caller happens to use and nothing else. QA Automation
 * neutered the seed guard to `if (false)` at the P1 gate and 911 tests passed,
 * so a documented `RangeError` was documentation only.
 *
 * A non-integer seed is not a pedantic complaint. `state = seed >>> 0` truncates
 * silently, so `createRandom(1.5)` and `createRandom(1)` produce the same
 * sequence — two runs that a reader would expect to differ, agreeing, in the
 * one component whose whole job is being reproducible from its input.
 */
describe('createRandom', () => {
  it('rejects a non-integer seed rather than truncating it', () => {
    expect(() => createRandom(1.5)).toThrow(RangeError);
  });

  it('says what was wrong with the seed', () => {
    expect(() => createRandom(1.5)).toThrow(/seed must be an integer/u);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects %s',
    (seed) => {
      expect(() => createRandom(seed)).toThrow(RangeError);
    },
  );

  it('accepts zero and negative integers', () => {
    expect(() => createRandom(0)).not.toThrow();
    expect(() => createRandom(-7)).not.toThrow();
  });

  it('produces the same sequence for the same seed', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const first = Array.from({ length: 8 }, () => a.nextUint32());
    const second = Array.from({ length: 8 }, () => b.nextUint32());
    expect(first).toEqual(second);
  });

  it('produces different sequences for different seeds', () => {
    // Not a statistical claim — just that the seed reaches the state at all.
    expect(createRandom(1).nextUint32()).not.toBe(createRandom(2).nextUint32());
  });

  it('advances rather than repeating', () => {
    const random = createRandom(3);
    const draws = Array.from({ length: 16 }, () => random.nextUint32());
    expect(new Set(draws).size).toBe(draws.length);
  });

  it('returns unsigned 32-bit integers', () => {
    const random = createRandom(9);
    for (let draw = 0; draw < 32; draw += 1) {
      const value = random.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xff_ff_ff_ff);
    }
  });

  it('returns unit-interval floats from next, never reaching one', () => {
    const random = createRandom(11);
    for (let draw = 0; draw < 64; draw += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('draws next from the same stream as nextUint32', () => {
    // Two generators, one calling each method: the float must be the integer
    // scaled, not an independent draw, or a mixed caller desynchronises them.
    const asFloat = createRandom(5).next();
    const asInt = createRandom(5).nextUint32();
    expect(asFloat).toBeCloseTo(asInt / 2 ** 32, 12);
  });
});
