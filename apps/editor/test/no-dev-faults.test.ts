// @vitest-environment node
// esbuild, which Vite's production build uses, cannot run under jsdom.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type RollupOutput } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  PLANTED_CONSOLE_TEXT,
  PLANTED_REJECTION_TEXT,
  PLANTED_THROW_TEXT,
  SLOW_BOOT_DELAY_MS,
} from '../src/dev/plant.ts';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_TIMEOUT_MS = 120_000;

/**
 * Vite decides `import.meta.env.DEV` from NODE_ENV before falling back to the
 * build mode, and Vitest sets NODE_ENV to "test". Without forcing it here, this
 * test would build a development bundle and then cheerfully report that the
 * production bundle is clean — the exact false-green this test exists to
 * prevent.
 */
async function buildProductionBundle(): Promise<string> {
  const previousNodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  try {
    const result = await build({
      root: APP_ROOT,
      mode: 'production',
      logLevel: 'silent',
      build: { write: false, sourcemap: false, reportCompressedSize: false },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as RollupOutput[];
    return outputs
      .flatMap((bundle) => bundle.output)
      .map((chunk) => (chunk.type === 'chunk' ? chunk.code : String(chunk.source)))
      .join('\n');
  } finally {
    process.env['NODE_ENV'] = previousNodeEnv;
  }
}

/**
 * ADR-0009 states that the fault injector is eliminated from production builds.
 * That guarantee is only worth something if it is checked: a refactor dropping
 * the `import.meta.env.DEV` guard would otherwise ship deliberate failure
 * triggers to users, reachable from a query parameter.
 *
 * Every emitted chunk is inspected, not just the entry, because the injector is
 * dynamically imported and would otherwise land in a lazy chunk of its own.
 */
describe('production bundle', () => {
  it(
    'contains no trace of the development fault injector',
    async () => {
      const code = await buildProductionBundle();

      expect(code).not.toContain(PLANTED_CONSOLE_TEXT);
      expect(code).not.toContain(PLANTED_THROW_TEXT);
      expect(code).not.toContain(PLANTED_REJECTION_TEXT);
      expect(code).not.toContain('applyPlantedFault');
      expect(code).not.toContain(String(SLOW_BOOT_DELAY_MS));
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    'still emits the application shell it is meant to ship',
    async () => {
      const code = await buildProductionBundle();

      expect(code).toContain('i3-shell');
      expect(code).toContain('imagi3:ready');
    },
    BUILD_TIMEOUT_MS,
  );
});
