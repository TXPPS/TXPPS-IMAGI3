import type { Page } from '@playwright/test';
import {
  CPU_BENCH_ITERATIONS,
  THROTTLE_BENCHMARK_ID,
  cpuBenchmark,
  probeRatio,
  type ThrottleProbe,
} from '@imagi3/audit';

/**
 * Run the fixed arithmetic benchmark inside a page and return the wall time.
 *
 * The expected result is checked in-page and throws on mismatch. That matters
 * more than it looks: it means a JIT that elides the loop, or a throttling
 * implementation that skips work rather than slowing it, produces a loud
 * failure instead of an impressively fast number.
 *
 * The measured function is written inline rather than passed by reference
 * because `page.evaluate` serialises source and cannot capture module scope.
 */
export async function timeCpuBenchmark(
  page: Page,
  iterations: number = CPU_BENCH_ITERATIONS,
): Promise<number> {
  const expected = cpuBenchmark(iterations);
  return page.evaluate(
    ([count, want]: readonly [number, number]) => {
      // Declared inside the callback: this function is serialised into the page
      // and cannot reference module scope.
      const multiplier = 1664525;
      const increment = 1013904223;
      let accumulator = 0;
      const start = performance.now();
      for (let i = 0; i < count; i += 1) {
        accumulator = (Math.imul(accumulator, multiplier) + increment) >>> 0;
      }
      const elapsed = performance.now() - start;
      if (accumulator !== want) {
        throw new Error(
          `cpu benchmark produced ${String(accumulator)}, expected ${String(want)}: ` +
            'the workload did not actually run',
        );
      }
      return elapsed;
    },
    [iterations, expected] as const,
  );
}

/**
 * Reject a rate CDP would silently misinterpret.
 *
 * Separated from {@link applyCpuThrottling} so it can be tested without a
 * browser: a guard that needs a live page to exercise tends to go untested, and
 * this one turns a typo into a loud failure rather than a page that quietly
 * runs at full speed.
 */
export function assertValidThrottlingRate(rate: number): void {
  if (!Number.isFinite(rate) || rate < 1) {
    throw new RangeError(`cpu throttling rate must be a finite number >= 1, got ${String(rate)}`);
  }
}

/** Apply a CDP CPU throttling multiplier to a page. 1 means unthrottled. */
export async function applyCpuThrottling(page: Page, rate: number): Promise<void> {
  assertValidThrottlingRate(rate);
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate });
}

/**
 * Probe size for throttle verification.
 *
 * CDP throttling works by making the renderer sleep periodically, so a probe
 * short enough to fall between those pauses under-reports the slowdown badly:
 * an 8M-iteration probe measured 2.57x for a requested 6x and failed a
 * correctly throttled page, and a 30M probe read 2.75x on a page whose planted
 * workload was simultaneously experiencing 3.98x.
 *
 * Sized for roughly 100ms unthrottled, which spans enough sleep cycles for the
 * ratio to be a fair estimate rather than a sample of one duty cycle.
 */
export const THROTTLE_VERIFY_ITERATIONS = 80_000_000;

/**
 * Paired samples per probe.
 *
 * Each pair is one control run with throttling off and one with it on, taken
 * back to back on the same page, so contention lasting longer than a pair
 * divides out of the ratio. Fixed — deliberately not a loop that resamples
 * until the number is acceptable. Sampling until a threshold is met is a way of
 * manufacturing a passing result, and this file exists because a measurement
 * was once trusted that had not been earned.
 *
 * Five rather than three. The estimator discards pairs whose control leg was
 * itself interfered with, and on the run Performance measured — control legs of
 * 747ms, 268ms and 232ms — that would have left two. Five pairs means the
 * discard has something to keep, at the cost of about a second per page.
 */
export const THROTTLE_PROBE_PAIRS = 5;

/**
 * How much slower than the fastest control the *median* control may be before
 * the run is called contended rather than unthrottled.
 *
 * The two diagnoses are different and were reported as one. "CPU throttling did
 * not take effect" says the harness is broken and the measurement carries no
 * device signal; "the host is busy" says the measurement could not be taken
 * now. Performance's run was the second reported as the first, six times across
 * a suite, which is the kind of failure that teaches people to re-run until
 * green.
 */
export const CONTENDED_MEDIAN_INFLATION = 2;

export class HostContentionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostContentionError';
  }
}

/**
 * How much of the requested slowdown must actually materialise.
 *
 * Generous, because this is a presence check rather than a calibration: it
 * separates "throttling is in effect" from "throttling is absent", and absence
 * reads as exactly 1.0x. How *much* throttling the profiles get is asserted
 * separately, by the ordering gate, on runs that are not competing with two
 * other browsers for four cores.
 *
 * Parallel Playwright workers saturating the host depress the observed ratio —
 * a requested 6x has been seen as 4.5x with three projects running at once — so
 * a fraction close to 1 would fail honest runs.
 *
 * This is the harness failing fast on its own page. It is not the gate: the
 * budget gate re-derives the ratio from the probe below and applies its own
 * floor, derived from the budget ceilings rather than from the requested rate.
 */
export const MIN_VERIFIED_RATIO_FRACTION = 0.4;

