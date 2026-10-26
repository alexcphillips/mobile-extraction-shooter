import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.wrangler/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Lets `const { a, ...rest } = obj` drop a field.
    rules: { '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
  {
    files: ['packages/client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['packages/client/**/*.tsx'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['*.{js,ts}', 'packages/*/*.{js,ts}', 'scripts/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // The simulation must run on the server unchanged: no rendering, UI or DOM.
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'shared must not depend on rendering.' },
            { group: ['react', 'react-dom', 'react/*'], message: 'shared must not depend on UI.' },
            {
              group: ['@mes/client', '@mes/server'],
              message: 'shared must not import other packages.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
