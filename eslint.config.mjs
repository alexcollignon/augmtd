// ESLint flat config (W1.2 TOOLING). eslint-config-next still ships its rules in the legacy
// .eslintrc shape (no flat export as of the installed 15.1.x line), so FlatCompat bridges it —
// the same bridge Next.js's own `next lint` uses internally.
import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-dev/**',
      '.next-build/**',
      'scratchpad/**',
      'scripts/tmp-*.ts',
      'scripts/tmp-*.mjs',
      'infra/**',
      'public/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // THE STABILIZATION FLOOR: this repo has a large pre-existing surface area with violations
      // that predate this config. The goal here is a lint that RUNS non-interactively and blocks
      // NEW error classes — not a silent mass-reformat. Downgrading these to warnings keeps every
      // existing violation visible (and counted) without failing CI on code nobody is touching.
      // A rule NOT listed here stays at eslint-config-next's own severity (usually already 'warn').
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react/no-unescaped-entities': 'warn',
      '@next/next/no-img-element': 'warn',
      'prefer-const': 'warn',
      // Pre-existing violations at the time this config was introduced (Sep 22 stabilization):
      // downgraded to warnings so `npm run lint` runs clean of ERRORS today without a mass-fix
      // pass, while staying visible in the warning count. A NEW violation of a clean rule (not
      // listed here) still fails the lint.
      '@typescript-eslint/no-require-imports': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      '@next/next/no-html-link-for-pages': 'warn',
      '@typescript-eslint/triple-slash-reference': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
    },
  },
];
