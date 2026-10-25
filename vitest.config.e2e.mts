import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Each file starts its own containers; pulling images can be slow
    hookTimeout: 120_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
