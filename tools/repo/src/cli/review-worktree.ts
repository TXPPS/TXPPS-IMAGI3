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

/**
 * Make the checked-out tree read-only.
 *
 * A reviewer's only output channel is its report. At the P1 gate one wrote a
 * scratch script into the *main* tree, where it was found only because it broke
 * lint — so the isolation was one-directional and nobody had noticed.
 *
 * `node_modules` is left writable: `pnpm install` has to run in there, and the
 * point is to stop a reviewer editing the code under review, not to stop it
 * building. `.git` is left alone for the same reason — git needs to write index
 * state to answer `git status`.
 *
 * This is a guardrail, not a sandbox. A determined process can chmod it back.
 * The check that cannot be worked around is `pnpm check:tree`, which runs in a
 * different program and refuses to sweep a dirty tree.
 */
function makeReadOnly(path: string): void {
  const protectedDirs = ['packages', 'apps', 'tools', 'tests', 'docs'];
  for (const dir of protectedDirs) {
    const target = join(path, dir);
    if (!existsSync(target)) continue;
    try {
      execFileSync('chmod', ['-R', 'a-w', target], { stdio: 'ignore' });
    } catch {
      console.warn(`could not make ${dir} read-only; the tree-hygiene check still applies`);
    }
  }
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
    // Naming the SHA it sits at, because refusing without saying what is there
    // sends a reviewer to `cd` into a stale tree and review the wrong commit.
    // That happened twice at the P1 gate, to two different reviewers.
    let stale = 'unknown commit';
    try {
      stale = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path, encoding: 'utf8' }).trim();
    } catch {
      stale = 'a commit this tool could not read';
    }
    console.error(`${path} already exists, checked out at ${stale}.`);
    console.error(`Remove it first:  git worktree remove --force ${path}`);
    return 1;
  }

  git(repoRoot, ['worktree', 'add', '--detach', path, sha]);
  makeReadOnly(path);
  console.log(`worktree:  ${path}  (read-only)`);
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
