import { defineConfig } from 'vite';

/**
 * Prefix given to every chunk containing the runtime and the renderer.
 *
 * The name exists so `runtime.bundle.gzip` can be measured as its own budget
 * rather than folded into the editor's. Two things follow from that and both
 * are deliberate: the runtime is not in the entry chunk, so the editor shell's
 * cold-load budget is not paying for three.js on every device profile; and the
 * budget is attributable, so a renderer that doubles in size is visible as the
 * renderer growing rather than as the editor growing.
 *
 * Removing this split does not quietly merge the budgets — it leaves
 * `runtime.bundle.gzip` with no measurement, and an enforced budget nobody
 * measured is a gate failure. See ADR-0006.
 */
export const RUNTIME_CHUNK = 'imagi3-runtime';

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
        manualChunks: (id) =>
          id.includes('/packages/runtime/') ||
          id.includes('/packages/render/') ||
          id.includes('/node_modules/three/')
            ? RUNTIME_CHUNK
            : undefined,
      },
    },
  },
  server: {
    host: '127.0.0.1',
  },
});
