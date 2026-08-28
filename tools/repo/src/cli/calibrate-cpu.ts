import { chromium, type Page } from '@playwright/test';
import { CPU_BENCH_ITERATIONS } from '@imagi3/audit';
import {
  BENCH_SAMPLE_RUNS,
  BENCH_WARMUP_RUNS,
  applyCpuThrottling,
  medianCpuBenchmark,
  timeCpuBenchmark,
} from '../cpu-bench-page.ts';

/**
 * Measure what CDP CPU throttling actually achieves on this host.
 *
 * `Emulation.setCPUThrottlingRate` takes a requested multiplier, not a
 * guaranteed one: the achieved slowdown depends on the host CPU, the scheduler
 * and the workload. Choosing 4x because DevTools labels it "mid-tier mobile"
 * would be a guess. This sweeps requested rates against the fixed arithmetic
 * benchmark and reports the slowdown each actually produced, so the rates in
 * `profiles.ts` and docs/BUDGETS.md are measured numbers.
 *
 * Run with: pnpm calibrate:cpu
 */
const REQUESTED_RATES = [1, 2, 3, 4, 5, 6, 8] as const;
const PERCENT_COLUMN = 9;

interface RateResult {
  readonly requested: number;
  readonly medianMs: number;
  readonly achievedSlowdown: number;
}

async function measureRate(page: Page, requested: number): Promise<number> {
  await applyCpuThrottling(page, requested);
  return medianCpuBenchmark(page);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');
  await timeCpuBenchmark(page);

  const medians: { requested: number; medianMs: number }[] = [];
  for (const requested of REQUESTED_RATES) {
    medians.push({ requested, medianMs: await measureRate(page, requested) });
  }
  await browser.close();

  const baseline = medians[0]?.medianMs ?? Number.NaN;
  const results: RateResult[] = medians.map((m) => ({
    ...m,
    achievedSlowdown: m.medianMs / baseline,
  }));

  console.log('CPU throttling calibration');
  console.log(`  benchmark: ${String(CPU_BENCH_ITERATIONS)} LCG iterations`);
  console.log(
    `  sampling:  median of ${String(BENCH_SAMPLE_RUNS)}, after ${String(BENCH_WARMUP_RUNS)} warmup runs`,
  );
  console.log('');
  console.log('  requested  median ms  achieved');
  for (const result of results) {
    console.log(
      `  ${String(result.requested).padStart(PERCENT_COLUMN)}  ` +
        `${result.medianMs.toFixed(1).padStart(9)}  ${result.achievedSlowdown.toFixed(2).padStart(7)}x`,
    );
  }
  console.log('');
  console.log('Record the chosen rates in tools/audit/src/profiles.ts and docs/BUDGETS.md.');
}

await main();
