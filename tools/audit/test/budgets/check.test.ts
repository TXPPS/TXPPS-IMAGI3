import { describe, expect, it } from 'vitest';
import { checkBudgets, findOrphanMeasurements } from '../../src/budgets/check.ts';
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
    expect(report.counts).toEqual({ passed: 1, violated: 1, unmeasured: 1, deferred: 1 });
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
