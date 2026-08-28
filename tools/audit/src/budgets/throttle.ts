import { CPU_BENCH_ITERATIONS, cpuBenchmark } from '../bench/cpu.ts';

/**
 * CPU throttling evidence, as raw samples rather than a reported number.
 *
 * The previous shape was a single scalar `throttleRatio` written by the
 * harness. That is precisely the provenance RC-0006 says not to trust: the
 * producer attesting its own work. A harness that stopped throttling but kept
 * writing `4.7` would have sailed through the gate, and nothing in the artifact
 * could have contradicted it.
 *
 * So the harness no longer gets to state a conclusion. It reports what it
 * observed — the workload it ran, how long that workload took with throttling
 * off, and how long the same workload took with throttling on — and the gate
 * derives the ratio itself, in a different module and a different process from
 * the code that produced the samples.
 *
 * The unthrottled control is captured in the same run, on the same page, on
 * the same host, moments before the throttled samples. That kills two things at
 * once: a fabricated ratio, because there is no ratio to fabricate; and host
 * drift, because the baseline is not a constant recorded on a developer's
 * machine in P1-PRE but a measurement of the machine that is running now.
 *
 * What this still cannot do, stated plainly so it is not mistaken for more: a
 * harness that computes plausible numbers without running anything will pass.
 * Nothing in a file can attest itself. What changed is the cost of the failure
 * that actually happened — an honest harness silently losing its throttling now
 * produces a control and a throttled sample that are the same speed, and the
 * derived ratio collapses to 1.0 whatever anyone wrote down.
 */

/**
 * Identity of the workload. Recorded so a probe from a *different* benchmark
 * cannot be read as evidence about this one — an easy mistake to make later,
 * when there is more than one benchmark in the tree.
 */
export const THROTTLE_BENCHMARK_ID = 'lcg-imul-u32';

/**
 * Shortest probe whose ratio means anything.
 *
 * CDP throttling works by periodically sleeping the renderer, so a probe short
 * enough to fit between two pauses under-reports the slowdown badly: an
 * 8M-iteration probe read 2.57x on a page that was genuinely throttled 6x. A
 * probe below this length is rejected rather than believed, because a
 * short-probe ratio fails *low*, which reads as missing throttling and would
 * turn an honest run red for the wrong reason.
 */
export const MIN_PROBE_ITERATIONS = CPU_BENCH_ITERATIONS;

/**
 * Fastest the workload could conceivably run, in milliseconds per iteration.
 *
 * Each iteration is a 32-bit multiply feeding the next iteration, so the chain
 * cannot be parallelised and one iteration costs at least a multiply's latency
 * — a few cycles. This floor is 0.1 nanoseconds per iteration: a 10GHz core
 * retiring the whole dependent chain every cycle. It is a physical
 * impossibility line, not a calibration.
 *
 * **The margin, stated accurately.** For the 80M-iteration probe this floor is
 * 8ms against a real control of about 100ms — a factor of **12.5**, not the
 * "two orders of magnitude" this comment claimed until Performance measured it
 * at the P1 gate. It also constrains only the control, and only from below,
 * which is not the direction a fabricator would push: inflating the throttled
 * side is unconstrained by it. It is a sanity check on one number, and that is
 * all it is.
 */
export const MIN_PLAUSIBLE_MS_PER_ITERATION = 1e-7;

/** One page's throttling evidence: the same workload, off and then on. */
export interface ThrottleProbe {
  /** Which workload ran. Must be {@link THROTTLE_BENCHMARK_ID}. */
  readonly benchmarkId: string;
  readonly iterations: number;
  /**
   * Value the workload folded to, checked in-page and recomputed by the gate.
   *
   * A JIT that elides the dependent chain, or a throttling implementation that
   * skips work instead of slowing it, produces a different value. The gate
   * recomputing it means a probe cannot claim to have run a workload whose
   * answer it does not know.
   */
  readonly checksum: number;
  /** Rate asked of CDP. Checked against the profile by the budget gate. */
  readonly requestedRate: number;
  /**
   * Raw wall-clock milliseconds with throttling off, same page and run.
   *
   * Paired index-for-index with {@link throttledMs}: entry `i` of each was
   * measured back to back, throttling off then on, so contention that lasts
   * longer than one pair divides out of the ratio instead of biasing it.
   */
  readonly controlMs: readonly number[];
  /** Raw wall-clock milliseconds with throttling on, paired with the control. */
  readonly throttledMs: readonly number[];
}

/** Enough places to show a sub-millisecond duration as something other than 0. */
const MS_DECIMALS = 4;

const checksumCache = new Map<number, number>();

function expectedChecksum(iterations: number): number {
  const cached = checksumCache.get(iterations);
  if (cached !== undefined) return cached;
  const value = cpuBenchmark(iterations);
  checksumCache.set(iterations, value);
  return value;
}

function describeSamples(samples: readonly number[], label: string): string | undefined {
  if (samples.length === 0) return `${label} samples are empty`;
  const bad = samples.find((value) => !Number.isFinite(value) || value <= 0);
  if (bad !== undefined) return `${label} sample ${String(bad)} is not a positive duration`;
  return undefined;
}

