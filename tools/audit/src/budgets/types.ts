import type { BudgetScope } from '../profiles.ts';
import type { PhaseId } from '../phases.ts';

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
   * CPU slowdown observed on the page that produced this value.
   *
   * Required for any budget scoped to a throttled device profile. A
   * device-named budget measured on an unthrottled page carries no device
   * signal, and the absence of this field is what makes that detectable from
   * the artifact rather than from trusting the harness that wrote it.
   *
   * For a profile that requests no throttling this is 1 by construction rather
   * than by a second measurement, and such profiles are exempt from the check.
   *
   * The limit of this field, stated so it is not mistaken for more: it is a
   * recorded number compared against a declared rate, so it cannot distinguish
   * a genuinely measured 4.2x from a hand-written one. That is the floor of
   * artifact-level checking — a number in a file cannot attest itself. What it
   * does buy is that the failure it exists to catch is no longer a single
   * plausible omission; forging it takes deliberate edits in three files.
   */
  readonly throttleRatio?: number | undefined;
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
