/**
 * `/api/qrcodes` エンドポイントの **インテグレーションテスト**。
 *
 * ユニットテスト (例: services/__tests__/*) との違い:
 *   ユニットは「関数 1 個」を関数単位で叩く。こちらは Hono の `app.request(...)` を
 *   経由して **HTTP の入口から実際の処理を貫通させ**、
 *     ルーティング → 認証ミドルウェア → コントローラ → サービス → DB / S3
 *   までを一気通貫で検証する。配管 (wiring) の不整合を捕まえるのが主目的。
 *
 * 何をテストしているか:
 *   1. GET /api/qrcodes
 *      - 未認証 → 401
 *      - 認証済み & データ 0 件 → 200 + 空配列 + total=0
 *   2. POST /api/qrcodes
 *      - 正常系: 201、DB に 1 件作成、S3 に 1 回アップロード、レスポンスの形が仕様通り
 *      - 異常系: data 未指定 → 422、副作用 (DB / S3) が一切発生しない
 *      - 異常系: data が 1001 文字 (上限 1000 超え) → 422
 *      - 異常系: 認証なし → 401
 *   3. POST /api/qrcodes/async (非同期版: SQS にジョブを投げる)
 *      - 正常系: 202、DB に status='pending' で 1 件作成、SQS に SendMessage が 1 回
 *      - 異常系: data 未指定 → 422、副作用 (DB / SQS) が一切発生しない
 *      - 異常系: data が 1001 文字 → 422
 *      - 異常系: 認証なし → 401
 *   4. GET /api/qrcodes/:id/status (生成ステータス確認)
 *      - 異常系: 未認証 → 401
 *      - 異常系: 存在しない id → 404
 *      - 正常系: status='pending' のとき url / file_name はレスポンスに含まれない
 *      - 正常系: status='completed' のとき url / file_name が含まれる
 *
 * 何は **本物** を使い、何を **モック** にしているか:
 *   - 本物: Hono アプリ全体、ルーティング、Drizzle 経由の DB (テスト用 PostgreSQL)
 *   - モック: 認証 (better-auth の `getAuth()`)、AWS S3 (`S3Client.send`)、
 *            AWS SQS (`SQSClient.send`)
 *   → DB は本物なので「挿入 → 取得」「外部キー整合性」までまとめて検証できる。
 *
 * いつ実行されるか: `*.test.ts` 扱い → `npm test` で走る (DB 接続が必要)。
 */
import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
// `aws-sdk-client-mock`:
//   AWS SDK v3 のクライアントを **コマンド単位** で横取りするライブラリ。
//   `mockClient(S3Client)` 以降、プロセス内の `new S3Client(...)` インスタンスの
//   `.send()` がすべてモックに置き換わり、実 AWS / MinIO への通信は発生しない。
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
// SQS 用は S3 と完全に同じ枠組み: `mockClient(SQSClient)` で `.send` を
// 横取りし、`SendMessageCommand` の呼び出しを `commandCalls` で検査する。
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createAuthMock, setSessionUser, clearSession, TEST_USER } from '../helpers/auth';
import { cleanupDb } from '../helpers/db';

// authMiddleware が呼ぶ getAuth() を差し替える。
// vi.mock は他の import より先に巻き上げられるため app.ts より上に書く必要がある。
//
// なぜ巻き上げ (hoisting) が問題になるか:
//   下で `import app from '../../app'` をすると、その時点で app.ts が評価され、
//   さらにその中で `import { getAuth } from './config/auth'` が走る。
//   `vi.mock` をこの import より **後** に書くと、`getAuth` の実体は本物に
//   解決されたまま固定されてしまい、テストから差し替えられない。
//   Vitest は `vi.mock` を構文レベルでファイル先頭へ巻き上げる仕様なので、
//   ソース上でも import より上に置く方が読み手にとって意図が明確。
vi.mock('../../config/auth', () => createAuthMock());

// ↑ の vi.mock 実行後に app を読み込むことで、認証部分だけがモックに差し替わった
// 「ほぼ本物」の Hono アプリを取得する。
import app from '../../app';
import { db, pool } from '../../config/database';
import { users, qrCodes } from '../../db/schema';
// `env` は controller と同じソース。テストで「期待される QueueUrl」と
// 「実際に SendMessageCommand に乗った QueueUrl」を比較する際に使う。
import { env } from '../../config/env';

// このファイル全体で使い回す S3 モックのハンドル。
// describe の外に置いて、beforeEach で reset することでテスト間の状態を切る。
const s3Mock = mockClient(S3Client);

