// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Files that are tooling entrypoints and may print to stdout. */
const CLI_GLOBS = ['tools/**/cli/**/*.ts', 'scripts/**/*.ts', '**/*.config.{ts,js}'];
const TEST_GLOBS = ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts', '**/test/**/*.ts'];

const MAX_FILE_LINES = 400;
const MAX_NESTING_DEPTH = 3;
const MAX_PARAMS = 5;
const MAX_COMPLEXITY = 12;

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/.audit-out/**',
      '.edits/**',
      '**/screenshots/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- Section 7 coding standards, mechanically enforced ---
      'max-lines': ['error', { max: MAX_FILE_LINES, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', MAX_NESTING_DEPTH],
      'max-params': ['error', MAX_PARAMS],
      complexity: ['error', MAX_COMPLEXITY],
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1, 2],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],

      // --- Section 2: no escape hatches ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': { descriptionFormat: '^: .+$' },
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',

      // --- Correctness ---
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },
  {
    files: CLI_GLOBS,
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },
  {
    // The fault injector's payload is the failure signal itself: emitting a
    // console error is what the audit harness must be able to catch. The module
    // is eliminated from production builds by `import.meta.env.DEV`.
    files: ['apps/editor/src/dev/plant.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: TEST_GLOBS,
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
      'max-lines': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
