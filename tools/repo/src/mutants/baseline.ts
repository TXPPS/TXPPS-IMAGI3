/**
 * The coverage ratchet.
 *
 * A mutation sweep that merely reports is a sweep whose result nobody has to
 * act on. The baseline turns it into a contract: every package records how many
 * mutants were enumerated and how many were killed, and a commit that lowers a
 * package's kill ratio fails the build.
 *
 * Two properties make it a ratchet rather than a snapshot:
 *
 * - **New exports enter the enumeration automatically.** The mutant set is
 *   derived from the code, so adding an unguarded function adds mutants that
 *   survive, which lowers the ratio, which fails. Nobody has to remember to
 *   register anything.
 * - **The recorded ratio only rises.** Improving coverage requires committing a
 *   new baseline, which is a visible diff. Lowering it requires committing a
 *   worse number, which is a visible diff someone has to justify.
 *
 * The ratio is not required to be 1. Some survivors are legitimate — an export
 * whose behaviour genuinely is not observable, an inverse control — and
 * demanding 100% would produce assertions written to satisfy the ratchet rather
 * than to catch anything. What the ratchet forbids is *going backwards*.
 *
 * ## The recorded number is not a coverage figure
 *
 * Stated here because it would otherwise be read as one, and this project has
 * spent two gate passes on numbers that read as measurements and were not. The
 * first baseline is 297 killed of 390 enumerated, and the 93 survivors are three
 * different things in one total:
 *
 * 1. **Files this sweep does not run the suite for.** Every mutant in
 *    `render/src/view.ts` and `render/src/webgpu.ts` survives — 28 of them —
 *    because a `SceneView` needs WebGL and its coverage lives in Playwright,
 *    which `pnpm mutants` does not invoke. `render.present.noop` is genuinely
 *    covered, and the hand-picked e2e sweep proves it. Counting these as
 *    uncovered attributes to coverage what is really suite selection.
 * 2. **Equivalent mutants.** `canonical.ts`'s four surviving inverted predicates
 *    are the branches of `describe()`, which choose the *noun in an error
 *    message*. Inverting one changes "a function" to "a symbol" and nothing
 *    else; the thrown `CanonicalError` and its path are unchanged. A test
 *    pinning that wording would be a test written for the ratchet.
 * 3. **Real holes**, which is what the number is for.
 *
 * The ratchet works regardless, because it compares like with like: the same
 * enumeration over the same suites, so a new export landing unguarded lowers the
 * ratio and fails. It is the **absolute** figure that must not be quoted as
 * coverage, and separating the three is open work rather than done work.
 */

export interface PackageCoverage {
  readonly enumerated: number;
  readonly killed: number;
}

export interface CoverageBaseline {
  /** Keyed by package directory, e.g. `packages/core`. */
  readonly packages: Readonly<Record<string, PackageCoverage>>;
  /** Free text: what run produced these numbers. */
  readonly recordedAt: string;
}

export interface RatchetVerdict {
  readonly package: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface RatchetReport {
  readonly ok: boolean;
  readonly verdicts: readonly RatchetVerdict[];
}

export function killRatio(coverage: PackageCoverage): number {
  // An empty package has ratio 1: there is nothing unguarded in it. Reporting 0
  // would fail the ratchet for a package that has not been written yet.
  return coverage.enumerated === 0 ? 1 : coverage.killed / coverage.enumerated;
}

/**
 * Tolerance on the ratio, in mutants.
 *
 * Zero. The comparison is exact because both numbers are counts from a
 * deterministic enumeration over committed source — there is no sampling and no
 * timing, so there is no noise to absorb. A tolerance here would only be a way
 * to let coverage drift down by one mutant at a time.
 */
const TOLERANCE = 0;

/** Percentage scale, so the ratio reads as a percentage in reports. */
const PERCENT = 100;

export function checkRatchet(
  baseline: CoverageBaseline,
  measured: Readonly<Record<string, PackageCoverage>>,
): RatchetReport {
  const names = [...new Set([...Object.keys(baseline.packages), ...Object.keys(measured)])].sort();

  const verdicts = names.map((name): RatchetVerdict => {
    const before = baseline.packages[name];
    const now = measured[name];

    if (now === undefined) {
      return {
        package: name,
        ok: false,
        detail: `baseline records ${name} but the sweep measured nothing for it`,
      };
    }
    if (before === undefined) {
      // A new package is not a regression, but it must be recorded before it
      // can be ratcheted. Failing here is what forces that.
      return {
        package: name,
        ok: false,
        detail:
          `${name} is not in the baseline. Record it: ${String(now.killed)}/` +
          `${String(now.enumerated)} killed.`,
      };
    }

    const wasRatio = killRatio(before);
    const nowRatio = killRatio(now);
    const summary =
      `${String(now.killed)}/${String(now.enumerated)} killed ` +
      `(${(nowRatio * PERCENT).toFixed(1)}%), baseline ` +
      `${String(before.killed)}/${String(before.enumerated)} (${(wasRatio * PERCENT).toFixed(1)}%)`;

    if (now.killed + TOLERANCE < before.killed && nowRatio < wasRatio) {
      return {
        package: name,
        ok: false,
        detail: `${summary} — coverage went backwards`,
      };
    }
    if (nowRatio + Number.EPSILON < wasRatio) {
      return {
        package: name,
        ok: false,
        detail:
          `${summary} — new code entered the enumeration unguarded. Either assert ` +
          'the behaviour or say in docs/BUGS.md why it cannot be asserted.',
      };
    }
    return { package: name, ok: true, detail: summary };
  });

  return { ok: verdicts.every((v) => v.ok), verdicts };
}

export function formatRatchet(report: RatchetReport, drift: readonly string[] = []): string {
  const lines = ['Mutation coverage ratchet'];
  for (const verdict of report.verdicts) {
    lines.push(`  ${verdict.ok ? 'OK  ' : 'FAIL'} ${verdict.package}: ${verdict.detail}`);
  }
  if (drift.length > 0) {
    lines.push('', 'Baseline is behind the measurement; commit the new numbers:');
    for (const line of drift) lines.push(`  ${line}`);
  }
  lines.push(
    '',
    report.ok ? 'RATCHET OK: no package lost coverage' : 'RATCHET FAILED: coverage went backwards',
  );
  return lines.join('\n');
}
