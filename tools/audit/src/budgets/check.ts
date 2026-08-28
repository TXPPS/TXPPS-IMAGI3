import { isPhaseAtLeast } from '../phases.ts';
import {
  BUDGET_STATUSES,
  type BudgetDocument,
  type BudgetReport,
  type BudgetResult,
  type BudgetRule,
  type BudgetStatus,
  type Measurement,
} from './types.ts';

function formatValue(value: number, rule: BudgetRule): string {
  return `${String(value)}${rule.unit === 'ratio' ? '' : ` ${rule.unit}`}`;
}

function evaluateBounds(rule: BudgetRule, value: number): BudgetResult {
  if (rule.max !== undefined && value > rule.max) {
    return {
      rule,
      status: 'violated',
      value,
      detail: `${formatValue(value, rule)} exceeds max ${formatValue(rule.max, rule)}`,
    };
  }
  if (rule.min !== undefined && value < rule.min) {
    return {
      rule,
      status: 'violated',
      value,
      detail: `${formatValue(value, rule)} is below min ${formatValue(rule.min, rule)}`,
    };
  }
  return { rule, status: 'passed', value, detail: `${formatValue(value, rule)} within budget` };
}

function evaluateRule(
  rule: BudgetRule,
  document: BudgetDocument,
  byId: ReadonlyMap<string, Measurement>,
): BudgetResult {
  if (!isPhaseAtLeast(document.currentPhase, rule.enforcedFrom)) {
    return {
      rule,
      status: 'deferred',
      value: undefined,
      detail: `not enforced until ${rule.enforcedFrom} (current ${document.currentPhase})`,
    };
  }

  const measurement = byId.get(rule.id);
  if (measurement === undefined) {
    return {
      rule,
      status: 'unmeasured',
      value: undefined,
      detail: `enforced from ${rule.enforcedFrom} but no harness reported a value`,
    };
  }
  if (!Number.isFinite(measurement.value)) {
    return {
      rule,
      status: 'unmeasured',
      value: undefined,
      detail: `harness reported a non-finite value (${String(measurement.value)})`,
    };
  }
  return evaluateBounds(rule, measurement.value);
}

function countStatuses(results: readonly BudgetResult[]): Record<BudgetStatus, number> {
  const counts = Object.fromEntries(BUDGET_STATUSES.map((s) => [s, 0])) as Record<
    BudgetStatus,
    number
  >;
  for (const result of results) counts[result.status] += 1;
  return counts;
}

/**
 * Compare measurements against the budget document.
 *
 * A budget that is enforced in the current phase but has no measurement counts
 * as a failure: the harness must never report green for something it did not
 * actually measure.
 */
export function checkBudgets(
  document: BudgetDocument,
  measurements: readonly Measurement[],
): BudgetReport {
  const byId = new Map(measurements.map((m) => [m.id, m]));
  const results = document.rules.map((rule) => evaluateRule(rule, document, byId));
  const counts = countStatuses(results);
  return {
    ok: counts.violated === 0 && counts.unmeasured === 0,
    currentPhase: document.currentPhase,
    results,
    counts,
  };
}

/** Measurement ids that do not correspond to any declared rule. */
export function findOrphanMeasurements(
  document: BudgetDocument,
  measurements: readonly Measurement[],
): readonly string[] {
  const known = new Set(document.rules.map((r) => r.id));
  return measurements.filter((m) => !known.has(m.id)).map((m) => m.id);
}
