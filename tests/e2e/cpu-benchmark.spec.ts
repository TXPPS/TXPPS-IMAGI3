import { join } from 'node:path';
import { BENCHMARK_DIR, writeProfileBenchmark } from '@imagi3/audit';
import { medianCpuBenchmark } from '@imagi3/repo';
import { REPO_ROOT } from './config.ts';
import { expect, test } from './fixtures.ts';

/**
 * Records how long the fixed arithmetic benchmark takes under each profile's
 * CPU throttling. `pnpm audit:profile-ordering` then asserts the profiles come
 * out in the right order.
 *
 * This is not a performance budget. The absolute figure is host-dependent and
 * makes no claim about any real device; its only job is to prove throttling is
 * actually in effect, so that budgets named for a tablet and a phone mean
 * something.
 */
test.describe('cpu throttling', () => {
  test("records this profile's benchmark for the ordering check", async ({
    page,
    profile,
    incidents,
  }) => {
    await page.goto('/');
    const medianMs = await medianCpuBenchmark(page);

    writeProfileBenchmark(
      { profile: profile.id, medianMs, requestedRate: profile.cpuThrottlingRate },
      join(REPO_ROOT, BENCHMARK_DIR),
    );

    expect(incidents).toEqual([]);
    expect(medianMs).toBeGreaterThan(0);
  });
});
