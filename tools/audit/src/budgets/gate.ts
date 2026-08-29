import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAllMeasurements } from '../measurements.ts';
import { formatBudgetReport } from '../report.ts';
import { BUDGETS_FILENAME } from '../repo-root.ts';
import { checkBudgets, findOrphanMeasurements } from './check.ts';
import { parseBudgetDocument } from './load.ts';

export const GATE_PASSED = 0;
export const GATE_FAILED = 1;

export interface GateOptions {
  readonly repoRoot: string;
  readonly measurementDir: string;
}

export interface GateOutcome {
  readonly exitCode: number;
  /** Lines to print, kept separate from printing so the gate is testable. */
  readonly lines: readonly string[];
}

/**
 * Run the repository-wide budget gate.
 *
 * Returns the exit code rather than setting it, so the contract CI depends on
 * — non-zero for a violation, a missing measurement, or an unknown measurement
 * id — is covered by `tools/audit/test/budgets/gate.test.ts` rather than only
 * by having been tried once by hand.
 */
export function runBudgetGate(options: GateOptions): GateOutcome {
  const document = parseBudgetDocument(
    JSON.parse(readFileSync(join(options.repoRoot, BUDGETS_FILENAME), 'utf8')),
  );
  const measurements = readAllMeasurements(options.measurementDir);
  const orphans = findOrphanMeasurements(document, measurements);
  const report = checkBudgets(document, measurements);

  const lines = [formatBudgetReport(report)];
  if (orphans.length > 0) {
    lines.push(
      '',
      `Unknown measurement ids reported by harnesses: ${orphans.join(', ')}`,
      'Every measurement must correspond to a declared budget rule.',
    );
  }

  return {
    exitCode: report.ok && orphans.length === 0 ? GATE_PASSED : GATE_FAILED,
    lines,
  };
}
