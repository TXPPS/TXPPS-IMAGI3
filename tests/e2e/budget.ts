import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUDGETS_FILENAME,
  MEASUREMENT_DIR,
  parseBudgetDocument,
  writeMeasurements,
  type BudgetDocument,
  type BudgetRule,
  type Measurement,
} from '@imagi3/audit';
import { REPO_ROOT } from './config.ts';

export function loadBudgets(): BudgetDocument {
  return parseBudgetDocument(JSON.parse(readFileSync(join(REPO_ROOT, BUDGETS_FILENAME), 'utf8')));
}

export function ruleFor(id: string): BudgetRule {
  const rule = loadBudgets().rules.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new Error(`no budget rule declared for "${id}"`);
  return rule;
}

/** Record measurements where the repo-wide budget gate will collect them. */
export function recordMeasurements(harness: string, measurements: readonly Measurement[]): void {
  writeMeasurements(harness, measurements, join(REPO_ROOT, MEASUREMENT_DIR));
}
