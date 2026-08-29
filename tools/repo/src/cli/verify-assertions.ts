import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@imagi3/audit';
import { findAssertions, formatAssertionReport, verifyAssertions } from '../assertions.ts';

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
 * is found in the tree.
 *
 * `test:` and `ci:` are matched textually against tracked files, which is
 * coarse. A name that appears in a comment and nowhere else still fails, which
 * is the case that matters; a name that appears in an unrelated file passes,
 * which review has to catch. Stated rather than implied.
 */
function makeResolver(repoRoot: string, files: readonly string[]): (ref: string) => boolean {
  const corpus = new Map<string, string>();
  const read = (path: string): string => {
    const cached = corpus.get(path);
    if (cached !== undefined) return cached;
    const text = readFileSync(join(repoRoot, path), 'utf8');
    corpus.set(path, text);
    return text;
  };

  return (reference: string) => {
    if (!reference.startsWith('test:') && !reference.startsWith('ci:')) {
      return existsSync(join(repoRoot, reference));
    }
    const name = reference.slice(reference.indexOf(':') + 1).trim();
    if (name.length === 0) return false;
    return files.some((path) => read(path).includes(name));
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
