import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  COLD_LOAD_BUDGET_IDS,
  checkBudgets,
  type BudgetStatus,
  type DeviceProfileId,
} from '@imagi3/audit';
import { READY_ATTRIBUTE, READY_MARK } from '../../apps/editor/src/constants.ts';
import { loadBudgets } from './budget.ts';
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
  }) => {
    await loadWith(page, '?plant=cpu-regression');
    const elapsedMs = await readReadyMs(page);

    const budgetId = COLD_LOAD_BUDGET_IDS[profile.id];
    const report = checkBudgets(loadBudgets(), [{ id: budgetId, value: elapsedMs }]);
    const status = report.results.find((r) => r.rule.id === budgetId)?.status;

    expect(
      status,
      `${profile.label} (CPU rate ${String(profile.cpuThrottlingRate)}x) loaded in ` +
        `${(elapsedMs / 1000).toFixed(2)}s against ${budgetId}`,
    ).toBe(EXPECTED_STATUS[profile.id]);

    // The regression is purely temporal, so no other detector should see it.
    expect(incidents, 'a CPU regression must not raise console incidents').toEqual([]);
  });

  test('is invisible to the screenshot comparator', async ({ page, profile }) => {
    const path = baselinePath(mkdtempSync(join(tmpdir(), 'imagi3-perf-')), profile, 'clean');

    await loadWith(page, '');
    compareToBaseline(await captureScreenshot(page), path, { allowCreate: true });

    await loadWith(page, '?plant=cpu-regression');
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
