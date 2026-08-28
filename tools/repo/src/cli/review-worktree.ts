import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findRepoRoot } from '@imagi3/audit';

/**
 * Create an isolated worktree for a role review.
 *
 * Reviews must run against a commit that cannot move underneath them. During
 * P0 a reviewer's end-to-end run finished two seconds after three source files
 * changed, and the resulting artifact was described as frozen when it was not.
 * A detached worktree at a tag makes that impossible rather than discouraged.
 *
 * Usage: pnpm review:worktree <role> <tag>
 */
const USAGE = 'usage: pnpm review:worktree <role> <tag>';

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function main(): number {
  const [role, tag] = process.argv.slice(2);
  if (role === undefined || tag === undefined) {
    console.error(USAGE);
    return 1;
  }

  const repoRoot = findRepoRoot();
  let sha: string;
  try {
    sha = git(repoRoot, ['rev-parse', `${tag}^{commit}`]);
  } catch {
    console.error(`no such tag or commit: ${tag}`);
    console.error('Tag the tree first, e.g. git tag -a review/p1-1 -m "P1 gate review"');
    return 1;
  }

  const path = resolve(repoRoot, '..', `imagi3-review-${role}`);
  if (existsSync(path)) {
    console.error(`${path} already exists; remove it with \`git worktree remove\` first`);
    return 1;
  }

  git(repoRoot, ['worktree', 'add', '--detach', path, sha]);
  console.log(`worktree:  ${path}`);
  console.log(`tag:       ${tag}`);
  console.log(`sha:       ${sha}`);
  console.log('');
  console.log('Next, in that directory:');
  console.log('  pnpm install --frozen-lockfile');
  console.log('');
  console.log(`The review report must record the SHA above. A report without one`);
  console.log('describes a tree nobody can reconstruct.');

  const nodeModules = join(path, 'node_modules');
  if (!existsSync(nodeModules)) console.log('');
  return 0;
}

process.exitCode = main();
