/**
 * A fixed arithmetic workload used to calibrate and verify CPU throttling.
 *
 * Requirements this shape satisfies:
 *
 * - **Deterministic.** The same iteration count always yields the same value,
 *   so the caller can assert the result. A JIT that elides the loop, or a
 *   throttling implementation that silently skips work, changes the answer.
 * - **Integer only.** No floating point, so the result is identical across
 *   platforms and engines.
 * - **CPU bound.** No allocation, no DOM, no I/O — CPU throttling is the only
 *   thing that should move the wall time.
 *
 * The constants are the Numerical Recipes linear congruential generator, used
 * here purely as a cheap dependent-operation chain: each iteration needs the
 * previous result, so the work cannot be parallelised or reordered away.
 */
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;

/**
 * Iterations per benchmark run.
 *
 * Sized so an unthrottled run takes roughly 100ms on the reference host: long
 * enough that timer noise and scheduler jitter are small relative to the
 * signal, short enough that a seven-rate calibration sweep stays quick.
 */
export const CPU_BENCH_ITERATIONS = 80_000_000;

/**
 * Fold `iterations` LCG steps into a single unsigned 32-bit value.
 *
 * Runs in Node, to compute the value the in-page copy is checked against. The
 * page-side copy is written out inline in `@imagi3/repo`, because
 * `page.evaluate` serialises source and cannot capture module scope.
 */
export function cpuBenchmark(iterations: number): number {
  let accumulator = 0;
  for (let i = 0; i < iterations; i += 1) {
    accumulator = (Math.imul(accumulator, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
  }
  return accumulator;
}

export { LCG_MULTIPLIER, LCG_INCREMENT };
