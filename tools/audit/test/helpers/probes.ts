import { CPU_BENCH_ITERATIONS, cpuBenchmark } from '../../src/bench/cpu.ts';
import { THROTTLE_BENCHMARK_ID, type ThrottleProbe } from '../../src/budgets/throttle.ts';

/**
 * Throttling probes for tests, built valid so a test can plant exactly one
 * fault at a time.
 *
 * The checksum is computed rather than hard-coded. A literal here would be a
 * second definition of what the workload folds to, and the first thing to
 * silently disagree with the benchmark the day its constants change — at which
 * point every probe test would fail for a reason unrelated to what it asserts.
 */
const CHECKSUM = cpuBenchmark(CPU_BENCH_ITERATIONS);

/** Milliseconds the control side reports. Far above the plausibility floor. */
const CONTROL_MS = 100;

/**
 * A valid probe evidencing `ratio` at `requestedRate`.
 *
 * Three pairs, matching what the browser harness produces, so a test that
 * plants a fault is planting it in the shape the gate actually receives.
 */
export function probe(ratio: number, requestedRate = 4): ThrottleProbe {
  return {
    benchmarkId: THROTTLE_BENCHMARK_ID,
    iterations: CPU_BENCH_ITERATIONS,
    checksum: CHECKSUM,
    requestedRate,
    controlMs: [CONTROL_MS, CONTROL_MS, CONTROL_MS],
    throttledMs: [CONTROL_MS * ratio, CONTROL_MS * ratio, CONTROL_MS * ratio],
  };
}
