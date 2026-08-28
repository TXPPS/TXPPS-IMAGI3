import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

/**
 * Walk up from a starting directory to the workspace root, so tools work the
 * same whether they are invoked from the repo root, a package, or a test.
 */
export function findRepoRoot(startDir: string = dirname(fileURLToPath(import.meta.url))): string {
  const { root } = parse(startDir);
  let current = startDir;
  while (current !== root) {
    if (existsSync(join(current, WORKSPACE_MARKER))) return current;
    current = dirname(current);
  }
  if (existsSync(join(root, WORKSPACE_MARKER))) return root;
  throw new Error(`could not locate ${WORKSPACE_MARKER} above ${startDir}`);
}

export const BUDGETS_FILENAME = 'budgets.json';
export const ALLOWLIST_FILENAME = 'audit.allowlist.json';
