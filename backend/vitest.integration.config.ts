import { defineConfig } from 'vitest/config';

// Integration / E2E 専用設定。実 DB (mysql-test, port 3307) が必要。
export default defineConfig({
  test: {
    include: [
      'src/__tests__/integration/**/*.test.ts',
      'src/__tests__/e2e/**/*.test.ts',
    ],
    environment: 'node',
    clearMocks: true,
    // テスト間で DB を共有するため直列実行
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30000,
    hookTimeout: 60000,
    globalSetup: ['./src/__tests__/global-setup.ts'],
    // env.ts の dotenv.config() より先に process.env に注入される
    env: {
      NODE_ENV: 'test',
      DATABASE_HOST: '127.0.0.1',
      DATABASE_PORT: '3307',
      DATABASE_NAME: 'app_test',
      DATABASE_USERNAME: 'user',
      DATABASE_USER: 'user',
      DATABASE_PASSWORD: 'password',
      S3_BUCKET: 'test-bucket',
      STORAGE_URL_BASE: 'http://localhost:9000/test-bucket',
      MAIL_FROM: 'test@example.com',
      FRONTEND_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: 'test-secret',
    },
  },
});
