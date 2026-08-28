import type { BudgetScope } from '../profiles.ts';
import type { PhaseId } from '../phases.ts';
import type { ThrottleProbe } from './throttle.ts';

/** Units a budget can be expressed in. */
export const BUDGET_UNITS = ['ms', 'bytes', 'fps', 'ratio', 'count'] as const;

export type BudgetUnit = (typeof BUDGET_UNITS)[number];

/**
 * A single enforceable performance budget. Exactly one of `max` or `min` is
 * required; declaring both bounds a value on two sides and is also legal.
 */
export interface BudgetRule {
  readonly id: string;
  readonly description: string;
  readonly unit: BudgetUnit;
  readonly scope: BudgetScope;
  readonly max?: number | undefined;
  readonly min?: number | undefined;
  /** First phase at which a missing measurement is a failure, not a deferral. */
  readonly enforcedFrom: PhaseId;
  /** Provenance of the number, so nobody silently relaxes it. */
  readonly source: string;
}

export interface BudgetDocument {
  readonly currentPhase: PhaseId;
  readonly rules: readonly BudgetRule[];
}

/** One observed value for a budget rule, produced by a measuring harness. */
export interface Measurement {
  readonly id: string;
  readonly value: number;
  /** Free-form provenance, e.g. the test file or CI job that produced it. */
  readonly origin?: string | undefined;
  /** ISO timestamp stamped when the value was written to disk. */
  readonly recordedAt?: string | undefined;
  /**
   * Raw CPU throttling evidence from every page this value was sampled on.
   *
   * Required for any budget scoped to a throttled device profile. A
   * device-named budget measured on an unthrottled page carries no device
   * signal, and the absence of this field is what makes that detectable from
   * the artifact rather than from trusting the harness that wrote it.
   *
   * Samples, not a ratio. The harness reports what it observed and the gate
   * derives the slowdown itself; see `throttle.ts` for why the conclusion is
   * not the producer's to state. For a profile that requests no throttling
   * there is nothing to evidence, and such profiles are exempt.
   */
  readonly throttle?: readonly ThrottleProbe[] | undefined;
}

export const BUDGET_STATUSES = [
  'passed',
  'violated',
  'unmeasured',
  'unthrottled',
  'deferred',
] as const;

export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export interface BudgetResult {
  readonly rule: BudgetRule;
  readonly status: BudgetStatus;
  readonly value?: number | undefined;
  /** The measurement behind this result, so reports can show its provenance. */
  readonly measurement?: Measurement | undefined;
  /** Human-readable explanation, always present for non-passing statuses. */
  readonly detail: string;
}

export interface BudgetReport {
  readonly ok: boolean;
  readonly currentPhase: PhaseId;
  readonly results: readonly BudgetResult[];
  readonly counts: Readonly<Record<BudgetStatus, number>>;
}
