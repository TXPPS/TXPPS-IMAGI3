import type { Page } from '@playwright/test';
import { READY_ATTRIBUTE, READY_MARK } from '../../apps/editor/src/constants.ts';
import { recordMeasurements, ruleFor } from './budget.ts';
import { expect, test } from './fixtures.ts';

/**
 * Cold load is measured on the second navigation so the HTTP cache is warm,
 * which is the condition docs/BUDGETS.md states the ceiling applies to.
 */
async function measureWarmCacheReadyMs(page: Page): Promise<number> {
  await page.goto('/');
  await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
  await page.reload();
  await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
  return page.evaluate((mark) => {
    const entry = performance.getEntriesByName(mark)[0];
    if (entry === undefined) throw new Error(`missing performance mark ${mark}`);
    return entry.startTime;
  }, READY_MARK);
}

test.describe('cold load', () => {
  test('stays within the declared budget and records the measurement', async ({
    page,
    profile,
    incidents,
  }) => {
    const elapsedMs = await measureWarmCacheReadyMs(page);
    const budgetId = `editor.coldLoad.${profile.id}`;
    const rule = ruleFor(budgetId);

    recordMeasurements(`cold-load-${profile.id}`, [
      { id: budgetId, value: elapsedMs, origin: 'tests/e2e/cold-load.spec.ts' },
    ]);

    expect(incidents).toEqual([]);
    expect(elapsedMs).toBeGreaterThan(0);
    expect(
      elapsedMs,
      `${profile.label} cold load ${elapsedMs.toFixed(1)}ms exceeds the ${String(rule.max)}ms budget`,
    ).toBeLessThanOrEqual(rule.max ?? Number.POSITIVE_INFINITY);
  });
});
