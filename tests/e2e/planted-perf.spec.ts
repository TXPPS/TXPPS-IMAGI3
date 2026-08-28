import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  COLD_LOAD_BUDGET_IDS,
  DEVICE_PROFILES,
  checkBudgets,
  type BudgetStatus,
  type DeviceProfileId,
} from '@imagi3/audit';
import { READY_ATTRIBUTE, READY_MARK } from '../../apps/editor/src/constants.ts';
import { loadBudgets, ruleFor } from './budget.ts';
import { DEV_BASE_URL } from './config.ts';
import { expect, test } from './fixtures.ts';
import {
  baselinePath,
  captureScreenshot,
  compareToBaseline,
  describeComparison,
} from './visual.ts';

/**
 * The P1-PRE exit proof.
 *
 * A budget named for a device is only worth having if it can fail for the
 * reason it names. At the end of P0 the tablet and phone profiles ran
 * unthrottled, so their budgets could only ever catch something the desktop
 * budget would catch first — the phone profile even measured *faster* than the
 * desktop one, because it was the same machine.
 *
 * This plants a fixed-work CPU regression and requires the outcome to differ by
 * profile: invisible to the unthrottled budget, caught by the throttled one.
 * If CPU throttling stops being applied, the tablet expectation below flips to
 * "passed" and this test fails.
 *
 * Fixed work, not a wall-clock stall, is essential. A `while (now < deadline)`
 * spin takes the same wall time however slow the CPU is, so it would breach
 * every profile equally and prove nothing about throttling.
 */
const TEST_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = 120_000;

/**
 * What the cold-load budget must say for each profile.
 *
 * The contrast between the first row and the rest is the entire proof.
 */
const EXPECTED_STATUS: Readonly<Record<DeviceProfileId, BudgetStatus>> = {
  desktop: 'passed',
  tablet: 'violated',
  phone: 'violated',
};

/**
 * The workload is computed from this host's measured speed, not fixed.
 *
 * A fixed iteration count is not portable. Sized on one machine it left about
 * 1.3x headroom under the unthrottled ceiling, so a runner a third slower would
 * flip the leg that is supposed to pass, and the proof would fail for a reason
 * unrelated to what it tests.
 *
 * The valid window is bounded below by the throttled ceiling divided by the
 * throttling rate — under that, the throttled legs stop breaching — and above
 * by the unthrottled ceiling. The target is the geometric middle, which leaves
 * equal proportional headroom on both sides.
 */
function ceilingFor(profileId: DeviceProfileId): number {
  const ceiling = ruleFor(COLD_LOAD_BUDGET_IDS[profileId]).max;
  if (ceiling === undefined) {
    throw new Error(`${COLD_LOAD_BUDGET_IDS[profileId]} declares no max to size against`);
  }
  return ceiling;
}

/**
 * Size the workload from the slowdown actually observed, not the nominal rate.
 *
 * Ceilings are read from budgets.json rather than restated, and the slowdown
 * comes from this run's measurement. Using the nominal rate where a measured
 * one is in hand left the tablet leg with 1.18x headroom on a run whose
 * achieved throttling was 2.75x rather than 4x — a guess with a table beside
 * it, which is the pattern this phase exists to remove.
 */
function targetWorkloadMs(observedTabletRatio: number): number {
  const unthrottledCeiling = ceilingFor('desktop');
  const throttledCeiling = ceilingFor('tablet');
  return Math.sqrt((throttledCeiling / observedTabletRatio) * unthrottledCeiling);
}

/**
 * The tablet's slowdown as seen from whichever profile is running.
 *
 * Every profile must plant the same workload for the contrast to mean
 * anything, so a profile that is not the tablet scales its own observation by
 * the ratio of the declared rates.
 */
function tabletRatioFrom(profileId: DeviceProfileId, observed: number): number {
  const own = DEVICE_PROFILES[profileId].cpuThrottlingRate;
  const tablet = DEVICE_PROFILES.tablet.cpuThrottlingRate;
  if (own <= 1) return tablet;
  return (observed * tablet) / own;
}

async function loadWith(page: Page, query: string): Promise<void> {
  await page.goto(`${DEV_BASE_URL}/${query}`);
  await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached({
    timeout: READY_TIMEOUT_MS,
  });
}

async function readReadyMs(page: Page): Promise<number> {
  return page.evaluate((mark) => {
    const entry = performance.getEntriesByName(mark)[0];
    if (entry === undefined) throw new Error(`missing performance mark ${mark}`);
    return entry.startTime;
  }, READY_MARK);
}

test.describe('planted CPU regression', () => {
  test.setTimeout(TEST_TIMEOUT_MS);

  test("is invisible unthrottled and caught under this profile's throttling", async ({
    page,
    profile,
    incidents,
    throttle,
  }) => {
    const tabletRatio = tabletRatioFrom(profile.id, throttle.observedRatio);
    const iterations = Math.round(targetWorkloadMs(tabletRatio) / throttle.msPerIteration);
    await loadWith(page, `?plant=cpu-regression&iterations=${String(iterations)}`);
    const elapsedMs = await readReadyMs(page);

    const budgetId = COLD_LOAD_BUDGET_IDS[profile.id];
    const report = checkBudgets(loadBudgets(), [
      { id: budgetId, value: elapsedMs, throttleRatio: throttle.observedRatio },
    ]);
    const status = report.results.find((r) => r.rule.id === budgetId)?.status;

    expect(
      status,
      `${profile.label} (CPU rate ${String(profile.cpuThrottlingRate)}x, measured ` +
        `${throttle.observedRatio.toFixed(2)}x) loaded in ${(elapsedMs / 1000).toFixed(2)}s ` +
        `against ${budgetId}, workload ${String(iterations)} iterations sized for ` +
        `${targetWorkloadMs(tabletRatio).toFixed(0)}ms unthrottled at an inferred ` +
        `tablet slowdown of ${tabletRatio.toFixed(2)}x`,
    ).toBe(EXPECTED_STATUS[profile.id]);

    // The regression is purely temporal, so no other detector should see it.
    expect(incidents, 'a CPU regression must not raise console incidents').toEqual([]);
  });

  test('is invisible to the screenshot comparator', async ({ page, profile, throttle }) => {
    const iterations = Math.round(
      targetWorkloadMs(tabletRatioFrom(profile.id, throttle.observedRatio)) /
        throttle.msPerIteration,
    );
    const path = baselinePath(mkdtempSync(join(tmpdir(), 'imagi3-perf-')), profile, 'clean');

    await loadWith(page, '');
    compareToBaseline(await captureScreenshot(page), path, { allowCreate: true });

    await loadWith(page, `?plant=cpu-regression&iterations=${String(iterations)}`);
    const outcome = compareToBaseline(await captureScreenshot(page), path);

    expect(outcome.status).toBe('compared');
    expect(
      outcome.comparison?.ok,
      `the visual gate must not be what catches a timing regression: ${describeComparison(
        outcome.comparison!,
      )}`,
    ).toBe(true);
  });
});
