import { describe, expect, it } from 'vitest';
import { BudgetConfigError, parseBudgetDocument } from '../../src/budgets/load.ts';

const VALID_RULE = {
  id: 'demo.rule',
  description: 'A rule',
  unit: 'ms',
  scope: 'desktop',
  max: 100,
  enforcedFrom: 'P0',
  source: 'test',
};

function doc(overrides: Record<string, unknown> = {}): unknown {
  return { currentPhase: 'P0', rules: [VALID_RULE], ...overrides };
}

describe('parseBudgetDocument', () => {
  it('accepts a well-formed document', () => {
    const parsed = parseBudgetDocument(doc());
    expect(parsed.currentPhase).toBe('P0');
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0]!.max).toBe(100);
    expect(parsed.rules[0]!.min).toBeUndefined();
  });

  it.each([
    ['not an object', 42],
    ['missing currentPhase', { rules: [VALID_RULE] }],
    ['unknown phase', doc({ currentPhase: 'P99' })],
    ['rules not an array', doc({ rules: {} })],
    ['empty rules', doc({ rules: [] })],
    ['rule without bounds', doc({ rules: [{ ...VALID_RULE, max: undefined }] })],
    ['min above max', doc({ rules: [{ ...VALID_RULE, min: 500 }] })],
    ['unknown unit', doc({ rules: [{ ...VALID_RULE, unit: 'furlongs' }] })],
    ['unknown scope', doc({ rules: [{ ...VALID_RULE, scope: 'watch' }] })],
    ['non-finite max', doc({ rules: [{ ...VALID_RULE, max: Number.POSITIVE_INFINITY }] })],
    ['empty id', doc({ rules: [{ ...VALID_RULE, id: '' }] })],
    ['missing source', doc({ rules: [{ ...VALID_RULE, source: undefined }] })],
    ['duplicate ids', doc({ rules: [VALID_RULE, VALID_RULE] })],
  ])('rejects %s', (_label, input) => {
    expect(() => parseBudgetDocument(input)).toThrow(BudgetConfigError);
  });

  it('names the offending field in the error message', () => {
    expect(() =>
      parseBudgetDocument(doc({ rules: [{ ...VALID_RULE, unit: 'furlongs' }] })),
    ).toThrow(/rules\[0\]\.unit "furlongs"/);
  });
});
