/**
 * Every detector this harness ships, as data.
 *
 * The self-test's completeness check compared the scenarios it had against a
 * hardcoded set written in the same file, so it could only notice an edit to
 * one of two halves that one person maintains together. QA Automation found
 * what that misses at the P1 gate: `checkProfileOrdering` is a shipped detector
 * with a pass/fail verdict, a CLI, a step in `pnpm sweep`, a job in CI and a row
 * in the guard audit — and it appeared in neither half, so the assertion named
 * "lists a scenario for every detector the harness ships" passed while a
 * detector shipped with no scenario.
 *
 * A registry outside the test file does not fix that on its own; what fixes it
 * is that the registry is checked against the **filesystem**. Every gate CLI
 * under `src/cli/` must appear here, so adding one without a scenario fails the
 * build rather than passing quietly.
 */

export interface ShippedDetector {
  /** The name scenarios use. Human-facing, and the join between the two lists. */
  readonly name: string;
  /**
   * The CLI that runs it, relative to `tools/audit/src/cli/`, or undefined for
   * a detector reached only as a library function from a spec or another gate.
   */
  readonly cli: string | undefined;
}

/** CLI files that run a gate. A measurer is not a gate: it reports, it does not judge. */
export const GATE_CLI_PREFIX = 'check-';

export const SHIPPED_DETECTORS: readonly ShippedDetector[] = [
  { name: 'budget checker', cli: 'check-budgets.ts' },
  { name: 'profile ordering', cli: 'check-profile-ordering.ts' },
  { name: 'measurement drift checker', cli: undefined },
  { name: 'budget config validator', cli: undefined },
  { name: 'console allowlist validator', cli: undefined },
  { name: 'screenshot comparator', cli: undefined },
  { name: 'console guard', cli: undefined },
  { name: 'bundle measurer', cli: undefined },
  { name: 'measurement file reader', cli: undefined },
  { name: 'throttling evidence', cli: undefined },
  { name: 'engine frame budget', cli: undefined },
  { name: 'dropped frame budget', cli: undefined },
  { name: 'frame sample refusal', cli: undefined },
];
