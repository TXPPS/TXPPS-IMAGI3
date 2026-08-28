import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATE_FAILED, GATE_PASSED, runBudgetGate } from '../../src/budgets/gate.ts';
import type { Measurement } from '../../src/budgets/types.ts';

const RULE = {
  id: 'demo.latency',
  description: 'Demo latency budget',
  unit: 'ms',
  scope: 'all',
  max: 100,
  min: 1,
  enforcedFrom: 'P0',
  source: 'gate-test',
};

/**
 * The exit contract this covers is what makes the budget step in CI blocking.
 * Without it, deleting the exit code entirely leaves every suite green while
 * the gate silently stops failing builds.
 */
function fixture(
  measurements: readonly Measurement[],
  rules: unknown[] = [RULE],
): {
  repoRoot: string;
  measurementDir: string;
} {
  const repoRoot = mkdtempSync(join(tmpdir(), 'imagi3-gate-'));
  writeFileSync(join(repoRoot, 'budgets.json'), JSON.stringify({ currentPhase: 'P0', rules }));
  const measurementDir = join(repoRoot, 'measurements');
  mkdirSync(measurementDir, { recursive: true });
  writeFileSync(join(measurementDir, 'harness.measurements.json'), JSON.stringify(measurements));
  return { repoRoot, measurementDir };
}

describe('runBudgetGate', () => {
  it('passes and reports zero when every enforced budget is measured and within bounds', () => {
    const outcome = runBudgetGate(fixture([{ id: 'demo.latency', value: 50 }]));
    expect(outcome.exitCode).toBe(GATE_PASSED);
    expect(outcome.lines.join('\n')).toContain('BUDGETS OK');
  });

  it('fails when a measurement exceeds its ceiling', () => {
    const outcome = runBudgetGate(fixture([{ id: 'demo.latency', value: 500 }]));
    expect(outcome.exitCode).toBe(GATE_FAILED);
    expect(outcome.lines.join('\n')).toContain('BUDGETS FAILED');
  });

  it('fails when a measurement falls below its plausibility floor', () => {
    expect(runBudgetGate(fixture([{ id: 'demo.latency', value: 0 }])).exitCode).toBe(GATE_FAILED);
  });

  it('fails when an enforced budget was never measured', () => {
    const outcome = runBudgetGate(fixture([]));
    expect(outcome.exitCode).toBe(GATE_FAILED);
    expect(outcome.lines.join('\n')).toContain('no harness reported a value');
  });

  it('fails when a harness reports an id no rule declares', () => {
    const outcome = runBudgetGate(
      fixture([
        { id: 'demo.latency', value: 50 },
        { id: 'demo.renamed', value: 50 },
      ]),
    );
    expect(outcome.exitCode).toBe(GATE_FAILED);
    expect(outcome.lines.join('\n')).toContain('demo.renamed');
  });

  it('passes when every rule is deferred to a later phase', () => {
    const outcome = runBudgetGate(fixture([], [{ ...RULE, enforcedFrom: 'P9' }]));
    expect(outcome.exitCode).toBe(GATE_PASSED);
    expect(outcome.lines.join('\n')).toContain('not enforced until P9');
  });

  it('surfaces measurement provenance in its output', () => {
    const outcome = runBudgetGate(
      fixture([
        {
          id: 'demo.latency',
          value: 50,
          origin: 'spec.ts',
          recordedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    );
    expect(outcome.lines.join('\n')).toContain('via spec.ts at 2026-01-01T00:00:00.000Z');
  });

  it('rejects a malformed budgets file rather than passing by default', () => {
    expect(() =>
      runBudgetGate(fixture([], [{ ...RULE, max: undefined, min: undefined }])),
    ).toThrow();
  });
});