// 同じく SQS クライアントのモックハンドル。
// `vitest.integration.config.ts` で `SQS_QUEUE_URL` をダミー値にしているため、
// controllers/qrcodes.controller.ts の `sqsClient = new SQSClient({})` は
// 実体として生成されるが、その `.send` はこのモックが横取りする。
const sqsMock = mockClient(SQSClient);

// 各テストで使う「ログイン中ユーザー」を DB にも実体として用意するためのヘルパ。
//
// なぜ必要か:
//   qr_codes テーブルは users への外部キー (userId) を持つ。
//   認証モックでセッションだけ作っても、DB に該当ユーザーが居なければ
//   INSERT が FK 制約違反で落ちる。
//   → セッション (setSessionUser) と DB レコード (insertTestUser) はセットで
//      用意する必要がある。
async function insertTestUser() {
  await db.insert(users).values({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
    emailVerified: TEST_USER.emailVerified,
    image: TEST_USER.image,
  });
}

// 各テストの前に、外部依存とアプリ状態をすべて「初期状態」へ戻す。
//
// ・s3Mock.reset()
//     前のテストの応答設定 (resolves / rejects) と呼び出し履歴を消去。
// ・s3Mock.on(PutObjectCommand).resolves({})
//     リセット後に「PutObjectCommand は黙って成功する」というデフォルトを
//     仕込み直す。これにより各テストは「S3 アップロードは成功する」前提で
//     書ける (POST 正常系などが煩雑にならない)。
// ・cleanupDb()
//     全テーブルを子→親の順で削除し、テスト間でデータが残らないようにする
//     (helpers/db.ts 参照)。
// ・clearSession()
//     getAuth() モックが返すセッションを null に戻す = 未認証状態にする。
//     ログインが必要なテストは各テスト内で改めて setSessionUser を呼ぶ。
beforeEach(async () => {
  s3Mock.reset();
  s3Mock.on(PutObjectCommand).resolves({});
  // SQS も S3 と同じ思想で初期化:
  //   - reset で履歴と応答設定を消去
  //   - 「SendMessage は黙って成功 (適当な MessageId を返す)」をデフォルトに
  //     しておくことで、storeAsync 正常系テストが煩雑にならない。
  sqsMock.reset();
  sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-msg-id' });
  await cleanupDb();
  clearSession();
});

// このファイルのテストがすべて終わったあと、DB コネクションプールを閉じる。
// 閉じないと vitest プロセスが終了せず CI がハングするため。
// `pool?.end()` の `?.` は、テスト環境によって pool が undefined の場合
// (例: SQLite ドライバ等) を安全にスキップするためのオプショナルチェーン。
afterAll(async () => {
  await pool?.end();
});

describe('GET /api/qrcodes', () => {
  it('異常系: 認証なしなら 401 を返す', async () => {
    // `app.request(url)` は Hono が提供する「実 HTTP サーバを立てずに
    // Request → Response を取り出す」テスト用 API。Web 標準の Response が返る。
    // ここではセッション未設定 (beforeEach で clearSession 済み) のまま叩く。
    const res = await app.request('/api/qrcodes');

    // 認証ミドルウェアが弾いて 401 を返すことを確認。
    // → 「未ログインユーザーに一覧が漏れない」セキュリティ契約のレグレッション防止。
    expect(res.status).toBe(401);
  });

  it('正常系: 認証済みで空のとき 200 + 空配列を返す', async () => {
    // セッション (認証モック) と DB のユーザー行をセットで用意。
    setSessionUser(TEST_USER);
    await insertTestUser();

    const res = await app.request('/api/qrcodes');

    expect(res.status).toBe(200);
    // `res.json()` の戻り値は `unknown` 扱いになるため、検証で使う形だけを
    // 部分的に型注釈してキャストしている (全フィールドを書かない最小宣言)。
    const body = (await res.json()) as { qrcodes: unknown[]; pagination: { total: number } };

    // 0 件のとき:
    //   - `qrcodes` は空配列 (null や undefined ではない)
    //   - `pagination.total` は 0
    // この 2 点を固定することで、コントローラのページング計算が
    // 「0 件のときに NaN を返す / undefined を返す」といった分岐ミスを防ぐ。
    expect(body.qrcodes).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });
});

