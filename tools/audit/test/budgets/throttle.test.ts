import { describe, expect, it } from 'vitest';
import { CPU_BENCH_ITERATIONS } from '../../src/bench/cpu.ts';
import {
  MIN_PLAUSIBLE_MS_PER_ITERATION,
  MIN_PROBE_ITERATIONS,
  THROTTLE_BENCHMARK_ID,
  firstProbeFault,
  observedThrottleRatio,
  probeFault,
  probeRatio,
} from '../../src/budgets/throttle.ts';
import { probe } from '../helpers/probes.ts';

/**
 * The estimator, tested on constructed samples rather than on a browser.
 *
 * This is the half of the throttling guarantee that can be exercised without
 * hardware, and it is deliberately the half that decides. The browser harness
 * observes; this decides what the observations mean, in a different package and
 * a different process from the code that produced them, so an edit that removes
 * throttling from the harness cannot also remove the requirement for it.
 */
describe('probeRatio', () => {
  it('divides paired samples rather than pooling them', () => {
    // Pooling minima would give 100/100 = 1.0 and hide the slowdown entirely.
    // Pairing sees a page that was consistently 4x slower under throttling.
    const paired = { ...probe(1), controlMs: [100, 25], throttledMs: [400, 100] };
    expect(probeRatio(paired)).toBe(4);
  });

  it('takes the median of the pairs, so one bad pair cannot decide it', () => {
    const noisy = { ...probe(1), controlMs: [100, 100, 100], throttledMs: [100, 400, 4000] };
    expect(probeRatio(noisy)).toBe(4);
  });

  it('is not the maximum, which would be the largest ratio the data can yield', () => {
    const noisy = { ...probe(1), controlMs: [100, 100, 100], throttledMs: [100, 400, 4000] };
    expect(probeRatio(noisy)).not.toBe(40);
  });

  it('is not the minimum, which one slow control draw would collapse', () => {
    const noisy = { ...probe(1), controlMs: [100, 100, 100], throttledMs: [100, 400, 4000] };
    expect(probeRatio(noisy)).not.toBe(1);
  });

  it('reads 1.0 when throttling is absent, whatever anyone wrote down', () => {
    expect(probeRatio(probe(1))).toBe(1);
  });

  it('refuses unpaired samples instead of guessing an alignment', () => {
    const unpaired = { ...probe(1), controlMs: [100, 100], throttledMs: [400] };
    expect(probeRatio(unpaired)).toBeNaN();
  });

  it('refuses an empty probe', () => {
    expect(probeRatio({ ...probe(1), controlMs: [], throttledMs: [] })).toBeNaN();
  });
});

describe('observedThrottleRatio', () => {
  it('takes the median across probes', () => {
    expect(observedThrottleRatio([probe(1), probe(4), probe(9)])).toBe(4);
  });

  it('is not carried by one lucky page', () => {
    expect(observedThrottleRatio([probe(1), probe(1), probe(9)])).toBe(1);
  });

  it('has no value to report for no probes', () => {
    expect(observedThrottleRatio([])).toBeNaN();
  });
});

/**
 * Each fault is planted alone, against an otherwise valid probe. A probe with
 * several faults at once would let any single check be deleted with this suite
 * still green — the failure mode RC-0003 was, one level up.
 */
describe('probeFault', () => {
  it('accepts a well-formed probe', () => {
    expect(probeFault(probe(4))).toBeUndefined();
  });

  it('rejects a probe from a different benchmark', () => {
    expect(probeFault({ ...probe(4), benchmarkId: 'something-else' })).toContain(
      THROTTLE_BENCHMARK_ID,
    );
  });

  it('rejects a probe too short to span CDP sleep cycles', () => {
    const short = { ...probe(4), iterations: MIN_PROBE_ITERATIONS - 1 };
    expect(probeFault(short)).toContain('below the');
  });

  it('rejects a fractional iteration count', () => {
    expect(probeFault({ ...probe(4), iterations: CPU_BENCH_ITERATIONS + 0.5 })).toBeDefined();
  });

  it('rejects a checksum the workload does not produce', () => {
    expect(probeFault({ ...probe(4), checksum: 0 })).toContain('checksum');
  });

  it('rejects empty control samples', () => {
    expect(probeFault({ ...probe(4), controlMs: [], throttledMs: [] })).toContain(
      'control samples are empty',
    );
  });

  it('rejects empty throttled samples', () => {
    expect(probeFault({ ...probe(4), throttledMs: [] })).toContain('throttled samples are empty');
  });

  it('rejects a non-finite sample', () => {
    expect(probeFault({ ...probe(4), controlMs: [100, Number.NaN, 100] })).toBeDefined();
  });

  it('rejects a zero-length duration', () => {
    expect(probeFault({ ...probe(4), controlMs: [100, 0, 100] })).toBeDefined();
  });

  it('rejects unpaired sample arrays', () => {
    expect(probeFault({ ...probe(4), controlMs: [100, 100] })).toContain('pairwise');
  });

  /**
   * Sample arrays, unlike a scalar, can be checked against physics. This is
   * the one thing the new shape can say about fabrication that the old one
   * could not: a control claiming eighty million dependent multiplies in a
   * fraction of a millisecond describes hardware that does not exist.
   */
  it('rejects a control faster than hardware can run the workload', () => {
    const floorMs = CPU_BENCH_ITERATIONS * MIN_PLAUSIBLE_MS_PER_ITERATION;
    const impossible = {
      ...probe(4),
      controlMs: [floorMs / 2, floorMs / 2, floorMs / 2],
      throttledMs: [floorMs * 2, floorMs * 2, floorMs * 2],
    };
    expect(probeFault(impossible)).toContain('floor of what hardware can do');
  });

  it('leaves an honest control well clear of that floor', () => {
    // 100ms for 80M iterations is what the reference host measures; the floor
    // is 8ms. A floor that could fail an honest run would be worse than none.
    expect(CPU_BENCH_ITERATIONS * MIN_PLAUSIBLE_MS_PER_ITERATION).toBeLessThan(10);
  });
});

describe('firstProbeFault', () => {
  it('finds a fault anywhere in the list, not only at the head', () => {
    const bad = { ...probe(4), checksum: 1 };
    expect(firstProbeFault([probe(4), probe(4), bad])).toContain('checksum');
  });

  it('passes a list of sound probes', () => {
    expect(firstProbeFault([probe(4), probe(5)])).toBeUndefined();
  });
});
