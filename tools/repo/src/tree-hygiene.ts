/**
 * The main tree must be clean of anything a reviewer left behind.
 *
 * Reviewer isolation exists so a report describes a frozen commit. It leaked in
 * both directions at the P1 gate: a reviewer wrote `rv-nav.mjs` — a Playwright
 * benchmark script — into the **main** working tree, where it was found only
 * because it broke lint. Nothing had been checking.
 *
 * A reviewer's only output channel is its report. Two mechanisms enforce that,
 * and they fail differently on purpose:
 *
 * - `pnpm review:worktree` marks the worktree read-only, so a write fails at
 *   the moment it is attempted, in the reviewer's own session, where it can be
 *   understood.
 * - This check runs before the sweep and refuses to proceed on an untracked
 *   file in the main tree, so a leak that happened anyway cannot be measured as
 *   though it were the project.
 *
 * The second is the one that matters. Read-only can be worked around by a
 * determined process; a sweep that refuses to start cannot be, because it is a
 * different program looking at the result.
 *
 * **Only untracked files count.** A new file you meant to add is untracked
 * until you `git add` it, and staging it clears this check — which is the
 * intended workflow rather than an inconvenience, because a sweep's claim is
 * that it measured *this project*, and a file nobody has accounted for is
 * exactly what that claim cannot cover. Modified tracked files are none of this
 * check's business; that is what review is for.
 */

export interface StrayFile {
  readonly path: string;
  readonly reason: string;
}

/**
 * Paths that are untracked and expected.
 *
 * Deliberately short. Anything not here that appears in the tree during a
 * review is either a reviewer artifact or something nobody meant to create,
 * and both are worth stopping for.
 */
export const EXPECTED_UNTRACKED: readonly string[] = [
  '.audit-out/',
  'node_modules/',
  'dist/',
  'dist-types/',
  'playwright-report/',
];

function isExpected(path: string): boolean {
  return EXPECTED_UNTRACKED.some((prefix) => path === prefix || path.startsWith(prefix));
}

/**
 * Strays in a `git status --porcelain` listing.
 *
 * Takes the porcelain text rather than shelling out, so the classification is
 * testable against planted output instead of only against whatever the tree
 * happens to contain — a detector that has only seen a clean tree has never
 * been shown to detect anything.
 */
export function findStrays(porcelain: string): StrayFile[] {
  const strays: StrayFile[] = [];
  for (const line of porcelain.split('\n')) {
    if (line.trim().length === 0) continue;
    // Porcelain v1: two status characters, a space, then the path.
    const STATUS_WIDTH = 2;
    const status = line.slice(0, STATUS_WIDTH);
    const path = line.slice(STATUS_WIDTH + 1).trim();
    if (path.length === 0) continue;
    if (isExpected(path)) continue;
    if (status === '??') {
      strays.push({
        path,
        reason: 'untracked file in the main tree; a reviewer writes only its report',
      });
    }
  }
  return strays;
}

export function formatStrays(strays: readonly StrayFile[]): string {
  if (strays.length === 0) return 'TREE CLEAN: no reviewer artifacts in the main tree';
  const lines = ['Stray files in the main working tree:'];
  for (const stray of strays) lines.push(`  ${stray.path} — ${stray.reason}`);
  lines.push(
    '',
    'A review runs in a detached read-only worktree and reports back; it does not',
    'write here. Remove these, or add them to EXPECTED_UNTRACKED if they belong.',
    'See docs/SECURITY.md SEC-0001.',
  );
  return lines.join('\n');
}
