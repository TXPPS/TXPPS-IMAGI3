import { execFileSync } from 'node:child_process';
import { findRepoRoot } from '@imagi3/audit';
import { findStrays, formatStrays } from '../tree-hygiene.ts';

/**
 * Refuse to sweep a tree with reviewer artifacts in it.
 *
 * Runs first in `pnpm sweep`, before anything is built or measured. A stray
 * file is not usually harmful in itself — the one that prompted this was a
 * Playwright benchmark — but a tree nobody is watching is a tree where the next
 * one is not noticed either, and the sweep's whole claim is that it measured
 * *this* project.
 *
 * See docs/SECURITY.md SEC-0001.
 */
const EXIT_DIRTY = 1;

function main(): number {
  const repoRoot = findRepoRoot();
  const porcelain = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  const strays = findStrays(porcelain);
  console.log(formatStrays(strays));
  return strays.length === 0 ? 0 : EXIT_DIRTY;
}

process.exitCode = main();
