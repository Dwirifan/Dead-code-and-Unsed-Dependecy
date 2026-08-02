import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.js'],
      // Wizard interaktif dan theme terminal sulit diukur secara stabil; generator
      // HTML tetap masuk coverage karena memproses data proyek tak tepercaya.
      exclude: ['src/ui/wizard.js', 'src/ui/theme.js'],
      reportsDirectory: 'test/coverage',
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 62,
        lines: 60
      }
    },
  },
});
