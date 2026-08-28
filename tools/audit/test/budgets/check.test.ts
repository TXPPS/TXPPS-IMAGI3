import { describe, expect, it } from 'vitest';
import {
  checkBudgets,
  findOrphanMeasurements,
  requiredThrottleRatio,
} from '../../src/budgets/check.ts';
import type { BudgetDocument, BudgetRule } from '../../src/budgets/types.ts';

function rule(overrides: Partial<BudgetRule> = {}): BudgetRule {
  return {
    id: 'demo.rule',
    description: 'A rule',
    unit: 'ms',
    scope: 'all',
    max: 100,
    min: undefined,
    enforcedFrom: 'P0',
    source: 'test',
    ...overrides,
  };
}

function document(rules: BudgetRule[], currentPhase: BudgetDocument['currentPhase'] = 'P0') {
  return { currentPhase, rules };
}

describe('checkBudgets', () => {
  it('passes a measurement inside a max bound', () => {
    const report = checkBudgets(document([rule()]), [{ id: 'demo.rule', value: 99 }]);
    expect(report.ok).toBe(true);
    expect(report.results[0]!.status).toBe('passed');
  });

  it('passes a measurement exactly on the bound', () => {
    const report = checkBudgets(document([rule()]), [{ id: 'demo.rule', value: 100 }]);
    expect(report.results[0]!.status).toBe('passed');
  });

  it('violates a measurement above a max bound', () => {
    const report = checkBudgets(document([rule()]), [{ id: 'demo.rule', value: 101 }]);
    expect(report.ok).toBe(false);
    expect(report.results[0]!.status).toBe('violated');
    expect(report.results[0]!.detail).toContain('exceeds max');
  });

  it('violates a measurement below a min bound', () => {
    const fpsRule = rule({ unit: 'fps', max: undefined, min: 60 });
    const report = checkBudgets(document([fpsRule]), [{ id: 'demo.rule', value: 59 }]);
    expect(report.ok).toBe(false);
    expect(report.results[0]!.detail).toContain('below min');
  });

  it('fails an enforced rule that nobody measured', () => {
    const report = checkBudgets(document([rule()]), []);
    expect(report.ok).toBe(false);
    expect(report.results[0]!.status).toBe('unmeasured');
  });

  it('defers a rule whose phase has not arrived, without failing', () => {
    const report = checkBudgets(document([rule({ enforcedFrom: 'P6' })]), []);
    expect(report.ok).toBe(true);
    expect(report.results[0]!.status).toBe('deferred');
  });

  it('enforces a deferred rule once the phase catches up', () => {
    const report = checkBudgets(document([rule({ enforcedFrom: 'P6' })], 'P6'), []);
    expect(report.ok).toBe(false);
    expect(report.results[0]!.status).toBe('unmeasured');
  });

  it('treats a non-finite measurement as unmeasured rather than passing', () => {
    const report = checkBudgets(document([rule()]), [{ id: 'demo.rule', value: Number.NaN }]);
    expect(report.ok).toBe(false);
    expect(report.results[0]!.status).toBe('unmeasured');
  });

  it('counts every status', () => {
    const report = checkBudgets(
      document([
        rule({ id: 'a' }),
        rule({ id: 'b' }),
        rule({ id: 'c' }),
        rule({ id: 'd', enforcedFrom: 'P9' }),
      ]),
      [
        { id: 'a', value: 1 },
        { id: 'b', value: 1000 },
      ],
    );
    expect(report.counts).toEqual({
      passed: 1,
      violated: 1,
      unmeasured: 1,
      unthrottled: 0,
      deferred: 1,
    });
  });
});

describe('findOrphanMeasurements', () => {
  it('reports measurements with no matching rule', () => {
    const orphans = findOrphanMeasurements(document([rule({ id: 'known' })]), [
      { id: 'known', value: 1 },
      { id: 'ghost', value: 2 },
    ]);
    expect(orphans).toEqual(['ghost']);
  });
});

/**
 * A device-scoped budget measured on an unthrottled page is not a lenient
 * result, it is a meaningless one. This is the artifact-level half of the
 * guarantee: the browser harness proves throttling on the page, and the gate
 * proves the recorded number came from such a page.
 *
 * Without it, RC-0006 was invisible — every device-named budget was measured at
 * full desktop speed while the throttling self-test stayed green, because the
 * self-test ran on a different page.
 */
