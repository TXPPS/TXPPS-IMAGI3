import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatClaimsReport,
  parseClaims,
  verifyClaims,
  type Claim,
  type DiffOutcome,
} from '../claims.ts';

/**
 * CI gate for the claims ledger. See `claims.ts` for why it exists.
 *
 * Usage: `pnpm verify:claims [files...]`, defaulting to every markdown file
 * under `docs/`. Exits non-zero when a document claims a change a commit does
 * not contain.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEFAULT_DIR = REPO_ROOT;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-types', '.audit-out', '.git']);
const EXIT_FAILED = 1;

/**
 * `<commit>^!` is "this commit against its parents", which is what the ledger
 * means by a commit touching a path. Written this way rather than as an
 * explicit `<commit>^ <commit>` range because `^!` is also correct for a root
 * commit, which has no parent to name, and for a merge, which has two.
 */
function gitDiff(commit: string, path: string): DiffOutcome {
  try {
    const output = execFileSync('git', ['diff', '--stat', `${commit}^!`, '--', path], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const summary = output.trim();
    return summary === '' ? { kind: 'unchanged' } : { kind: 'changed', summary };
  } catch (error) {
    const reason = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
    return { kind: 'error', message: `git could not compare ${commit} for ${path}: ${reason}` };
  }
}

/**
 * Every markdown file in the repository, not just `docs/*.md`.
 *
 * The previous scope missed `README.md`, `CHANGELOG.md` and anything in a
 * `docs/` subdirectory — three places a claim about a code change is at least
 * as likely to be written as the gate tables.
 */
function markdownFilesIn(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...markdownFilesIn(path));
    else if (entry.name.endsWith('.md')) found.push(path);
  }
  return found.sort();
}

function collectClaims(files: readonly string[]): Claim[] {
  return files.flatMap((file) =>
    parseClaims(readFileSync(file, 'utf8'), relative(REPO_ROOT, file) || file),
  );
}

const files = process.argv.slice(2).map((arg) => resolve(arg));
const targets = files.length > 0 ? files : markdownFilesIn(DEFAULT_DIR);
const claims = collectClaims(targets);
const report = verifyClaims(claims, gitDiff);

if (claims.length === 0) {
  process.stdout.write(
    `Claims ledger\n\nCLAIMS OK: no claims found in ${String(targets.length)} file(s)\n`,
  );
} else {
  process.stdout.write(`${formatClaimsReport(report)}\n`);
}

if (!report.ok) process.exitCode = EXIT_FAILED;
