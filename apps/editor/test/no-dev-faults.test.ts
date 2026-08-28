// @vitest-environment node
// esbuild, which Vite's production build uses, cannot run under jsdom.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
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
/**
 * Minimal structural view of Rollup's output. Vite re-exports Rollup's types
 * without Rollup being a direct dependency, so they do not resolve for
 * type-aware linting; describing only the two fields this test reads keeps the
 * assertion honest without reaching for `any`.
 */
interface EmittedChunk {
  readonly type: string;
  readonly code?: string | undefined;
  readonly source?: string | Uint8Array | undefined;
}

interface EmittedBundle {
  readonly output: readonly EmittedChunk[];
}

function isEmittedBundle(value: unknown): value is EmittedBundle {
  if (typeof value !== 'object' || value === null) return false;
  return Array.isArray((value as { output?: unknown }).output);
}

function chunkText(chunk: EmittedChunk): string {
  if (typeof chunk.code === 'string') return chunk.code;
  if (typeof chunk.source === 'string') return chunk.source;
  if (chunk.source instanceof Uint8Array) return new TextDecoder().decode(chunk.source);
  return '';
}

async function buildProductionBundle(): Promise<string> {
  const previousNodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  try {
    const result: unknown = await build({
      root: APP_ROOT,
      mode: 'production',
      logLevel: 'silent',
      build: { write: false, sourcemap: false, reportCompressedSize: false },
    });
    const bundles = (Array.isArray(result) ? result : [result]).filter(isEmittedBundle);
    if (bundles.length === 0) {
      throw new Error('vite build produced no inspectable output; the shape assumption is stale');
    }
    return bundles.flatMap((bundle) => bundle.output.map(chunkText)).join('\n');
  } finally {
    process.env['NODE_ENV'] = previousNodeEnv;
  }
}

/** Built once and shared; the two assertions below describe one artifact. */
let bundlePromise: Promise<string> | undefined;

function productionBundle(): Promise<string> {
  bundlePromise ??= buildProductionBundle();
  return bundlePromise;
}

describe('production bundle', () => {
  it(
    'contains no trace of the development fault injector',
    async () => {
      const code = await productionBundle();

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
      const code = await productionBundle();

      expect(code).toContain('i3-shell');
      expect(code).toContain('imagi3:ready');
    },
    BUILD_TIMEOUT_MS,
  );
});