export interface ThrottleVerification {
  readonly requestedRate: number;
  /** Raw evidence, carried into the measurement artifact for the gate to judge. */
  readonly probe: ThrottleProbe;
  /** Convenience view of {@link probe}, computed by the gate's own estimator. */
  readonly observedRatio: number;
  /** Unthrottled milliseconds per iteration on this host, for sizing workloads. */
  readonly msPerIteration: number;
}

/**
 * Apply CPU throttling and prove, on this page, that it took effect.
 *
 * CDP throttling is per-page. A page created inside a test does not inherit the
 * fixture page's rate, and nothing about an unthrottled page looks wrong — it
 * just produces fast numbers. That is exactly how P1-PRE shipped a set of
 * device-named budgets whose measurements were never throttled at all, while
 * the self-test that existed to catch it stayed green because it ran on a
 * different page. See RC-0006.
 *
 * So the rate is not merely requested, it is measured: the same workload runs
 * with throttling off and on, alternating, on the page that will be measured.
 * The raw durations travel with the measurement; this function's own verdict is
 * a fail-fast convenience, and the authority on whether the samples evidence
 * anything is the budget gate, in another package and another process.
 *
 * The page is left throttled at `requestedRate`, which is what callers depend
 * on — the last thing the loop does is a throttled sample.
 */
export async function applyVerifiedCpuThrottling(
  page: Page,
  requestedRate: number,
): Promise<ThrottleVerification> {
  assertValidThrottlingRate(requestedRate);
  const controlMs: number[] = [];
  const throttledMs: number[] = [];

  for (let pair = 0; pair < THROTTLE_PROBE_PAIRS; pair += 1) {
    await applyCpuThrottling(page, 1);
    controlMs.push(await timeCpuBenchmark(page, THROTTLE_VERIFY_ITERATIONS));
    await applyCpuThrottling(page, requestedRate);
    throttledMs.push(await timeCpuBenchmark(page, THROTTLE_VERIFY_ITERATIONS));
  }

  const probe: ThrottleProbe = {
    benchmarkId: THROTTLE_BENCHMARK_ID,
    iterations: THROTTLE_VERIFY_ITERATIONS,
    checksum: cpuBenchmark(THROTTLE_VERIFY_ITERATIONS),
    requestedRate,
    controlMs,
    throttledMs,
  };

  const observedRatio = probeRatio(probe);
  const required = requestedRate * MIN_VERIFIED_RATIO_FRACTION;
  if (!(observedRatio >= required)) {
    const samples =
      `control ${controlMs.map((ms) => ms.toFixed(0)).join('/')}ms, ` +
      `throttled ${throttledMs.map((ms) => ms.toFixed(0)).join('/')}ms`;
    // Two different diagnoses, told apart before either is reported. A control
    // leg whose median sits far above the run's fastest is a host under load,
    // not a page that failed to throttle, and calling the second the first is
    // how a suite comes to be re-run until it is green.
    const fastest = Math.min(...controlMs);
    const typical = median(controlMs);
    if (typical > fastest * CONTENDED_MEDIAN_INFLATION) {
      throw new HostContentionError(
        `This host was too busy to measure throttling: the fastest control leg ran in ` +
          `${fastest.toFixed(0)}ms and the median in ${typical.toFixed(0)}ms (${samples}). ` +
          'That spread is other work on the machine, not a page that failed to throttle. ' +
          'Re-run with fewer workers, or on a quieter host.',
      );
    }
    throw new Error(
      `CPU throttling did not take effect on this page: requested ${String(requestedRate)}x, ` +
        `${String(THROTTLE_PROBE_PAIRS)} paired samples evidence ${observedRatio.toFixed(2)}x ` +
        `(${samples}), below the required ${required.toFixed(2)}x. ` +
        'Any measurement taken on this page would carry no device signal.',
    );
  }

  return {
    requestedRate,
    probe,
    observedRatio,
    msPerIteration: Math.min(...controlMs) / THROTTLE_VERIFY_ITERATIONS,
  };
}

/**
 * The median, averaging the two middle values for an even count.
 *
 * `sorted[floor(n/2)]` is the *upper* middle, so for two samples it returns the
 * larger — the maximum. That defect was found and fixed in the audit package's
 * estimator at the P1 gate, and this second copy still had it at pass 2, which
 * is the argument for one implementation rather than two. It is reachable now:
 * {@link THROTTLE_PROBE_PAIRS} is five, but the contended-control filter can
 * leave an even number of usable samples.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('cannot take the median of an empty sample set');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? Number.NaN;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return lower === undefined || upper === undefined ? Number.NaN : (lower + upper) / 2;
}

/** Warmup runs discarded before sampling, so JIT tiering is not measured. */
export const BENCH_WARMUP_RUNS = 2;
/** Odd sample count so the median is an observed value. */
export const BENCH_SAMPLE_RUNS = 5;

/** Time the benchmark repeatedly and return the median, after warmup. */
export async function medianCpuBenchmark(page: Page): Promise<number> {
  for (let i = 0; i < BENCH_WARMUP_RUNS; i += 1) await timeCpuBenchmark(page);
  const samples: number[] = [];
  for (let i = 0; i < BENCH_SAMPLE_RUNS; i += 1) samples.push(await timeCpuBenchmark(page));
  return median(samples);
}
