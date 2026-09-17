import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Dependency boundaries from PLAN §3, via core rules (no plugin needed).
const forbid = (...dirs) =>
  dirs.map((d) => ({
    group: [`**/${d}`, `**/${d}/**`],
    message: `import from ${d}/ violates PLAN §3 boundaries`,
  }));

/** core's import rule; `contract` = the relative path of core/input.ts (the InputEvent contract,
 *  core's own file, not the input/ layer) as seen from the files the rule applies to. */
const coreImports = (contract) => [
  'error',
  {
    paths: [{ name: 'three', message: 'core is pure TS (ADR-002)' }],
    patterns: [
      ...forbid('render', 'pose', 'net', 'platform', 'games'),
      { ...forbid('input')[0], group: ['**/input', '**/input/**', `!${contract}`] },
      { group: ['three/*', '@mediapipe/*'], message: 'core is pure TS (ADR-002)' },
    ],
  },
];

export default defineConfig(
  { ignores: ['node_modules', 'dist', 'tmp', 'public', 'fixtures'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Node scripts/hooks; listed by hand rather than adding the `globals` package for a handful of names.
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
      },
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
      'no-restricted-imports': coreImports('./input'),
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
    // Game modules one folder down (core/boxing/): '../input' is core/input.ts there, while from
    // core/ itself it would be the input/ layer.
    files: ['src/core/*/**/*.ts'],
    rules: { 'no-restricted-imports': coreImports('../input') },
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
    // games/<id>/…: never a sibling game, including its folder index ('../boxing'). The shared
    // contract '../types' and layers ('../../core/…') stay allowed. A regex, because a gitignore
    // group like '../*' also matches the '..' parent of '../../core'.
    files: ['src/games/*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^[.][.]/(?!types$|[.][.]/)', message: 'games never import each other' },
          ],
        },
      ],
    },
  },
  {
    // The contract must not depend on any game; only the registry imports game folders.
    files: ['src/games/types.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^[.]/', message: 'the contract imports no game' }] },
      ],
    },
  },
);
