import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.property.test.ts', 'lambda/**/__tests__/**/*.test.ts', 'lambda/**/__tests__/**/*.property.test.ts'],
    globals: true,
  },
});
