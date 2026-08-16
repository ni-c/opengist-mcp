// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Flat-config ignore patterns are relative to this file, so the docs site's
  // own build output needs naming explicitly — `dist/` does not reach into it.
  {
    ignores: [
      'dist/',
      'coverage/',
      'docs/.vitepress/dist/',
      'docs/.vitepress/cache/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  }
);
