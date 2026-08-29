import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@imagi3/audit';
import { findAssertions, formatAssertionReport, verifyAssertions } from '../assertions.ts';
import {
  TEST_FILE,
  WORKFLOW_FILE,
  jobNamesIn,
  referenceKind,
  resolvesAgainst,
  testTitlesIn,
} from '../references.ts';

/**
 * Fail the build for a comment asserting a runtime property with nothing behind
 * it. See `assertions.ts` and RC-0010.
 *
 * Sources are read from git rather than from a directory walk, so build output,
 * `node_modules` and review worktrees cannot contribute assertions nobody is
 * maintaining.
 */

const EXIT_UNBACKED = 1;
const SCANNED = /\.(?:ts|md)$/u;
const SKIP = /(?:^|\/)(?:dist|dist-types|node_modules|\.audit-out)\//u;

function trackedFiles(repoRoot: string): string[] {
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path.length > 0 && SCANNED.test(path) && !SKIP.test(path));
}

/**
 * A reference resolves when the path exists, or when the named test or CI job
 * exists **in the position that makes it that kind of name**.
 *
 * The rules and the reasoning are in `references.ts`, which is where they can
 * be tested. This function is the part that needs a filesystem.
 */
function makeResolver(repoRoot: string, files: readonly string[]): (ref: string) => boolean {
  const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8');
  let testTitles: string[] | undefined;
  let jobNames: string[] | undefined;

  const titles = (): string[] => {
    testTitles ??= files.filter((path) => TEST_FILE.test(path)).flatMap((p) => testTitlesIn(read(p)));
    return testTitles;
  };
  const jobs = (): string[] => {
    jobNames ??= files.filter((path) => WORKFLOW_FILE.test(path)).flatMap((p) => jobNamesIn(read(p)));
    return jobNames;
  };

  return (reference: string) => {
    const kind = referenceKind(reference);
    if (kind === undefined) return existsSync(join(repoRoot, reference));
    return resolvesAgainst(reference, kind === 'test' ? titles() : jobs());
  };
}

function main(): number {
  const repoRoot = findRepoRoot();
  const files = trackedFiles(repoRoot);
  const sites = files.flatMap((path) =>
    findAssertions(path, readFileSync(join(repoRoot, path), 'utf8')),
  );

  if (sites.length === 0) {
    console.log(`Runtime assertions\n\nASSERTIONS OK: none found in ${String(files.length)} files`);
    return 0;
  }

  const report = verifyAssertions(sites, makeResolver(repoRoot, files));
  console.log(formatAssertionReport(report));
  return report.ok ? 0 : EXIT_UNBACKED;
}

process.exitCode = main();
