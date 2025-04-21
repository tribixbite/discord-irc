import globals from 'globals';
import pluginJs from '@eslint/js';
import pluginVitest from '@vitest/eslint-plugin';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from "eslint/config";

export default [
  globalIgnores(['dist/**/*.js', 'eslint.config.js']),
  { files: ['{lib,test}/**/*.{js,mjs,cjs,ts}'], ignores: ['fixtures/**/*.js'] },
  { languageOptions: { globals: globals.node } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/no-floating-promises': 'error',

      // any
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    ...pluginVitest.configs.recommended,
  },
];
