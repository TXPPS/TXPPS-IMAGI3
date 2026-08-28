import { isPhaseAtLeast } from '../phases.ts';
import { DEVICE_PROFILES, isDeviceProfileId } from '../profiles.ts';
import { isCiHeadlessBudget } from './ids.ts';
import { firstProbeFault, observedThrottleRatio } from './throttle.ts';
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
  const counterparts = rules.filter(
    (candidate) =>
      isCiHeadlessBudget(candidate.id) &&
      candidate.unit === rule.unit &&
      candidate.max !== undefined,
  );
  // Exactly one, or the pairing is a guess. With two ci-headless budgets in the
  // same unit, `find` would silently pair every device budget to whichever came
  // first in the file, and the derived floor would be quietly wrong.
  if (counterparts.length !== 1) return undefined;
  return counterparts[0]?.max;
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
 * The slowdown is **derived here from raw samples**, never read from the
 * measurement. A harness that reports a conclusion instead of observations is
 * attesting its own work, which is the failure this whole mechanism exists to
 * make impossible; a measurement carrying a number but no samples has no
 * evidence at all and lands on `unthrottled`.
 *
 * What this proves and what it does not: it proves that the workload named by
 * the probe really ran, that it ran long enough to span CDP's sleep cycles, and
 * that the same workload on the same page in the same run was slower with
 * throttling on than off. It cannot prove the declaration is meaningful — a
 * profile declaring rate 1 is exempt here, and is covered instead by the
 * naming-honesty test and the ordering gate. Nor can it stop a harness that
 * computes plausible timings without running anything; nothing in a file can
 * attest itself, and that limit is stated rather than papered over.
 */
function checkThrottlingEvidence(
  rule: BudgetRule,
  measurement: Measurement,
  rules: readonly BudgetRule[],
): string | undefined {
  if (!isDeviceProfileId(rule.scope)) return undefined;
  const expected = DEVICE_PROFILES[rule.scope].cpuThrottlingRate;
  if (expected <= 1) return undefined;

  const probes = measurement.throttle;
  if (probes === undefined || probes.length === 0) {
    return (
      `scoped to ${rule.scope} (throttled ${String(expected)}x) but the measurement carries ` +
      'no throttling probe, so nothing evidences the rate reaching the page it was measured on'
    );
  }
  const mismatched = probes.find((probe) => probe.requestedRate !== expected);
  if (mismatched !== undefined) {
    return (
      `probed at rate ${String(mismatched.requestedRate)} but the ${rule.scope} profile ` +
      `declares ${String(expected)}`
    );
  }
  const fault = firstProbeFault(probes);
  if (fault !== undefined) return `throttling probe is not usable evidence: ${fault}`;

  const required = requiredThrottleRatio(rule, rules);
  const observed = observedThrottleRatio(probes);
  if (!Number.isFinite(observed) || observed < required) {
    return (
      `${String(probes.length)} probe${probes.length === 1 ? '' : 's'} evidence ` +
      `${observed.toFixed(2)}x CPU throttling, below the ${required.toFixed(2)}x this ` +
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
