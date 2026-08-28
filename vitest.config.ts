import { defineConfig } from 'vitest/config';

const NODE_TEST_DEFAULTS = {
  environment: 'node',
  globals: false,
} as const;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...NODE_TEST_DEFAULTS,
          name: 'core',
          root: './packages/core',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          ...NODE_TEST_DEFAULTS,
          name: 'audit',
          root: './tools/audit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/selftest/**'],
        },
      },
      {
        test: {
          ...NODE_TEST_DEFAULTS,
          name: 'audit-selftest',
          root: './tools/audit',
          include: ['test/selftest/**/*.test.ts'],
        },
      },
      {
        test: {
          ...NODE_TEST_DEFAULTS,
          name: 'repo',
          root: './tools/repo',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'editor',
          root: './apps/editor',
          environment: 'jsdom',
          globals: false,
          include: ['test/**/*.test.ts'],
        },
      },
    ],
  },
});
