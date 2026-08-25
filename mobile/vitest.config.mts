import { defineConfig } from 'vitest/config';

// The scheduling helpers are plain TypeScript with no React Native imports, so
// they run in node. This config exists only for those unit tests; the app
// itself is still bundled by Metro.
export default defineConfig({
  resolve: { alias: { '@': import.meta.dirname } },
  test: { environment: 'node', include: ['utils/**/*.test.ts'] },
});
