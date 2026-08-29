import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findRepoRoot } from '@imagi3/audit';
import {
  SCANNED_ARTIFACT_DIRS,
  findArtifactStrays,
  findStrays,
  formatStrays,
} from '../tree-hygiene.ts';

/**
 * Refuse to sweep a tree with reviewer artifacts in it.
 *
 * Runs first in `pnpm sweep`, before anything is built or measured. A stray
 * file is not usually harmful in itself — the one that prompted this was a
 * Playwright benchmark — but a tree nobody is watching is a tree where the next
 * one is not noticed either, and the sweep's whole claim is that it measured
 * *this* project.
 *
 * Two passes, because one was not enough. `git status` honours `.gitignore`, so
 * the first pass sees nothing inside `test-results/` — Playwright's own output
 * directory, and the most natural place for exactly the file this check exists
 * to find. The second walks the ignored directories that never legitimately
 * hold a script. Its limits are stated in `tree-hygiene.ts` rather than left to
 * be discovered.
 *
 * See docs/SECURITY.md SEC-0001.
 */
const EXIT_DIRTY = 1;

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) found.push(join(entry.parentPath, entry.name));
  }
  return found;
}

function main(): number {
  const repoRoot = findRepoRoot();
  const porcelain = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  const artifactFiles = SCANNED_ARTIFACT_DIRS.flatMap((directory) =>
    filesUnder(join(repoRoot, directory)).map((path) => relative(repoRoot, path)),
  );

  const strays = [...findStrays(porcelain), ...findArtifactStrays(artifactFiles)];
  console.log(formatStrays(strays));
  return strays.length === 0 ? 0 : EXIT_DIRTY;
}

process.exitCode = main();
