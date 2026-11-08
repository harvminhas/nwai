import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'src/__tests__/**/*.test.ts',
      'src/__tests__/**/*.test.tsx',
      'src/lib/__tests__/**/*.test.ts',
      'src/lib/__tests__/**/*.test.tsx',
      'src/components/__tests__/**/*.test.ts',
      'src/components/__tests__/**/*.test.tsx',
    ],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
