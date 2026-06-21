import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/src/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['apps/**/src/**/*.ts', 'packages/**/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      // High-risk modules carry an enforced floor (PLAN.md §6). The stream parser is the
      // foundation of the agent layer — keep it ≥90%.
      thresholds: {
        'apps/daemon/src/agent/stream/claude-jsonl.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
