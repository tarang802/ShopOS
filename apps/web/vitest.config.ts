import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Web tests. Only logic that can go quietly wrong is covered here - formatting money
 * for an Indian reader, parsing what people type - since the screens themselves are
 * exercised end to end against the real API.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
