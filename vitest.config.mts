import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

// The renderer suite starts one jsdom environment per file. On a many-core
// machine Vitest would oversubscribe the CPU and renderer tests would time out
// during startup, so cap the pool.
const maxWorkers = Math.max(2, Math.min(8, availableParallelism() - 1));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    maxWorkers,
    testTimeout: 10_000
  }
});
