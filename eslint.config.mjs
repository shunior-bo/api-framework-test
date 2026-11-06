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
    // src/utils/schema.ts is the ONLY file allowed to import from zod.
    files: ['src/utils/schema.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Must be last — disables all ESLint rules that conflict with Prettier
  prettier,
];