/**
 * Why a probe cannot be used as evidence, or undefined when it can be.
 *
 * Returns a reason rather than throwing: an unusable probe is a gate result to
 * be reported next to the budget it failed, not an exception that aborts the
 * run before the other budgets are reported.
 */
export function probeFault(probe: ThrottleProbe): string | undefined {
  if (probe.benchmarkId !== THROTTLE_BENCHMARK_ID) {
    return `probe ran benchmark "${probe.benchmarkId}", not "${THROTTLE_BENCHMARK_ID}"`;
  }
  if (!Number.isInteger(probe.iterations) || probe.iterations < MIN_PROBE_ITERATIONS) {
    return (
      `probe ran ${String(probe.iterations)} iterations, below the ` +
      `${String(MIN_PROBE_ITERATIONS)} needed to span CDP's sleep cycles`
    );
  }
  if (probe.checksum !== expectedChecksum(probe.iterations)) {
    return (
      `probe reports checksum ${String(probe.checksum)} for ${String(probe.iterations)} ` +
      `iterations; the workload folds to ${String(expectedChecksum(probe.iterations))}`
    );
  }
  const controlFault = describeSamples(probe.controlMs, 'control');
  if (controlFault !== undefined) return controlFault;
  const throttledFault = describeSamples(probe.throttledMs, 'throttled');
  if (throttledFault !== undefined) return throttledFault;
  if (probe.controlMs.length !== probe.throttledMs.length) {
    return (
      `probe has ${String(probe.controlMs.length)} control samples against ` +
      `${String(probe.throttledMs.length)} throttled ones; the ratio is computed pairwise ` +
      'and unpaired samples were not measured back to back'
    );
  }

  const floorMs = probe.iterations * MIN_PLAUSIBLE_MS_PER_ITERATION;
  const fastest = Math.min(...probe.controlMs);
  if (fastest < floorMs) {
    return (
      `control ran ${String(probe.iterations)} dependent multiplies in ` +
      `${fastest.toFixed(MS_DECIMALS)}ms, below the ${floorMs.toFixed(MS_DECIMALS)}ms floor ` +
      'of what hardware can do'
    );
  }
  return undefined;
}

/**
 * The median, averaging the two middle values for an even count.
 *
 * `sorted[floor(n/2)]` is the *upper* middle, so for two samples it returns the
 * larger — the maximum, which this module's own documentation rejects as "not
 * an estimate at all; the largest ratio the data can be made to yield".
 * `observedThrottleRatio([1.0x, 9.0x])` returned 9.0x, discarding a page where
 * throttling was entirely absent rather than halving the estimate for it.
 *
 * Unreachable today, because the sample and probe counts are both three. Fixed
 * anyway: nothing pins those counts odd, and a guard that is correct only for
 * the argument it currently receives is a guard waiting for a refactor.
 * Found by Performance at the P1 gate.
 */
function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? Number.NaN;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return lower === undefined || upper === undefined ? Number.NaN : (lower + upper) / 2;
}

/**
 * One probe's slowdown: the median of its paired throttled-over-control ratios.
 *
 * Pairwise, not pooled. Two reductions over pooled samples were considered and
 * both are worse. A minimum-over-minimum estimates each side's uncontended
 * speed, but it also means every extra sample can only lower the result, so a
 * harness that resamples on a low reading can never recover from one slow
 * control draw. A maximum-over-minimum is not an estimate at all; it is the
 * largest ratio the data can be made to yield, and review has already disproved
 * the argument that every influence depresses this quantity.
 *
 * Dividing samples that were taken back to back cancels whatever load was
 * present across both, which is the actual nuisance variable. The median over
 * those pairs then resists a single bad draw in either direction — the property
 * the cold-load spec reasoned its way to, applied one level down.
 */
export function probeRatio(probe: ThrottleProbe): number {
  if (probe.controlMs.length !== probe.throttledMs.length) return Number.NaN;
  const pairs = probe.throttledMs.map((throttled, index) => {
    const control = probe.controlMs[index];
    return control === undefined || control <= 0 ? Number.NaN : throttled / control;
  });
  return pairs.length === 0 ? Number.NaN : median(pairs);
}

/**
 * The slowdown a set of probes evidences: the median of their ratios.
 *
 * The same reduction as within a probe, for the same reason: across pages, one
 * unlucky page should not decide the verdict for the run. The minimum reads
 * 1.96x on a genuinely 4x-throttled host after one bad baseline draw, which
 * this host produced; the maximum rests on a premise measurement contradicted.
 */
export function observedThrottleRatio(probes: readonly ThrottleProbe[]): number {
  if (probes.length === 0) return Number.NaN;
  return median(probes.map(probeRatio));
}

/** The first unusable probe's reason, or undefined when every probe is usable. */
export function firstProbeFault(probes: readonly ThrottleProbe[]): string | undefined {
  for (const probe of probes) {
    const fault = probeFault(probe);
    if (fault !== undefined) return fault;
  }
  return undefined;
}
