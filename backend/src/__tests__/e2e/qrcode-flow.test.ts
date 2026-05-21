// =============================================================================
// E2E テスト: QR コード作成〜一覧取得のハッピーパス
// -----------------------------------------------------------------------------
// 【何を保証するテストか】
//   ログイン済みユーザーが POST /api/qrcodes で QR コードを作成し、続けて
//   GET /api/qrcodes を呼んだとき、作成した QR コードが一覧に含まれて返って
//   くる、という一連の動線（CREATE → READ）を End-to-End で確認する。
//
// 【どのような処理になっているか（テスト対象側の流れ）】
//   POST /api/qrcodes
//     → routes/qrcodes.ts (authMiddleware) → controllers/qrcodes.controller.ts の store
//     → services/qrcode.service.ts で QR 画像を生成
//     → services/storage.service.ts が S3 にアップロード（本テストではモック）
//     → DB の qr_codes テーブルに INSERT（status: 'completed'）
//     → 201 で作成済み QR のオブジェクト（公開 URL 付き）を返す
//   GET /api/qrcodes
//     → 同コントローラの index で qr_codes と users を JOIN し、ページングして返す
//     → 各 QR の url は STORAGE_URL_BASE + fileName で組み立てられる
//
// 【どのタイミングで実行されるテストか】
//   - 実行コマンド: backend ディレクトリで `npm run test:integration`
//     （ユニットテストの `npm test` からは vitest.config.ts により除外されている）
//   - 拾うのは vitest.integration.config.ts。E2E/Integration テストは並列実行
//     されない（fileParallelism: false / pool: 'forks' + singleFork: true）。
//     同じテスト DB を共有するため直列で走らせている。
//   - 前提として MySQL のテスト DB（docker-compose の mysql-test、ホスト側 3307 番）
//     が起動している必要がある。__tests__/global-setup.ts が起動を待ち受け、
//     __tests__/helpers/schema.sql を適用する。
//   - 認証と S3 はモック、DB は実物を叩く、という「E2E（実 DB あり）」スタンス。
// =============================================================================

import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
// aws-sdk-client-mock: S3Client へのコマンド呼び出しをインターセプトしてモック化する。
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
// 認証ヘルパ: getAuth() のモック生成と、テスト中のセッションユーザー差し替え用ユーティリティ。
import { createAuthMock, setSessionUser, TEST_USER } from '../helpers/auth';
// DB ヘルパ: 外部キー制約を満たす順序で全テーブルを TRUNCATE 相当の DELETE で初期化する。
import { cleanupDb } from '../helpers/db';

// 認証モジュールをモック化する。`vi.mock` は巻き上げられて `import app` より先に
// 評価されるため、ファイル最上部（import の直後）に置く必要がある。
// これにより、コントローラ側の authMiddleware が getAuth().api.getSession() を呼んだ
// 際に、本テストでは setSessionUser() で渡したユーザー情報が返るようになる。
vi.mock('../../config/auth', () => createAuthMock());

import app from '../../app';
import { db, pool } from '../../config/database';
import { users } from '../../db/schema';

// S3Client の全コマンド呼び出しをこのモックで掌握する。
// 実 S3 / MinIO へは一切リクエストを送らず、PutObjectCommand などは
// `s3Mock.on(...).resolves(...)` で定義した挙動だけが走る。
const s3Mock = mockClient(S3Client);

beforeEach(async () => {
  // 1) 前のテストで設定したモック呼び出し履歴・ハンドラをクリアし、
  //    PutObjectCommand には「空レスポンスで成功」をデフォルト挙動として再設定する。
  s3Mock.reset();
  s3Mock.on(PutObjectCommand).resolves({});

  // 2) テスト DB を子テーブル → 親テーブルの順に全削除して、毎テスト同じ初期状態に揃える。
  await cleanupDb();

  // 3) このテスト中に getSession() が返すユーザーを TEST_USER に固定する（= ログイン済み相当）。
  setSessionUser(TEST_USER);

  // 4) qr_codes が users への外部キーを持つため、TEST_USER と同じ id のレコードを先に作っておく。
  //    これを忘れると INSERT INTO qr_codes が FK 違反で失敗する。
  await db.insert(users).values({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
    emailVerified: TEST_USER.emailVerified,
    image: TEST_USER.image,
  });
});

// テストファイル全体の終了時に MySQL コネクションプールを閉じる。
// 閉じないと vitest プロセスがコネクションを抱えたままぶら下がる可能性がある。
afterAll(async () => {
  await pool?.end();
});

describe('E2E: ログイン済みユーザーが QR コードを作成して一覧で取得できる', () => {
  it('ハッピーパス: POST /api/qrcodes → GET /api/qrcodes で作成済み QR が含まれる', async () => {
    // app.request() は Hono が提供するテスト用 API。実際に HTTP サーバを立てずに、
    // Hono アプリへ Request オブジェクト相当を直接食わせて Response を取り出す。
    // つまりこのテストはネットワークを介さず、アプリ内部のミドルウェア／ルーティング／
    // コントローラ／DB アクセス／（モックされた）S3 までを一気通貫で動かしている。

    // 1. QR コード作成
    //    成功すると status 201（作成済み）が返り、内部では QR 生成 → S3 PutObject（モック）
    //    → qr_codes テーブル INSERT、までが完了している。
    const created = await app.request('/api/qrcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'https://example.com' }),
    });
    expect(created.status).toBe(201);

    // 2. 一覧取得
    //    GET /api/qrcodes は qr_codes と users を JOIN して返す。
    //    直前に作った 1 件が必ず含まれているはず。
    const listed = await app.request('/api/qrcodes');
    expect(listed.status).toBe(200);

    const body = (await listed.json()) as {
      qrcodes: Array<{
        data: string;
        user: { name: string };
        url: string | null;
      }>;
    };

    // 件数は 1（beforeEach で毎回 DB をクリーンにしているため、それ以外は存在しない）。
    expect(body.qrcodes).toHaveLength(1);
    // POST で渡した data 文字列がそのまま保存され、返ってきていること。
    expect(body.qrcodes[0].data).toBe('https://example.com');
    // JOIN したユーザー名が TEST_USER のものであること（= 自分の QR が返っている）。
    expect(body.qrcodes[0].user.name).toBe(TEST_USER.name);
    // url は STORAGE_URL_BASE + fileName の形（vitest.integration.config.ts が
    // STORAGE_URL_BASE=http://localhost:9000/test-bucket を注入している）。
    expect(body.qrcodes[0].url).toContain(process.env.STORAGE_URL_BASE!);
  });
});
