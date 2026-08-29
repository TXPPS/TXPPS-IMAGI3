import { defineConfig } from 'vite';
import { RUNTIME_CHUNK, chunkFor } from './src/build/chunks.ts';

/**
 * The chunk split lives in `src/build/chunks.ts`, where it can be tested.
 *
 * It was three inline `id.includes(…)` calls here, and `packages/core/` was not
 * one of them — so the scene schema, the serialiser and the graph repair were
 * bundled into the entry chunk while `runtime.bundle.gzip` measured the
 * renderer alone, with nothing able to notice.
 */
export { RUNTIME_CHUNK };

/**
 * Relative base so the same build output can be served from a subpath, which
 * the standalone export in P8 depends on.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2023',
    sourcemap: true,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks: chunkFor,
      },
    },
  },
  server: {
    host: '127.0.0.1',
  },
});
