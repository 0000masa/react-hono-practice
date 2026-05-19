import { defineConfig } from 'vitest/config';

// Unit テスト専用設定。
// Integration/E2E は実 DB を必要とするため `vitest.integration.config.ts` で別に走らせる。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/**/__tests__/integration/**',
      'src/**/__tests__/e2e/**',
      'src/**/*.integration.test.ts',
      'src/**/*.e2e.test.ts',
    ],
    environment: 'node',
    clearMocks: true,
  },
});
