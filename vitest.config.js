import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/ui/**'],
      reportsDirectory: 'test/coverage',
      thresholds: {
        statements: 55,
        branches: 50,
        functions: 60,
        lines: 55
      }
    },
  },
});
