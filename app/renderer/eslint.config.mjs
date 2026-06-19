import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier/flat';

// Flat config (ESLint 9). Equivalent in intent to the previous .eslintrc.cjs.
// Parity notes:
//  - The codebase uses a `_`-prefix to mark intentionally-unused bindings and a few
//    intentional empty `catch (_) {}` blocks — honored below in config, not by deleting code.
//  - `react/no-unescaped-entities` is cosmetic (zero runtime impact) — off.
//  - eslint-plugin-react-hooks 7 promoted several rules to "recommended" that the codebase
//    predates (set-state-in-effect, refs, purity, immutability). They are downgraded to
//    `warn` so the linter is green while the findings stay visible for a later cleanup.
export default [
  { ignores: ['dist/**', 'node_modules/**'] },

  // useSystemAudioCapture.ts has `eslint-disable-next-line no-console` directives that
  // mark intentional console output. `no-console` isn't enabled here (it wasn't in the
  // old .eslintrc.cjs either), so those directives are currently no-ops — keep them
  // valid rather than flag them as "unused" (the legacy config didn't report unused
  // directives), preserving the markers for a future decision on enforcing no-console.
  { linterOptions: { reportUnusedDisableDirectives: false } },

  js.configs.recommended,
  ...tseslint.configs['flat/recommended'],
  react.configs.flat.recommended,
  reactHooks.configs.flat['recommended-latest'],

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // react-hooks 7 additions — downgraded to warn pending a dedicated cleanup.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },

  // Must be last: turns off stylistic rules that conflict with Prettier.
  prettier,
];
