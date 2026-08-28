import { isPhaseAtLeast } from '../phases.ts';
import { DEVICE_PROFILES, isDeviceProfileId } from '../profiles.ts';
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

/**
 * Fraction of a profile's requested throttling a measurement must show.
 *
 * Matches the presence-check threshold the browser harness applies. This is
 * the artifact-level half of the same guarantee: the harness proves throttling
 * on the page, and this proves the recorded number came from such a page.
 */
const MIN_RECORDED_THROTTLE_FRACTION = 0.4;

/**
 * A device-scoped budget measured without throttling is not a lenient result,
 * it is a meaningless one — which is how an entire gate once shipped with every
 * device-named budget measured at full desktop speed while the throttling
 * self-test stayed green on a different page. See RC-0006.
 */
function checkThrottlingEvidence(rule: BudgetRule, measurement: Measurement): string | undefined {
  if (!isDeviceProfileId(rule.scope)) return undefined;
  const expected = DEVICE_PROFILES[rule.scope].cpuThrottlingRate;
  if (expected <= 1) return undefined;

  const required = expected * MIN_RECORDED_THROTTLE_FRACTION;
  const observed = measurement.throttleRatio;
  if (observed === undefined) {
    return `scoped to ${rule.scope} (throttled ${String(expected)}x) but the measurement records no throttleRatio`;
  }
  if (!Number.isFinite(observed) || observed < required) {
    return (
      `measured at ${String(observed)}x CPU throttling, below the ${required.toFixed(2)}x ` +
      `required for a budget scoped to ${rule.scope}`
    );
  }
  return undefined;
}

function evaluateBounds(rule: BudgetRule, measurement: Measurement): BudgetResult {
  const value = measurement.value;
  const base = { rule, value, measurement } as const;
  if (rule.max !== undefined && value > rule.max) {
    return {
      ...base,
      status: 'violated',
      detail: `${formatValue(value, rule)} exceeds max ${formatValue(rule.max, rule)}`,
    };
  }
  if (rule.min !== undefined && value < rule.min) {
    return {
      ...base,
      status: 'violated',
      detail: `${formatValue(value, rule)} is below min ${formatValue(rule.min, rule)}`,
    };
  }
  return { ...base, status: 'passed', detail: `${formatValue(value, rule)} within budget` };
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
      measurement: undefined,
      detail: `not enforced until ${rule.enforcedFrom} (current ${document.currentPhase})`,
    };
  }

  const measurement = byId.get(rule.id);
  if (measurement === undefined) {
    return {
      rule,
      status: 'unmeasured',
      value: undefined,
      measurement: undefined,
      detail: `enforced from ${rule.enforcedFrom} but no harness reported a value`,
    };
  }
  if (!Number.isFinite(measurement.value)) {
    return {
      rule,
      status: 'unmeasured',
      value: undefined,
      measurement,
      detail: `harness reported a non-finite value (${String(measurement.value)})`,
    };
  }
  const throttleProblem = checkThrottlingEvidence(rule, measurement);
  if (throttleProblem !== undefined) {
    return {
      rule,
      status: 'unthrottled',
      value: measurement.value,
      measurement,
      detail: throttleProblem,
    };
  }
  return evaluateBounds(rule, measurement);
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
    ok: counts.violated === 0 && counts.unmeasured === 0 && counts.unthrottled === 0,
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
