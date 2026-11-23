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
      // Measured 2026-11-23 on wave3/base (v0.2.0-beta, 613 tests): statements 89.43,
      // branches 79.47, functions 92.32, lines 93.05. Each threshold is one point lower,
      // so a lane can add code without tests only a little before the gate stops it.
      thresholds: {
        statements: 88.4,
        branches: 78.4,
        functions: 91.3,
        lines: 92.0,
      },
    },
  },
});
