import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Resolve workspace packages to their TS source so tests can import their *values* without a
  // prior build step (type-only imports never needed this; runtime values like claudeCode do).
  resolve: {
    alias: {
      '@app/agent-defs': `${root}packages/agent-defs/src/index.ts`,
      '@app/contracts': `${root}packages/contracts/src/index.ts`,
    },
  },
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
