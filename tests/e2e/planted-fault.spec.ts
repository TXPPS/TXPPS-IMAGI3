import { COLD_LOAD_BUDGET_IDS, checkBudgets, type IncidentKind } from '@imagi3/audit';
import {
  PLANTED_CONSOLE_TEXT,
  PLANTED_REJECTION_TEXT,
  PLANTED_THROW_TEXT,
} from '../../apps/editor/src/dev/plant.ts';
import { READY_ATTRIBUTE, READY_MARK } from '../../apps/editor/src/constants.ts';
import { DEV_BASE_URL } from './config.ts';
import { loadBudgets } from './budget.ts';
import { judgeIncidents } from './incidents.ts';
import { expect, test } from './fixtures.ts';

/**
 * Phase 0 gate, browser half: the harness must catch faults planted in a real
 * running page, not only in unit fixtures. These tests deliberately provoke
 * failures, so they opt out of the automatic incident assertion and assert the
 * guard's verdict directly instead.
 */
test.use({ allowIncidents: true });

interface FaultCase {
  readonly kind: string;
  readonly expectedIncident: IncidentKind;
  readonly expectedText: string;
}

const FAULT_CASES: readonly FaultCase[] = [
  { kind: 'console-error', expectedIncident: 'console-error', expectedText: PLANTED_CONSOLE_TEXT },
  { kind: 'throw', expectedIncident: 'page-error', expectedText: PLANTED_THROW_TEXT },
  {
    kind: 'unhandled-rejection',
    expectedIncident: 'unhandled-rejection',
    expectedText: PLANTED_REJECTION_TEXT,
  },
];

test.describe('planted faults', () => {
  for (const faultCase of FAULT_CASES) {
    test(`console guard catches a planted ${faultCase.kind}`, async ({ page, incidents }) => {
      await page.goto(`${DEV_BASE_URL}/?plant=${faultCase.kind}`);
      await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
      await expect
        .poll(() => incidents.some((i) => i.text.includes(faultCase.expectedText)))
        .toBe(true);

      const report = judgeIncidents(incidents);
      expect(report.ok, 'the guard must reject a planted fault').toBe(false);
      expect(report.violations.map((v) => v.incident.kind)).toContain(faultCase.expectedIncident);
    });
  }

  test('budget gate catches a planted slow boot', async ({ page, profile, throttle }) => {
    await page.goto(`${DEV_BASE_URL}/?plant=slow-boot`);
    await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
    const elapsedMs = await page.evaluate((mark) => {
      const entry = performance.getEntriesByName(mark)[0];
      if (entry === undefined) throw new Error(`missing performance mark ${mark}`);
      return entry.startTime;
    }, READY_MARK);

    const budgetId = COLD_LOAD_BUDGET_IDS[profile.id];
    // The throttling evidence is required: the gate rejects a device-scoped
    // measurement that cannot show the page it came from was throttled.
    const report = checkBudgets(loadBudgets(), [
      { id: budgetId, value: elapsedMs, throttleRatio: throttle.observedRatio },
    ]);
    const result = report.results.find((r) => r.rule.id === budgetId);

    expect(
      result?.status,
      `slow boot took ${elapsedMs.toFixed(0)}ms and must breach the budget`,
    ).toBe('violated');

    // The clean counterpart. `report.ok` is NOT asserted here: checking a
    // single measurement leaves the other enforced budgets unmeasured, so the
    // report is not-ok regardless of the planted fault and asserting it would
    // pass no matter what. Re-checking the same rule with a plausible value is
    // what actually proves the checker responds to the value.
    const control = checkBudgets(loadBudgets(), [
      { id: budgetId, value: 25, throttleRatio: throttle.observedRatio },
    ]);
    expect(control.results.find((r) => r.rule.id === budgetId)?.status).toBe('passed');
  });

  test('a clean page passes the same guards it just failed', async ({ page, incidents }) => {
    await page.goto(`${DEV_BASE_URL}/`);
    await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
    expect(judgeIncidents(incidents).ok).toBe(true);
  });
});