describe('POST /api/qrcodes', () => {
  // POST 系のテストは原則ログイン済み。各 it で書くと冗長なので、この describe
  // ローカルの beforeEach でまとめてセッションを仕込む。
  // 認証なしを検証する最後のケースだけは、テスト内で clearSession() を呼んで
  // 上書きする。
  beforeEach(() => {
    setSessionUser(TEST_USER);
  });

  it('正常系: 201 を返し、DB に 1 件作成され、S3 にアップロードされる', async () => {
    await insertTestUser();

    // `app.request(url, init)` の `init` は標準 `fetch` の RequestInit と同じ形。
    //   - method: 'POST'
    //   - headers['Content-Type']: 'application/json'  ← これがないと Hono の
    //       `c.req.json()` が中身を JSON として解釈できない。
    //   - body: JSON 文字列化したペイロード
    const res = await app.request('/api/qrcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'hello world' }),
    });

    // --- アサーション 1: HTTP ステータス ---
    // 新規作成成功は 201 (Created)。200 や 204 を返してしまうレグレッション防止。
    expect(res.status).toBe(201);

    // --- アサーション 2: レスポンス JSON の形 ---
    const body = (await res.json()) as {
      qrcode: { data: string; status: string; url: string; file_name: string };
    };
    // 入力した data がそのまま返るか (バリデーション後にトリム等されていないか)。
    expect(body.qrcode.data).toBe('hello world');
    // 同期 API なので即 'completed'。非同期版 (POST /async) では 'pending' に
    // なるはずで、ここで両者の取り違えを検出できる。
    expect(body.qrcode.status).toBe('completed');
    // 公開 URL がベース URL を含んでいることだけを確認 (ファイル名部分はランダム
    // なので完全一致では比較できない)。
    expect(body.qrcode.url).toContain(process.env.STORAGE_URL_BASE!);

    // --- アサーション 3: DB 副作用 ---
    // `db.select().from(qrCodes)` で qr_codes テーブルを全件取得。
    // 「ちょうど 1 行」増えていること、その中身が呼び出し時の data / userId に
    // 一致していることを確認する。
    // → HTTP の戻り値だけで OK と判定すると「レスポンスは作ったが INSERT を
    //   忘れている」バグを取り逃す。本物の DB を見にいくのがインテグレーション
    //   テストの肝。
    const stored = await db.select().from(qrCodes);
    expect(stored).toHaveLength(1);
    expect(stored[0].data).toBe('hello world');
    expect(stored[0].userId).toBe(TEST_USER.id);

    // --- アサーション 4: S3 副作用 ---
    // `s3Mock.commandCalls(PutObjectCommand)` は記録された呼び出し履歴のうち
    // `PutObjectCommand` だけを配列で返す。「ちょうど 1 回」呼ばれたことを
    // 検証することで、
    //   ・0 回   → サービス層で何らかの理由でアップロード前に return している
    //   ・2 回〜 → 重複アップロード (リトライ実装のバグなど)
    // を弾く。
    // 引数の中身までは storage.service のユニットテストで担保しているため、
    // ここではあえて回数だけに留めている (テストの責務分割)。
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
  });

  it('異常系: data 未指定なら 422、DB は変わらない', async () => {
    await insertTestUser();

    // body に `data` を含めずに POST。コントローラ側のバリデーションで
    // 「data は必須」エラーとなり、HTTPException(422) が投げられる想定。
    const res = await app.request('/api/qrcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(422);

    // バリデーションで弾かれた以上、副作用は **一切** 起きていないこと:
    //   - DB に行が増えていない
    //   - S3 へのアップロードも実行されていない
    // この「ロールバック相当」の挙動が崩れると、エラー応答にも関わらずデータが
    // 中途半端に残るのが最悪のシナリオなので、明示的に固定する。
    const stored = await db.select().from(qrCodes);
    expect(stored).toHaveLength(0);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('異常系: data が 1001 文字なら 422 を返す', async () => {
    await insertTestUser();

    // `'a'.repeat(1001)` で 1001 文字の文字列を生成。
    // コントローラの上限は 1000 文字なので **境界値の 1 つ外** を確実に踏む。
    // (境界値テスト: 1000 = OK / 1001 = NG の片側を押さえる)
    const res = await app.request('/api/qrcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'a'.repeat(1001) }),
    });

    expect(res.status).toBe(422);
  });

  it('異常系: 認証なしなら 401', async () => {
    // この describe の beforeEach で setSessionUser されているので、それを
    // 打ち消すために明示的に clearSession を呼ぶ。
    // → describe ローカルの前提を **テスト内で個別に上書き** するパターン。
    clearSession();

    const res = await app.request('/api/qrcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'x' }),
    });

    // GET だけでなく POST 側も同じく認証ミドルウェアで弾けることを確認。
    // 同じミドルウェアが効いているはずでも、ルートごとに `use(authMiddleware)`
    // を貼り忘れる事故が起きうるので、GET / POST の両方で 401 を押さえておく。
    expect(res.status).toBe(401);
  });
});

