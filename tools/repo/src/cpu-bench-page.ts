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

/** Apply a CDP CPU throttling multiplier to a page. 1 means unthrottled. */
export async function applyCpuThrottling(page: Page, rate: number): Promise<void> {
  if (!Number.isFinite(rate) || rate < 1) {
    throw new RangeError(`cpu throttling rate must be a finite number >= 1, got ${String(rate)}`);
  }
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate });
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
