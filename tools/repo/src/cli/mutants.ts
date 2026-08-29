import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findRepoRoot } from '@imagi3/audit';
import {
  checkRatchet,
  formatRatchet,
  type CoverageBaseline,
  type PackageCoverage,
} from '../mutants/baseline.ts';
import {
  INFLIGHT_MARKER,
  applyMutant,
  enumerateMutants,
  type GeneratedMutant,
  type InflightRecord,
} from '../mutants/enumerate.ts';
import { revertFailure } from '../tree-hygiene.ts';

/**
 * Enumerate mutants from the code, run them, and hold the result to a ratchet.
 *
 * Usage: `pnpm mutants [--package packages/core] [--record] [--limit N]`
 *
 * `--record` writes the measured counts to `mutation-baseline.json` instead of
 * checking against it. That is a deliberate two-step: improving coverage takes
 * a visible commit of a better number, and so does worsening it.
 *
 * Each mutant runs only the suites that could plausibly catch it — the three
 * engine projects — rather than the whole workspace. `tools/audit` and
 * `tools/repo` do not import the engine, and the editor's unit tests cover the
 * P0 shell, so including them would add minutes per mutant to observe nothing.
 * That is a real narrowing and it is stated rather than assumed: a mutant only
 * these suites can see is a mutant only these suites are credited with.
 */

const BASELINE_FILE = 'mutation-baseline.json';
const ENGINE_PROJECTS = ['--project', 'core', '--project', 'runtime', '--project', 'render'];
const EXIT_FAILED = 1;

/** Packages whose exports the ratchet governs. */
const PACKAGES = ['packages/core', 'packages/runtime', 'packages/render'];

interface Options {
  readonly only: string | undefined;
  readonly record: boolean;
  readonly limit: number;
}

function parseArgs(argv: readonly string[]): Options {
  const packageIndex = argv.indexOf('--package');
  const limitIndex = argv.indexOf('--limit');
  const limitRaw = limitIndex >= 0 ? Number.parseInt(argv[limitIndex + 1] ?? '', 10) : Number.NaN;
  return {
    only: packageIndex >= 0 ? argv[packageIndex + 1] : undefined,
    record: argv.includes('--record'),
    limit: Number.isFinite(limitRaw) ? limitRaw : Number.POSITIVE_INFINITY,
  };
}

function sourceFiles(repoRoot: string, pkg: string): string[] {
  return execFileSync('git', ['ls-files', `${pkg}/src`], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts'));
}

function suiteFails(repoRoot: string): boolean {
  try {
    execFileSync('pnpm', ['vitest', 'run', '--silent', ...ENGINE_PROJECTS], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return false;
  } catch {
    return true;
  }
}

/**
 * Restore a mutation a previous run was killed part-way through.
 *
 * Runs before anything else. `finally` covers a thrown error and a normal exit;
 * it cannot cover `SIGKILL`, which no process can intercept — and a killed run
 * did leave a mutated `parity.ts` behind. The marker is what makes that
 * recoverable instead of silent.
 */
function recoverInflight(repoRoot: string): void {
  const marker = join(repoRoot, INFLIGHT_MARKER);
  if (!existsSync(marker)) return;
  const record = JSON.parse(readFileSync(marker, 'utf8')) as InflightRecord;
  writeFileSync(join(repoRoot, record.file), record.original);
  rmSync(marker);
  console.log(`Recovered ${record.file} from an interrupted run (${record.mutantId}).\n`);
}

/** Apply, run, restore. The marker covers what `finally` cannot. */
function runMutant(repoRoot: string, mutant: GeneratedMutant): boolean {
  const path = join(repoRoot, mutant.file);
  const marker = join(repoRoot, INFLIGHT_MARKER);
  const original = readFileSync(path, 'utf8');
  const mutated = applyMutant(original, mutant);
  // A mutant that changes nothing would run the suite to prove nothing and
  // count as a survivor, dragging the ratio down for no reason.
  if (mutated === original) return true;

  const record: InflightRecord = { file: mutant.file, original, mutantId: mutant.id };
  writeFileSync(marker, JSON.stringify(record));
  try {
    writeFileSync(path, mutated);
    return suiteFails(repoRoot);
  } finally {
    writeFileSync(path, original);
    rmSync(marker, { force: true });
  }
}

/** Every mutant for a package, flattened so the run loop stays shallow. */
function mutantsFor(repoRoot: string, pkg: string, limit: number): GeneratedMutant[] {
  const all = sourceFiles(repoRoot, pkg).flatMap((file) =>
    enumerateMutants(file, readFileSync(join(repoRoot, file), 'utf8')),
  );
  return Number.isFinite(limit) ? all.slice(0, limit) : all;
}

function measurePackage(repoRoot: string, pkg: string, limit: number): PackageCoverage {
  const mutants = mutantsFor(repoRoot, pkg, limit);
  let killed = 0;
  for (const mutant of mutants) {
    if (runMutant(repoRoot, mutant)) killed += 1;
    else console.log(`  SURVIVED ${mutant.id}`);
  }
  console.log(`${pkg}: ${String(killed)}/${String(mutants.length)} killed`);
  return { enumerated: mutants.length, killed };
}

function measure(repoRoot: string, options: Options): Record<string, PackageCoverage> {
  const measured: Record<string, PackageCoverage> = {};
  for (const pkg of PACKAGES) {
    if (options.only !== undefined && options.only !== pkg) continue;
    measured[pkg] = measurePackage(repoRoot, pkg, options.limit);
  }
  return measured;
}

function main(): number {
  const repoRoot = findRepoRoot();
  const options = parseArgs(process.argv.slice(2));
  const baselinePath = join(repoRoot, BASELINE_FILE);

  recoverInflight(repoRoot);
  console.log('Enumerating mutants from source, not from judgement.\n');
  const treeState = (): string =>
    execFileSync('git', ['status', '--porcelain', '--', ...PACKAGES], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

  const before = treeState();
  const measured = measure(repoRoot, options);
  const failure = revertFailure(before, treeState());
  if (failure !== undefined) {
    console.error(`\n${failure}`);
    return EXIT_FAILED;
  }

  if (options.record) {
    const baseline: CoverageBaseline = {
      packages: measured,
      recordedAt: `pnpm mutants --record, ${new Date().toISOString()}`,
    };
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`\nRecorded baseline to ${relative(repoRoot, baselinePath)}`);
    return 0;
  }

  if (!existsSync(baselinePath)) {
    console.error(
      `\nNo ${BASELINE_FILE}. Record one with \`pnpm mutants --record\`, review the numbers, ` +
        'and commit it. The ratchet has nothing to compare against until then.',
    );
    return EXIT_FAILED;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as CoverageBaseline;
  const report = checkRatchet(baseline, measured);
  const drift = report.verdicts
    .filter((v) => v.ok)
    .flatMap((v) => {
      const now = measured[v.package];
      const before = baseline.packages[v.package];
      if (now === undefined || before === undefined) return [];
      return now.killed > before.killed || now.enumerated !== before.enumerated
        ? [`${v.package}: ${String(now.killed)}/${String(now.enumerated)}`]
        : [];
    });
  console.log(`\n${formatRatchet(report, drift)}`);
  return report.ok ? 0 : EXIT_FAILED;
}

process.exitCode = main();