describe('throttling evidence', () => {
  const tabletRule = rule({ id: 'demo.tablet', scope: 'tablet' });
  const doc = document([tabletRule]);

  it('accepts a device-scoped measurement carrying adequate throttling', () => {
    const report = checkBudgets(doc, [{ id: 'demo.tablet', value: 50, throttleRatio: 3.7 }]);
    expect(report.results[0]!.status).toBe('passed');
    expect(report.ok).toBe(true);
  });

  it('rejects a device-scoped measurement with no throttling record at all', () => {
    const report = checkBudgets(doc, [{ id: 'demo.tablet', value: 50 }]);
    expect(report.results[0]!.status).toBe('unthrottled');
    expect(report.results[0]!.detail).toContain('records no throttleRatio');
    expect(report.ok).toBe(false);
  });

  it('rejects a device-scoped measurement taken at desktop speed', () => {
    const report = checkBudgets(doc, [{ id: 'demo.tablet', value: 50, throttleRatio: 1 }]);
    expect(report.results[0]!.status).toBe('unthrottled');
    expect(report.ok).toBe(false);
  });

  it('rejects a non-finite throttling record', () => {
    const report = checkBudgets(doc, [{ id: 'demo.tablet', value: 50, throttleRatio: Number.NaN }]);
    expect(report.results[0]!.status).toBe('unthrottled');
  });

  it('does not demand throttling evidence from an unthrottled scope', () => {
    const desktop = document([rule({ id: 'demo.desktop', scope: 'desktop' })]);
    expect(checkBudgets(desktop, [{ id: 'demo.desktop', value: 50 }]).ok).toBe(true);
  });

  it('does not demand throttling evidence from a device-independent budget', () => {
    const anywhere = document([rule({ id: 'demo.all', scope: 'all' })]);
    expect(checkBudgets(anywhere, [{ id: 'demo.all', value: 50 }]).ok).toBe(true);
  });

  it('reports an unthrottled measurement as failing, not merely as a note', () => {
    const report = checkBudgets(doc, [{ id: 'demo.tablet', value: 50 }]);
    expect(report.counts.unthrottled).toBe(1);
    expect(report.counts.passed).toBe(0);
  });
});

/**
 * The floor is derived, not chosen, and the derivation is the argument:
 * a throttled budget can only catch something the unthrottled budget misses
 * when the slowdown exceeds the ratio between their ceilings. Below that it is
 * strictly dominated, which is ADR-0011's disqualifying condition.
 */
describe('requiredThrottleRatio', () => {
  const unthrottled = rule({
    id: 'ci-headless.demo',
    scope: 'desktop',
    max: 3000,
    unit: 'ms',
  });

  it('derives the floor from the ratio between the two ceilings', () => {
    const throttled = rule({ id: 'demo.tablet', scope: 'tablet', max: 9000, unit: 'ms' });
    expect(requiredThrottleRatio(throttled, [unthrottled, throttled])).toBe(3);
  });

  it('never falls below the point where the budget stops being able to fail', () => {
    // A throttled ceiling equal to the unthrottled one would derive 1.0x, at
    // which the budget can catch nothing the unthrottled one misses.
    const throttled = rule({ id: 'demo.tablet', scope: 'tablet', max: 3000, unit: 'ms' });
    expect(requiredThrottleRatio(throttled, [unthrottled, throttled])).toBe(2);
  });

  it('falls back to the default when there is no unthrottled counterpart', () => {
    const throttled = rule({ id: 'demo.tablet', scope: 'tablet', max: 6000, unit: 'ms' });
    expect(requiredThrottleRatio(throttled, [throttled])).toBe(2);
  });

  it('matches the committed budgets: 6000ms over 3000ms is 2.0x', () => {
    const throttled = rule({ id: 'demo.tablet', scope: 'tablet', max: 6000, unit: 'ms' });
    expect(requiredThrottleRatio(throttled, [unthrottled, throttled])).toBe(2);
  });

  it('rejects a ratio a flat fraction of the requested rate would have accepted', () => {
    // 0.4 of a requested 4x gave 1.6x, and runs recording 1.70x and 1.79x
    // passed while carrying no independent signal at all.
    const throttled = rule({ id: 'demo.tablet', scope: 'tablet', max: 6000, unit: 'ms' });
    const doc = { currentPhase: 'P0' as const, rules: [unthrottled, throttled] };
    const report = checkBudgets(doc, [
      { id: 'ci-headless.demo', value: 100 },
      { id: 'demo.tablet', value: 100, throttleRatio: 1.79 },
    ]);
    expect(report.results.find((r) => r.rule.id === 'demo.tablet')?.status).toBe('unthrottled');
  });

  it('accepts a ratio at the derived floor', () => {
    const throttled = rule({ id: 'demo.tablet', scope: 'tablet', max: 6000, unit: 'ms' });
    const doc = { currentPhase: 'P0' as const, rules: [unthrottled, throttled] };
    const report = checkBudgets(doc, [
      { id: 'ci-headless.demo', value: 100 },
      { id: 'demo.tablet', value: 100, throttleRatio: 2 },
    ]);
    expect(report.results.find((r) => r.rule.id === 'demo.tablet')?.status).toBe('passed');
  });
});
