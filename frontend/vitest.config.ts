import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vitest 専用設定。vite.config.ts と分けることで、本番ビルドのプロキシ設定と
// テスト用設定の責務を分離する。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
