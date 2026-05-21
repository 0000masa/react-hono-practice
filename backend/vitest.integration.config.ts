import { defineConfig } from 'vitest/config';

/**
 * 結合テスト / E2E テスト専用の Vitest 設定。
 *
 * いつ参照されるか:
 *   - `npm run test:integration` から
 *     `vitest run --config vitest.integration.config.ts` として明示指定される。
 *   - デフォルトの `npm test` (vitest.config.ts) からは参照されない。
 *
 * 役割:
 *   - 実 DB (`mysql-test`, host=127.0.0.1, port=3307) を起動した状態で、
 *     アプリ全体を通すテストを走らせる。
 *   - DB 状態をテスト間で共有するため、並列実行は無効化して直列で走らせる。
 */
export default defineConfig({
  test: {
    // 結合/E2E 用ディレクトリ配下のみを対象にする。
    // (ユニットテスト側 vitest.config.ts ではここを exclude している)
    include: [
      'src/__tests__/integration/**/*.test.ts',
      'src/__tests__/e2e/**/*.test.ts',
    ],
    // Node.js 環境で実行 (DOM は不要)。
    environment: 'node',
    // 各テストの前にモック呼び出し履歴を自動クリア。
    clearMocks: true,

    // --- 並列実行の抑制 -------------------------------------------------
    // 同じ MySQL を共有する都合上、複数テストが同時にレコードを
    // 書き換えると不整合が起きる。以下 3 つで「1 プロセス・直列実行」
    // にしている。
    //
    // fileParallelism=false : 複数テストファイルを並列に走らせない
    // pool='forks'          : ワーカープールに子プロセス (fork) を使う
    // forks.singleFork=true : その fork も 1 つだけに固定する
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },

    // 実 DB アクセスや起動待ちで時間がかかるためデフォルトより長めに。
    testTimeout: 30000, // 各 it/test の上限 30 秒
    hookTimeout: 60000, // beforeAll/afterAll などフックの上限 60 秒

    // 全テスト実行前に 1 回だけ走るセットアップ。
    // テスト用 MySQL の起動待機 → schema.sql 適用を行う
    // (src/__tests__/global-setup.ts を参照)。
    globalSetup: ['./src/__tests__/global-setup.ts'],

    // テストプロセスに注入する環境変数。
    // env.ts の dotenv.config() より先に process.env にセットされるため、
    // 本番用 .env の値を上書きできる。
    // ここでテスト用 DB / S3 / メール / Auth の接続情報を固定値に倒している。
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
      // テスト時はダミー URL。aws-sdk-client-mock(SQSClient) が `.send` を
      // 横取りするため実体には到達しないが、空文字以外をセットすることで
      // controllers/qrcodes.controller.ts:13 の
      //   const sqsClient = env.SQS_QUEUE_URL ? new SQSClient({}) : null;
      // が非 null になり、storeAsync の SQS 経路 (本番想定) を踏める。
      SQS_QUEUE_URL: 'http://localhost:4566/000000000000/test-queue',
      // 同様に SES_REGION を入れて config/mail.ts の SES 分岐 (本番想定の経路)
      // を選ばせる。`mockClient(SESClient)` が `.send` を握り潰すため、実 SES
      // には到達しない。値そのものはモック側で検査されない (リージョン名の
      // 妥当性は問わない) ので、適当な 'us-east-1' で十分。
      SES_REGION: 'us-east-1',
      MAIL_FROM: 'test@example.com',
      FRONTEND_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: 'test-secret',
    },
  },
});
