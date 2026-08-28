import { describe, expect, it } from 'vitest';
import { checkBudgets } from '../src/budgets/check.ts';
import type { BudgetDocument, BudgetRule } from '../src/budgets/types.ts';
import { formatBudgetReport } from '../src/report.ts';

function rule(overrides: Partial<BudgetRule> = {}): BudgetRule {
  return {
    id: 'demo.rule',
    description: 'A rule',
    unit: 'ms',
    scope: 'all',
    max: 100,
    min: undefined,
    enforcedFrom: 'P0',
    source: 'report-test',
    ...overrides,
  };
}

const DOC: BudgetDocument = { currentPhase: 'P0', rules: [rule()] };

describe('formatBudgetReport', () => {
  it('says OK only when the report is ok', () => {
    const text = formatBudgetReport(checkBudgets(DOC, [{ id: 'demo.rule', value: 1 }]));
    expect(text).toContain('BUDGETS OK');
    expect(text).not.toContain('BUDGETS FAILED');
  });

  it('says FAILED when a budget is violated', () => {
    const text = formatBudgetReport(checkBudgets(DOC, [{ id: 'demo.rule', value: 999 }]));
    expect(text).toContain('BUDGETS FAILED');
    expect(text).not.toContain('BUDGETS OK');
  });

  it('says FAILED when a budget is merely unmeasured', () => {
    expect(formatBudgetReport(checkBudgets(DOC, []))).toContain('BUDGETS FAILED');
  });

  it('counts every status in the summary', () => {
    const doc: BudgetDocument = {
      currentPhase: 'P0',
      rules: [
        rule({ id: 'a' }),
        rule({ id: 'b' }),
        rule({ id: 'c' }),
        rule({ id: 'd', enforcedFrom: 'P9' }),
      ],
    };
    const text = formatBudgetReport(
      checkBudgets(doc, [
        { id: 'a', value: 1 },
        { id: 'b', value: 999 },
      ]),
    );
    expect(text).toContain('1 passed');
    expect(text).toContain('1 violated');
    expect(text).toContain('1 unmeasured');
    expect(text).toContain('1 deferred');
  });

  it('names the phase and every rule', () => {
    const text = formatBudgetReport(checkBudgets(DOC, [{ id: 'demo.rule', value: 1 }]));
    expect(text).toContain('phase P0');
    expect(text).toContain('demo.rule');
  });

  it('shows provenance for measured rules and omits it otherwise', () => {
    const measured = formatBudgetReport(
      checkBudgets(DOC, [
        { id: 'demo.rule', value: 1, origin: 'harness.ts', recordedAt: '2026-05-05T00:00:00.000Z' },
      ]),
    );
    expect(measured).toContain('via harness.ts at 2026-05-05T00:00:00.000Z');
    expect(formatBudgetReport(checkBudgets(DOC, []))).not.toContain('via ');
  });
});