describe('POST /api/qrcodes/async', () => {
  // 非同期版エンドポイント。`store` (同期版) と違って QR 生成 / S3 アップロードは
  // **その場で行わず**、SQS にジョブを投げて worker に処理させる設計。
  // テストでは:
  //   - HTTP レスポンスが 202 で `status: 'pending'` の即時返信になる
  //   - DB には fileName='' / status='pending' で **先に行を作る** (worker が後で
  //     update する想定)
  //   - SQS には qrCodeId / data / userId を載せた SendMessageCommand が
  //     1 回だけ送られる
  // を一括で確認する。
  beforeEach(() => {
    setSessionUser(TEST_USER);
  });

  it('正常系: 202 を返し、DB に pending で 1 件作成、SQS に 1 回送信される', async () => {
    await insertTestUser();

    const res = await app.request('/api/qrcodes/async', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'async hello' }),
    });

    // --- アサーション 1: HTTP ステータス ---
    // 202 Accepted は「リクエストは受け付けたが処理は非同期で進行中」を示す
    // 標準的なステータス。同期版の 201 (Created) と取り違える事故を防ぐため
    // ここで明示的に固定する。
    expect(res.status).toBe(202);

    // --- アサーション 2: レスポンス JSON の形 ---
    const body = (await res.json()) as {
      qrcode: { id: number; status: string; data: string };
    };
    // worker が後で 'completed' / 'failed' に更新するまでは 'pending'。
    // ここを取り違えるとフロント側のポーリング表示が崩れるので明示。
    expect(body.qrcode.status).toBe('pending');
    expect(body.qrcode.data).toBe('async hello');
    // id は auto_increment なので具体値は固定せず、「数値が入っている」だけ確認。
    expect(typeof body.qrcode.id).toBe('number');

    // --- アサーション 3: DB 副作用 ---
    // 同期版とは違い、fileName='' & status='pending' という「ジョブ作成だけ
    // 終わった状態」が確実に書き込まれていることを確認する。
    // → ここが空だと「SQS に投げたのに DB に行が無い」= worker が picks up
    //    できない致命バグ。
    const stored = await db.select().from(qrCodes);
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe('pending');
    expect(stored[0].fileName).toBe('');
    expect(stored[0].data).toBe('async hello');
    expect(stored[0].userId).toBe(TEST_USER.id);

    // --- アサーション 4: SQS 副作用 ---
    // `sqsMock.commandCalls(SendMessageCommand)` は S3 と同じインターフェース。
    // SendMessageCommand が **ちょうど 1 回** 呼ばれたこと、その引数が
    //   - QueueUrl: env.SQS_QUEUE_URL (vitest config のダミー URL)
    //   - MessageBody: JSON 文字列。parse すると { qrCodeId, data, userId }
    // であることを固定する。
    // MessageBody が壊れていると worker 側の JSON.parse が失敗してジョブが
    // 進まないので、形状を一度ここで押さえておく価値が高い。
    const sqsCalls = sqsMock.commandCalls(SendMessageCommand);
    expect(sqsCalls).toHaveLength(1);
    expect(sqsCalls[0].args[0].input.QueueUrl).toBe(env.SQS_QUEUE_URL);
    const messageBody = JSON.parse(sqsCalls[0].args[0].input.MessageBody!) as {
      qrCodeId: number;
      data: string;
      userId: number;
    };
    expect(messageBody.qrCodeId).toBe(stored[0].id);
    expect(messageBody.data).toBe('async hello');
    expect(messageBody.userId).toBe(TEST_USER.id);

    // --- アサーション 5: S3 はこのパスでは呼ばれない ---
    // 同期版との大事な違い。非同期版の controller は S3 を直接叩かず worker に
    // 丸投げするはずなので、PutObjectCommand が 0 件であることを固定して
    // 「うっかり同期版と同じ実装になっている」レグレッションを弾く。
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('異常系: data 未指定なら 422、DB / SQS は変わらない', async () => {
    await insertTestUser();

    const res = await app.request('/api/qrcodes/async', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(422);

    // バリデーション失敗時はジョブ自体を作らない。
    //   - DB に行が増えない
    //   - SQS にも送らない
    // 同期版と同じく「中途半端な状態を残さない」ロールバック相当の挙動。
    const stored = await db.select().from(qrCodes);
    expect(stored).toHaveLength(0);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it('異常系: data が 1001 文字なら 422 を返す', async () => {
    await insertTestUser();

    // store / storeAsync で同じ 1000 文字制限を実装している前提のため、
    // 同期版テストと **同じ境界値** を踏んで、両者がズレないことも間接的に
    // 担保する。
    const res = await app.request('/api/qrcodes/async', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'a'.repeat(1001) }),
    });

    expect(res.status).toBe(422);
  });

  it('異常系: 認証なしなら 401', async () => {
    clearSession();

    const res = await app.request('/api/qrcodes/async', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'x' }),
    });

    // `routes/qrcodes.ts` で `use('*', authMiddleware)` が効いているはずでも、
    // ルートごとの取りこぼし事故 (例: パスを書き間違える / 別ルータに切り出して
    // ミドルウェアを忘れる) を防ぐため、新ルートを足すたびに 401 ケースを
    // 個別に書いておく価値がある。
    expect(res.status).toBe(401);
  });
});

