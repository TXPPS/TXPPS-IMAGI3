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
 * Fraction of the unthrottled ceiling the workload may occupy.
 *
 * The unthrottled leg has to pass, so it needs real headroom under its own
 * ceiling; an unclamped target reached 2.57s against 3000ms in one run, a 1.17x
 * margin, and the sizing formula could emit 3144ms — above the very ceiling it
 * exists to stay under.
 */
const MAX_CEILING_FRACTION = 0.65;

/**
 * Size the workload from the host's measured speed and the declared rate.
 *
 * Every profile must plant the *same* workload or the contrast means nothing,
 * so the ratio in this formula has to be one all profiles agree on: the
 * declared tablet rate. An earlier version inferred it from each profile's own
 * observation, which is measured but not shared — the phone inferring a tablet
 * slowdown of 1.82x produced a target above the unthrottled ceiling.
 *
 * What is measured, and what makes this host-portable, is `msPerIteration`:
 * the conversion from milliseconds to work. The clamp covers the rest.
 */
function targetWorkloadMs(): number {
  const unthrottledCeiling = ceilingFor('desktop');
  const throttledCeiling = ceilingFor('tablet');
  const ideal = Math.sqrt(
    (throttledCeiling / DEVICE_PROFILES.tablet.cpuThrottlingRate) * unthrottledCeiling,
  );
  return Math.min(ideal, unthrottledCeiling * MAX_CEILING_FRACTION);
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
    const iterations = Math.round(targetWorkloadMs() / throttle.msPerIteration);
    await loadWith(page, `?plant=cpu-regression&iterations=${String(iterations)}`);
    const elapsedMs = await readReadyMs(page);

    const budgetId = COLD_LOAD_BUDGET_IDS[profile.id];
    const report = checkBudgets(loadBudgets(), [
      { id: budgetId, value: elapsedMs, throttle: [throttle.probe] },
    ]);
    const status = report.results.find((r) => r.rule.id === budgetId)?.status;

    expect(
      status,
      `${profile.label} (CPU rate ${String(profile.cpuThrottlingRate)}x, measured ` +
        `${throttle.observedRatio.toFixed(2)}x) loaded in ${(elapsedMs / 1000).toFixed(2)}s ` +
        `against ${budgetId}, workload ${String(iterations)} iterations sized for ` +
        `${targetWorkloadMs().toFixed(0)}ms unthrottled on this host`,
    ).toBe(EXPECTED_STATUS[profile.id]);

    // The regression is purely temporal, so no other detector should see it.
    expect(incidents, 'a CPU regression must not raise console incidents').toEqual([]);
  });

  test('is invisible to the screenshot comparator', async ({ page, profile, throttle }) => {
    const iterations = Math.round(targetWorkloadMs() / throttle.msPerIteration);
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
