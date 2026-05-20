import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mysql from 'mysql2/promise';

/**
 * 結合 / E2E テスト用の Vitest グローバルセットアップ。
 *
 * 役割:
 *   - テスト用 MySQL コンテナ (host=127.0.0.1, port=3307, db=app_test)
 *     の起動を待ち、`helpers/schema.sql` を流してスキーマを初期化する。
 *   - これによりテスト本体は「DB は空 & スキーマ作成済み」の状態から
 *     始められる。
 *
 * いつ・どう呼ばれるか:
 *   - `vitest.integration.config.ts` の `globalSetup` に登録されており、
 *     `npm run test:integration` 実行時に Vitest が "全テストファイルの
 *     実行前に 1 回だけ" default export の `setup` 関数を await する。
 *   - `npm test` (ユニットテスト) では走らない。
 *   - DB の接続情報は同 config の `env:` ブロックで `process.env` に
 *     先行注入されているので、ここでは `process.env.DATABASE_*` を
 *     そのまま読めば良い (本ファイルが env.ts より先に動くため
 *     dotenv は介在しない)。
 */

// ESM では CommonJS の `__dirname` が使えないので、`import.meta.url` から
// 自前で再構築する。schema.sql を相対パスで読み込むために必要。
const __dirname = dirname(fileURLToPath(import.meta.url));

export default async function setup() {
  // テスト DB への接続パラメータ。
  // vitest.integration.config.ts の `env` で注入される想定だが、
  // ローカル直叩き等でも動くようデフォルト値を併記している。
  // `multipleStatements: true` は schema.sql に複数の DDL が
  // セミコロン区切りで並んでいるため (1 クエリで流すのに必要)。
  const config = {
    host: process.env.DATABASE_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DATABASE_PORT ?? '3307', 10),
    user: process.env.DATABASE_USERNAME ?? process.env.DATABASE_USER ?? 'user',
    password: process.env.DATABASE_PASSWORD ?? 'password',
    database: process.env.DATABASE_NAME ?? 'app_test',
    multipleStatements: true,
  } as const;

  // docker compose で起動した直後の MySQL は接続を受け付けない時間が
  // あるため、ping が通るまでリトライして待つ (下のヘルパ関数参照)。
  await waitForMySQL(config);

  // helpers/schema.sql を読み込んで一括適用する。
  // テーブル間に外部キー制約があると、DROP/CREATE の順序によって
  // 失敗するので、適用中だけ FK チェックを無効化している。
  const sql = readFileSync(resolve(__dirname, 'helpers/schema.sql'), 'utf-8');
  const conn = await mysql.createConnection(config);
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query(sql);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    // 例外が出ても接続は必ず閉じる (リーク防止)。
    await conn.end();
  }
}

/**
 * テスト用 MySQL が接続を受け付けるまで最大 60 秒待つヘルパ。
 * 1 秒間隔で `createConnection → ping → close` を試し、成功したら抜ける。
 * 60 回失敗したら最後のエラーを添えて throw する。
 *
 * 主に CI / docker compose up 直後の「ポートは開いてるが MySQL は
 * まだ起動中」というレースを吸収するためのもの。
 */
async function waitForMySQL(config: mysql.ConnectionOptions): Promise<void> {
  const maxAttempts = 60;
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const conn = await mysql.createConnection(config);
      await conn.ping();
      await conn.end();
      return;
    } catch (err) {
      lastErr = err;
      // 1 秒待って再試行
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Test MySQL was not ready: ${(lastErr as Error)?.message}`);
}