describe('GET /api/qrcodes/:id/status', () => {
  // QR コード生成ジョブの進捗を取得するエンドポイント。
  //   - 'pending' のとき: id / status / data / 日時のみ
  //   - 'completed' のとき: 上記 + url / file_name (公開 URL とキー名)
  //   - 'failed' のとき: 上記 + url / file_name は **含めない** (実装側で
  //                     `status === 'completed' && fileName` の AND ガード)
  // ここでは pending / completed の 2 形状と、404 / 401 を押さえる。

  // テストごとに qr_codes に行を 1 件作るためのローカルヘルパ。
  // - status を引数で切り替えられる
  // - fileName / data はデフォルトを持つ
  // - 返り値は採番された id (テスト内で URL に埋めるため)
  // beforeEach で cleanupDb されているため毎回まっさらな状態から作る。
  async function insertQrCode(params: {
    status: 'pending' | 'completed' | 'failed';
    fileName?: string;
    data?: string;
  }): Promise<number> {
    const [row] = await db
      .insert(qrCodes)
      .values({
        userId: TEST_USER.id,
        fileName: params.fileName ?? '',
        data: params.data ?? 'test',
        status: params.status,
      })
      .$returningId();
    return row.id;
  }

  it('異常系: 認証なしなら 401 を返す', async () => {
    // セッションは beforeEach (ファイル直下) で clearSession 済み。
    // 認証ミドルウェアが弾くため、id の中身は何でもよい (DB を見るより前に 401)。
    const res = await app.request('/api/qrcodes/1/status');
    expect(res.status).toBe(401);
  });

  it('異常系: 存在しない id なら 404 を返す', async () => {
    setSessionUser(TEST_USER);
    await insertTestUser();

    // ユーザーは居るが qr_codes は 0 件 → どんな id を叩いても見つからない。
    // 99999 は auto_increment の現実的な最大値より十分大きい数を選んでいる。
    const res = await app.request('/api/qrcodes/99999/status');

    // controller 内の `if (!qrCode) throw new HTTPException(404, ...)` を踏む。
    // ここを 200 で空ボディを返してしまうとフロント側が「ジョブはあるが
    // まだ準備中」と誤判定するため、404 を固定する意義は大きい。
    expect(res.status).toBe(404);
  });

  it("正常系: status='pending' のときは url / file_name を返さない", async () => {
    setSessionUser(TEST_USER);
    await insertTestUser();
    const id = await insertQrCode({ status: 'pending' });

    const res = await app.request(`/api/qrcodes/${id}/status`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // 必須プロパティの中身検証。
    expect(body.id).toBe(id);
    expect(body.status).toBe('pending');

    // pending のときに公開 URL を返してしまうと、worker がまだファイルを
    // アップロードしていないのにフロントがその URL を踏みにいって 404 を
    // 引いてしまう。よって **キー自体が存在しないこと** を固定する。
    // `toEqual({ url: undefined })` ではキーが存在する/しないを区別できないため、
    // `not.toHaveProperty` を使う。
    expect(body).not.toHaveProperty('url');
    expect(body).not.toHaveProperty('file_name');
  });

  it("正常系: status='completed' のときは url / file_name を返す", async () => {
    setSessionUser(TEST_USER);
    await insertTestUser();
    const id = await insertQrCode({
      status: 'completed',
      fileName: '1/x.png',
    });

    const res = await app.request(`/api/qrcodes/${id}/status`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: number;
      status: string;
      url: string;
      file_name: string;
    };

    expect(body.status).toBe('completed');
    expect(body.file_name).toBe('1/x.png');
    // url は `getFileUrl(fileName)` = `${STORAGE_URL_BASE}/${fileName}` で
    // 組み立てられる。テスト用 env のベース URL は vitest.integration.config.ts
    // で `http://localhost:9000/test-bucket` に固定されているので、
    // 完全一致で検証してよい (本番値とは独立に成立する)。
    expect(body.url).toBe(`${env.STORAGE_URL_BASE}/1/x.png`);
  });
});
