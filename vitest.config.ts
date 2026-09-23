// Vitest config for the stabilization program's unit tier (W1.1 THE TEST PYRAMID).
// node environment, zero AI/network, path alias matching tsconfig's `@/*` → repo root.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globals: false,
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
