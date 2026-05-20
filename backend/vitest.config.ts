import { defineConfig } from 'vitest/config';

/**
 * Vitest のデフォルト設定ファイル。
 *
 * いつ参照されるか:
 *   - `npm test` (= `vitest run`) で `--config` 未指定のとき、Vitest が
 *     カレントディレクトリから自動的にこのファイルを読み込む。
 *
 * 役割:
 *   - 実 DB を必要としない「ユニットテスト」だけを対象に高速に走らせる。
 *   - 実 DB が必要な結合 / E2E テストは `vitest.integration.config.ts`
 *     で別途実行する (`npm run test:integration`)。
 */
export default defineConfig({
  test: {
    // 走らせる対象ファイル。src 配下の *.test.ts をすべて拾う。
    include: ['src/**/*.test.ts'],
    // include に該当しても以下に当てはまるものは対象外。
    // 結合/E2E 用の置き場とファイル名サフィックスを除外することで、
    // ユニットテスト実行時に実 DB が必要なテストが混ざらないようにしている。
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/**/__tests__/integration/**',
      'src/**/__tests__/e2e/**',
      'src/**/*.integration.test.ts',
      'src/**/*.e2e.test.ts',
    ],
    // Node.js 環境で実行 (DOM は不要なので jsdom は使わない)。
    environment: 'node',
    // 各テストの前に vi.fn() などのモック呼び出し履歴を自動でクリアする。
    // テスト間でモック状態が漏れないようにするための保険。
    clearMocks: true,
  },
});
