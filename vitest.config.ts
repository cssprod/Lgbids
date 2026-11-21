import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    // `npm run test:coverage` (vitest run --coverage). The thresholds are a
    // ratchet: the measured baseline minus 1 point. Raise them as tests are
    // added; never lower them to make a change pass.
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts', 'src/web/format.ts'],
      exclude: ['e2e/**', 'tests/**', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // Measured 2026-11-21 on the 2.0 test branch: statements 86.88, branches 74.97,
      // functions 89.30, lines 90.77. The lead re-measures after the 2.0c merge.
      thresholds: {
        statements: 85.8,
        branches: 73.9,
        functions: 88.3,
        lines: 89.7,
      },
    },
  },
});
