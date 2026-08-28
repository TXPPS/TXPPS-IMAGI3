import { isPhaseAtLeast } from '../phases.ts';
import { DEVICE_PROFILES, isDeviceProfileId } from '../profiles.ts';
import { isCiHeadlessBudget } from './ids.ts';
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
 * Throttling a device-scoped budget must show to be worth having.
 *
 * Derived, not chosen. For a regression of unthrottled size W, the unthrottled
 * budget passes it when W is under that ceiling, and the throttled budget
 * catches it when W times the slowdown exceeds the throttled ceiling. A W
 * satisfying both exists only when the slowdown exceeds the ratio between the
 * two ceilings.
 *
 * With a 3000ms unthrottled ceiling and a 6000ms throttled one, that is 2.0x.
 * Below it the throttled budget is strictly dominated: it cannot fail for
 * anything the unthrottled budget would not have caught first, which is
 * ADR-0011's own disqualifying condition. A flat fraction of the *requested*
 * rate misses this — 0.4 of a requested 4x gives 1.6x, and runs recording 1.70x
 * and 1.79x passed while carrying no independent signal at all.
 */
const DEFAULT_MIN_THROTTLE_RATIO = 2;

function unthrottledCounterpart(
  rule: BudgetRule,
  rules: readonly BudgetRule[],
): number | undefined {
  const counterpart = rules.find(
    (candidate) =>
      isCiHeadlessBudget(candidate.id) &&
      candidate.unit === rule.unit &&
      candidate.max !== undefined,
  );
  return counterpart?.max;
}

/** The slowdown a rule's measurement must evidence for the rule to mean anything. */
export function requiredThrottleRatio(rule: BudgetRule, rules: readonly BudgetRule[]): number {
  const unthrottledCeiling = unthrottledCounterpart(rule, rules);
  if (unthrottledCeiling === undefined || rule.max === undefined || unthrottledCeiling <= 0) {
    return DEFAULT_MIN_THROTTLE_RATIO;
  }
  return Math.max(DEFAULT_MIN_THROTTLE_RATIO, rule.max / unthrottledCeiling);
}

/**
 * A device-scoped budget measured without throttling is not a lenient result,
 * it is a meaningless one — which is how an entire gate once shipped with every
 * device-named budget measured at full desktop speed while the throttling
 * self-test stayed green on a different page. See RC-0006.
 *
 * What this proves and what it does not: it proves the declared rate reached
 * the page that was measured. It cannot prove the declaration is meaningful —
 * a profile declaring rate 1 is exempt here, and is covered instead by the
 * naming-honesty test and the ordering gate. Nor can it distinguish a measured
 * ratio from a hand-written one; that is the floor of artifact checking.
 */
function checkThrottlingEvidence(
  rule: BudgetRule,
  measurement: Measurement,
  rules: readonly BudgetRule[],
): string | undefined {
  if (!isDeviceProfileId(rule.scope)) return undefined;
  const expected = DEVICE_PROFILES[rule.scope].cpuThrottlingRate;
  if (expected <= 1) return undefined;

  const required = requiredThrottleRatio(rule, rules);
  const observed = measurement.throttleRatio;
  if (observed === undefined) {
    return `scoped to ${rule.scope} (throttled ${String(expected)}x) but the measurement records no throttleRatio`;
  }
  if (!Number.isFinite(observed) || observed < required) {
    return (
      `measured at ${String(observed)}x CPU throttling, below the ${required.toFixed(2)}x this ` +
      `budget needs to catch anything the unthrottled budget would not catch first`
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
  const throttleProblem = checkThrottlingEvidence(rule, measurement, document.rules);
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
