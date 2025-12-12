import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'src/types/**',
        'src/index.ts',
      ],
      thresholds: {
        statements: 97,
        branches: 80,
        functions: 100,
        lines: 97,
      },
    },
  },
});
