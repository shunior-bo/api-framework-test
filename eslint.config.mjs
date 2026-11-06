// @ts-check
// .mjs (not .js) so Node loads this ES module without a "type": "module" warning.
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['node_modules/**', 'reports/**', 'test-results/**', 'playwright-report/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Formatting rules (semi, quotes, trailing commas, etc.) are intentionally
      // omitted here — Prettier owns all formatting via .prettierrc.
      //
      // The rules below turn the CONVENTIONS.md import rules into deterministic
      // checks, so a convention violation fails `npm run lint`.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              message: 'Import `z` and schemas from @src/utils/schema instead.',
            },
          ],
          patterns: [
            {
              group: ['../*', './*'],
              message: 'Use the @src/ path alias instead of relative imports.',
            },
          ],
        },
      ],
    },
  },
  {
    // tools/coverage is a standalone, dependency-free CLI run by Node's native
    // TypeScript support: it MUST use relative imports with a .ts extension and
    // MUST NOT depend on Playwright, zod or the framework (src/).
    files: ['tools/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'zod', message: 'tools/coverage has no runtime dependencies.' }],
          patterns: [
            {
              group: ['@playwright/*', '@src/*', '@coverage/*', 'playwright', 'playwright-core'],
              message: 'tools/coverage must not import Playwright or the framework (src/).',
            },
          ],
        },
      ],
    },
  },
  {
    // Only the coverage tool's unit tests may import @coverage/*.
    files: ['src/**/*.ts', 'tests/api/**/*.ts', 'tests/unit/*.ts', 'playwright.config.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              message: 'Import `z` and schemas from @src/utils/schema instead.',
            },
          ],
          patterns: [
            {
              group: ['../*', './*'],
              message: 'Use the @src/ path alias instead of relative imports.',
            },
            {
              group: ['@coverage/*'],
              message: '@coverage/* is only for tests/unit/coverage.',
            },
          ],
        },
      ],
    },
  },
  {
    // src/utils/schema.ts is the ONLY file allowed to import from zod.
    files: ['src/utils/schema.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Must be last — disables all ESLint rules that conflict with Prettier
  prettier,
];
