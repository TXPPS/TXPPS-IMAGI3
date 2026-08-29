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
 * Whether a mutation run left anything behind.
 *
 * Compares the working-tree state of the mutated paths **before** the run to
 * the state after, rather than either against `HEAD`. Comparing against `HEAD`
 * reports every file that was already modified when the run started, which
 * looks exactly like a failed revert — and did, twice: once in
 * `mutation-sweep.ts` and then again in `mutants.ts`, which was written minutes
 * after the first was fixed. Extracted here so there is one implementation to
 * get wrong.
 *
 * Both arguments are `git status --porcelain` output limited to the paths the
 * run touches.
 */
export function revertFailure(before: string, after: string): string | undefined {
  if (before.trim() === after.trim()) return undefined;
  return `Mutants were not fully reverted.\nbefore:\n${before.trim()}\nafter:\n${after.trim()}`;
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
  // Written by `pnpm mutants` while a mutation is applied, and removed when it
  // is reverted. Present only mid-run or after a killed run, which the next
  // run recovers from.
  '.mutants-inflight.json',
];

function isExpected(path: string): boolean {
  return EXPECTED_UNTRACKED.some((prefix) => path === prefix || path.startsWith(prefix));
}

/**
 * Ignored directories this check looks *inside*.
 *
 * `git status` honours `.gitignore`, so until this existed a file dropped into
 * `test-results/` reported TREE CLEAN — and `test-results/` is Playwright's own
 * output directory, which is where the stray that prompted this whole check
 * would most naturally have landed. QA Automation demonstrated it at the P1
 * gate with `test-results/rv-nav.mjs` and `.edits/rv-nav.mjs`, both invisible.
 *
 * These hold traces, screenshots, videos and measurement JSON. None of them
 * ever legitimately contains a script.
 *
 * `.edits` is here as a backstop rather than a necessity. It was a gitignored
 * directory of one-off scripts written to edit source — the practice S7 bans,
 * and it had accumulated 44 of them — so it is no longer ignored and
 * {@link findStrays} sees anything left there. It stays on this list so that
 * re-adding the ignore rule does not silently reopen the hole.
 */
export const SCANNED_ARTIFACT_DIRS: readonly string[] = [
  'test-results',
  '.audit-out',
  '.edits',
  'screenshots/actual',
  'screenshots/diff',
];

/**
 * Ignored directories deliberately **not** scanned, and why.
 *
 * `node_modules`, `dist`, `dist-types`, `coverage`, `.vite`, `playwright-report`
 * and `blob-report` all legitimately contain JavaScript — bundles, instrumented
 * sources, Playwright's own report assets. Scanning them for scripts would
 * report thousands of files, and a check that always fires is a check nobody
 * reads.
 *
 * That is a real limit and it is stated rather than left to be discovered: a
 * file hidden in `playwright-report/` is not caught by this. What is caught is
 * every place a reviewer's own artifact plausibly lands.
 */
export const UNSCANNED_GENERATED_DIRS: readonly string[] = [
  'node_modules',
  'dist',
  'dist-types',
  'coverage',
  '.vite',
  'playwright-report',
  'blob-report',
];

/** Extensions that are never an output of a test run or a measurement. */
export const SCRIPT_EXTENSIONS: readonly string[] = [
  '.mjs',
  '.cjs',
  '.js',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.sh',
  '.bash',
  '.py',
  '.rb',
];

/**
 * Strays among files found inside the scanned artifact directories.
 *
 * Takes the paths rather than walking, for the same reason {@link findStrays}
 * takes porcelain text: a classifier that can only be exercised against
 * whatever the disk happens to hold has never been shown to classify anything.
 */
export function findArtifactStrays(paths: readonly string[]): StrayFile[] {
  const strays: StrayFile[] = [];
  for (const path of paths) {
    if (!SCRIPT_EXTENSIONS.some((extension) => path.endsWith(extension))) continue;
    strays.push({
      path,
      reason: 'script inside a test-output directory, which holds only run artifacts',
    });
  }
  return strays;
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
