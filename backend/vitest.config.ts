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
    //
    // 命名規約について:
    //   `xxx.test.ts` という命名は JavaScript/TypeScript エコシステムの
    //   デファクトスタンダードで、Jest や Vitest がデフォルトで自動認識する。
    //   (BDD 系の Mocha / Jasmine では `xxx.spec.ts` も同じくらいよく使われる)
    include: ['src/**/*.test.ts'],
    // include に該当しても以下に当てはまるものは対象外。
    // 結合/E2E 用の置き場とファイル名サフィックスを除外することで、
    // ユニットテスト実行時に実 DB が必要なテストが混ざらないようにしている。
    //
    // ディレクトリ命名について:
    //   `__tests__/` (アンダースコア2つで囲む) は Jest が広めた慣習で、
    //   現在は Vitest など他のテストランナーでも標準的に使われている。
    //   アンダースコア2つで囲むのは「特別な意味を持つディレクトリ」を表す
    //   Python 由来のスタイル (`__init__.py` などと同じ感覚)。
    //   テスト対象のソースと同階層に置くことで「このコードのテストはここ」
    //   という対応関係を視覚的にわかりやすくする狙いがある。
    //
    // ファイル名サフィックスについて:
    //   本プロジェクトでは `.integration.test.ts` / `.e2e.test.ts` のように
    //   `.test.ts` の前にテスト種別を入れることで、ユニット / 結合 / E2E を
    //   ファイル名だけで区別できるようにしている。
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
