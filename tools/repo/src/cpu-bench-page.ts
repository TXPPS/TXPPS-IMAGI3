import type { Page } from '@playwright/test';
import { CPU_BENCH_ITERATIONS, cpuBenchmark } from '@imagi3/audit';

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
 * Sized for roughly 40ms unthrottled, not less. CDP throttling works by making
 * the renderer sleep periodically, so a probe short enough to fall between
 * those pauses reports a ratio far below the real one: an 8M-iteration probe
 * measured 2.57x for a requested 6x and failed a correctly throttled page.
 */
export const THROTTLE_VERIFY_ITERATIONS = 30_000_000;

/**
 * Samples per side of the verification.
 *
 * The minimum is taken, not the mean: contention between parallel Playwright
 * workers can only ever make a run slower, so the fastest sample is the best
 * estimate of the true speed. A mean would let a neighbouring worker's load
 * inflate the unthrottled baseline and collapse the apparent ratio.
 */
export const THROTTLE_VERIFY_SAMPLES = 2;

async function fastestBenchmark(page: Page, iterations: number): Promise<number> {
  let fastest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < THROTTLE_VERIFY_SAMPLES; i += 1) {
    fastest = Math.min(fastest, await timeCpuBenchmark(page, iterations));
  }
  return fastest;
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
 */
export const MIN_VERIFIED_RATIO_FRACTION = 0.4;

/**
 * Attempts before declaring throttling absent.
 *
 * Contention is transient and missing throttling is not, so a retry separates
 * them without weakening the check: an unthrottled page reads 1.0x on every
 * attempt.
 */
export const MAX_VERIFY_ATTEMPTS = 3;

export interface ThrottleVerification {
  readonly requestedRate: number;
  readonly unthrottledMs: number;
  readonly throttledMs: number;
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
 * before and after, on the page that will be measured, and a slowdown that
 * never arrives throws instead of quietly producing a good result.
 */
export async function applyVerifiedCpuThrottling(
  page: Page,
  requestedRate: number,
): Promise<ThrottleVerification> {
  const unthrottledMs = await fastestBenchmark(page, THROTTLE_VERIFY_ITERATIONS);
  await applyCpuThrottling(page, requestedRate);

  if (requestedRate === 1) {
    return {
      requestedRate,
      unthrottledMs,
      throttledMs: unthrottledMs,
      observedRatio: 1,
      msPerIteration: unthrottledMs / THROTTLE_VERIFY_ITERATIONS,
    };
  }

  const required = requestedRate * MIN_VERIFIED_RATIO_FRACTION;
  let bestRatio = 0;
  let throttledMs = Number.NaN;

  for (let attempt = 0; attempt < MAX_VERIFY_ATTEMPTS; attempt += 1) {
    const sample = await fastestBenchmark(page, THROTTLE_VERIFY_ITERATIONS);
    const ratio = sample / unthrottledMs;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      throttledMs = sample;
    }
    if (bestRatio >= required) break;
  }

  if (bestRatio < required) {
    throw new Error(
      `CPU throttling did not take effect on this page: requested ${String(requestedRate)}x, ` +
        `best of ${String(MAX_VERIFY_ATTEMPTS)} attempts was ${bestRatio.toFixed(2)}x ` +
        `(${unthrottledMs.toFixed(1)}ms unthrottled, ${throttledMs.toFixed(1)}ms throttled), ` +
        `below the required ${required.toFixed(2)}x. ` +
        'Any measurement taken on this page would carry no device signal.',
    );
  }

  return {
    requestedRate,
    unthrottledMs,
    throttledMs,
    observedRatio: bestRatio,
    msPerIteration: unthrottledMs / THROTTLE_VERIFY_ITERATIONS,
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('cannot take the median of an empty sample set');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
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
