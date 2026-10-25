import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['development'] },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'evals/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**'],
      exclude: ['**/*.test.ts', 'packages/core/src/index.ts'],
      thresholds: { lines: 90, branches: 80 },
    },
  },
})
