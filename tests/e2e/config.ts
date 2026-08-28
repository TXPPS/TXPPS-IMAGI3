import { join } from 'node:path';
import { findRepoRoot } from '@imagi3/audit';

/** Production preview server: what the boot, cold-load and visual gates run against. */
export const PREVIEW_PORT = 4173;

/**
 * Development server. Only the planted-fault proof uses it, because the fault
 * injection module exists solely in development builds.
 */
export const DEV_PORT = 5173;

export const PREVIEW_BASE_URL = `http://127.0.0.1:${String(PREVIEW_PORT)}`;
export const DEV_BASE_URL = `http://127.0.0.1:${String(DEV_PORT)}`;

export const REPO_ROOT = findRepoRoot();

/** Committed reference screenshots, one directory per device profile. */
export const BASELINE_DIR = join(REPO_ROOT, 'tests/e2e/baselines');

/** Scratch output for failed comparisons; git-ignored. */
export const VISUAL_OUTPUT_DIR = join(REPO_ROOT, '.audit-out/visual');

/** Set to any non-empty value to rewrite baselines instead of comparing. */
export const UPDATE_BASELINES_ENV = 'UPDATE_BASELINES';

export function shouldUpdateBaselines(): boolean {
  const value = process.env[UPDATE_BASELINES_ENV];
  return value !== undefined && value.length > 0;
}
