import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Dependency boundaries from PLAN §3, via core rules (no plugin needed).
const forbid = (...dirs) =>
  dirs.map((d) => ({
    group: [`**/${d}`, `**/${d}/**`],
    message: `import from ${d}/ violates PLAN §3 boundaries`,
  }));

export default defineConfig(
  { ignores: ['node_modules', 'dist', 'tmp', 'public', 'fixtures'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Node scripts/hooks; listed by hand rather than adding the `globals` package for four names.
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'three', message: 'core is pure TS (ADR-002)' }],
          patterns: [
            ...forbid('render', 'pose', 'net', 'platform', 'games'),
            // core/input.ts (the InputEvent contract) is core's own file, not the input/ layer.
            { ...forbid('input')[0], group: ['**/input', '**/input/**', '!./input'] },
            { group: ['three/*', '@mediapipe/*'], message: 'core is pure TS (ADR-002)' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'performance',
        'requestAnimationFrame',
        'setTimeout',
        'setInterval',
        'localStorage',
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'use the seeded PRNG (core/prng.ts)' },
      ],
    },
  },
  {
    files: ['src/render/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: forbid('pose') }] },
  },
  {
    files: ['src/pose/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: forbid('core') }] },
  },
  {
    files: ['src/games/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['../*/**', '!../../**'], message: 'games never import each other' }],
        },
      ],
    },
  },
);
