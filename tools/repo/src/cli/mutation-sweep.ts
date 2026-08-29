import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@imagi3/audit';
import {
  CONTROL_MUTATION,
  MUTATIONS,
  formatMutationReport,
  judgeMutations,
  matchedExpectation,
  type Mutation,
  type MutationOutcome,
} from '../mutations.ts';

/**
 * Apply each mutation, run the suite, and require a test to fail.
 *
 * Usage: `pnpm mutation:sweep [--suite unit|e2e|all] [--control]`
 *
 * Defaults to the unit subset, which runs in a couple of minutes and is what a
 * per-commit job can afford. The `e2e` mutations need a browser and a build and
 * are run at the phase gate.
 *
 * **Every mutation is reverted, including on crash.** The file is restored from
 * the bytes read before the edit, in a `finally`, and the tree is checked clean
 * at the end. A mutation sweep that leaves a mutation in the tree is worse than
 * no sweep at all, because the next thing to run measures sabotaged code.
 */

const EXIT_SURVIVOR = 1;
const EXIT_ERROR = 2;

interface Options {
  readonly suite: 'unit' | 'e2e' | 'all';
  readonly includeControl: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const suiteArg = argv[argv.indexOf('--suite') + 1];
  const suite = suiteArg === 'e2e' || suiteArg === 'all' ? suiteArg : 'unit';
  return { suite, includeControl: argv.includes('--control') };
}

function selected(options: Options): Mutation[] {
  const chosen = MUTATIONS.filter(
    (m) => options.suite === 'all' || m.suite === options.suite,
  ).slice();
  if (options.includeControl) chosen.push(CONTROL_MUTATION);
  return chosen;
}

/** Run the suite a mutation is visible to. Non-zero exit means a test failed. */
function suiteFails(repoRoot: string, mutation: Mutation): boolean {
  const command =
    mutation.suite === 'e2e'
      ? ['exec', 'playwright', 'test', '--workers=1']
      : ['vitest', 'run', '--silent'];
  try {
    execFileSync('pnpm', command, { cwd: repoRoot, stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

/**
 * Apply one mutation and report whether anything noticed.
 *
 * A `find` that is absent, or present more than once, is an error rather than a
 * survivor: the code moved and the mutation is now testing nothing. Reporting
 * that as a survivor would be a false alarm; reporting it as a kill would be
 * worse.
 */
function runMutation(repoRoot: string, mutation: Mutation): MutationOutcome {
  const path = join(repoRoot, mutation.file);
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(mutation.find).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${mutation.id}: anchor appears ${String(occurrences)} times in ${mutation.file}, ` +
        'expected exactly once. The code moved; update the mutation.',
    );
  }

  try {
    writeFileSync(path, original.replace(mutation.find, mutation.replace));
    const killed = suiteFails(repoRoot, mutation);
    return {
      mutation,
      killed,
      detail: killed ? 'a test failed, as required' : 'no test noticed',
    };
  } finally {
    writeFileSync(path, original);
  }
}

/** Working-tree state of the files a sweep touches, for before/after comparison. */
function mutatedFileState(repoRoot: string): string {
  return execFileSync('git', ['status', '--porcelain', '--', ...MUTATIONS.map((m) => m.file)], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function main(): number {
  const repoRoot = findRepoRoot();
  const options = parseArgs(process.argv.slice(2));
  const mutations = selected(options);
  // Captured before anything is mutated. Comparing the end state against HEAD
  // instead would report every file that was already modified — which on the
  // first run of this tool was one, and looked exactly like a failed revert.
  const stateBefore = mutatedFileState(repoRoot);
  console.log(`Running ${String(mutations.length)} mutations (${options.suite})\n`);

  const outcomes: MutationOutcome[] = [];
  for (const mutation of mutations) {
    process.stdout.write(`  ${mutation.id} ... `);
    const outcome = runMutation(repoRoot, mutation);
    console.log(outcome.killed ? 'killed' : 'SURVIVED');
    outcomes.push(outcome);
  }

  // Every outcome is judged against what its entry expects, so a control that
  // must survive is not a special case in the CLI. The first version had one
  // notion of success and reported a correct inverse control as a failure.
  const report = judgeMutations(outcomes);
  console.log(`\n${formatMutationReport(report)}`);

  const control = outcomes.find((o) => o.mutation.id === CONTROL_MUTATION.id);
  if (control !== undefined) {
    console.log(
      matchedExpectation(control)
        ? '\nCONTROL OK: the deliberately unguarded function survived, so this sweep can report one'
        : '\nCONTROL FAILED: the unguarded function was killed, so the control no longer controls',
    );
  }

  const stateAfter = mutatedFileState(repoRoot);
  if (stateAfter !== stateBefore) {
    console.error(
      `\nMutations were not fully reverted.\nbefore:\n${stateBefore}\nafter:\n${stateAfter}`,
    );
    return EXIT_ERROR;
  }

  return report.ok ? 0 : EXIT_SURVIVOR;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = EXIT_ERROR;
}
