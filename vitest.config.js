import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/ui/**', 'src/commands/**'], // Focus coverage on the core analyzer logic
      reportsDirectory: 'test/coverage'
    },
  },
});
