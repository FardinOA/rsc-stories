import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'docs/dist',
      'test-results',
      'playwright-report',
      'tests/fixtures',
      '**/.next',
      '**/.rsc-stories/.cache',
      '**/next-env.d.ts',
      'rsc-stories-static',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // The public API stays `any`-free (NFR-7.1).
      '@typescript-eslint/no-explicit-any': ['error', { ignoreRestArgs: true }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      // Terminal output is matched with ANSI escape codes on purpose.
      'no-control-regex': 'off',
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/runtime/client/**/*.{ts,tsx}', 'examples/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Generated shims and tests may use `any` where they mirror untyped runtime values.
    files: ['tests/**', 'e2e/**', 'conformance/**', 'scripts/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
