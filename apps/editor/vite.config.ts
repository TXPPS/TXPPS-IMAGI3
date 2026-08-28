import { defineConfig } from 'vite';

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
  },
  server: {
    host: '127.0.0.1',
  },
});
