/**
 * `/api/mail` エンドポイントの **インテグレーションテスト**。
 *
 * 何をテストしているか:
 *   `POST /api/mail/send` (controllers/mail.controller.ts の `send`)
 *     - 異常系: 認証なし → 401
 *     - 正常系: 200、SES に SendEmailCommand が 1 回送られる、引数の Source /
 *               Destination / Subject / Body.Html が期待値、HTML 本文に
 *               subject と message が埋め込まれている
 *     - 異常系 (バリデーション、計 6 ケース):
 *         * to 未指定 → 422 + messages.to + SES 0 回
 *         * to 不正な形式 → 422 (regex 検証)
 *         * subject 未指定 → 422
 *         * subject 256 文字 (上限 255 超え) → 422 (境界値)
 *         * message 未指定 → 422
 *         * message 5001 文字 (上限 5000 超え) → 422 (境界値)
 *     - 異常系: SES が reject → 500 (controller の try/catch で包む)
 *
 * 何は **本物** を使い、何を **モック** にしているか:
 *   - 本物: Hono アプリ全体、ルーティング、authMiddleware、mail.controller、
 *           mail.service (HTML テンプレート組み立て)、config/mail の SES 分岐
 *   - モック: 認証 (better-auth の `getAuth()`)、AWS SES (`SESClient.send`)
 *   - DB は使わないので cleanupDb は不要 (app 評価で pool 自体は生成されるため
 *     afterAll で end するのみ)。
 *
 * SES 分岐に倒すために `vitest.integration.config.ts` で `SES_REGION` を
 * 'us-east-1' に設定している (config/mail.ts:5 の `sesClient` が非 null になる)。
 *
 * いつ実行されるか: `npm run test:integration`。
 */
import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
// AWS SES SDK の v3。controller → mail.service → config/mail まで通った先で
// `SendEmailCommand` を `s3Client.send` 相当に渡している (config/mail.ts:26-34)。
// `mockClient(SESClient)` でこの `.send` を横取りする。
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { createAuthMock, setSessionUser, clearSession, TEST_USER } from '../helpers/auth';

vi.mock('../../config/auth', () => createAuthMock());

import app from '../../app';
import { pool } from '../../config/database';
import { env } from '../../config/env';

// プロセス全体で 1 つだけ作る SES モックハンドル。
// describe の外に置いて、beforeEach で reset することでテスト間の状態を切る。
const sesMock = mockClient(SESClient);

beforeEach(() => {
  sesMock.reset();
  // デフォルトは「黙って成功」。正常系テストが煩雑にならないようにするため、
  // ここで `SendEmailCommand` のデフォルト応答を仕込み直しておく。
  // (SES の本物の応答は { MessageId } を含むため、形を合わせている)
  sesMock.on(SendEmailCommand).resolves({ MessageId: 'mock-ses-id' });
  // セッションを null に戻す → 未認証状態がデフォルト。
  // ログインが必要なテストは個別に setSessionUser を呼ぶ。
  clearSession();
});

afterAll(async () => {
  // mail エンドポイント自体は DB を触らないが、app.ts を import した時点で
  // database 接続プールは生成される。Vitest プロセスをハングさせないために
  // 必ず end しておく。
  await pool?.end();
});

describe('POST /api/mail/send', () => {
  // 認証なしを検証するケース以外は全部ログイン済み前提。
  // qrcodes.route.test.ts の POST 系と同じ流儀。
  beforeEach(() => {
    setSessionUser(TEST_USER);
  });

  it('正常系: 200 を返し、SES に SendEmailCommand が 1 回送られる', async () => {
    const res = await app.request('/api/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'recipient@example.com',
        subject: '件名X',
        message: '本文Y',
      }),
    });

    // --- アサーション 1: HTTP ステータス & レスポンス JSON ---
    // 成功時は固定文言の 200 (controller 行 37)。
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'メールを送信しました' });

    // --- アサーション 2: SES 副作用 ---
    // SendEmailCommand が **ちょうど 1 回** 呼ばれていること。
    //   ・0 回   → controller が sendMail を呼ばずに 200 を返してしまった
    //   ・2 回〜 → 重複送信 (リトライ実装のバグなど。課金やユーザーへの
    //              "メールが何通も来る" 事故に直結)
    const calls = sesMock.commandCalls(SendEmailCommand);
    expect(calls).toHaveLength(1);

    // SendEmailCommand に渡された引数の構造を固定する。
    //   - Source        … env.MAIL_FROM (mail.service が env から拾う)
    //   - Destination   … ToAddresses が [to] の単一宛先
    //   - Message.Subject.Data … 入力した subject がそのまま
    //   - Message.Body.Html.Data … 内部で組み立てた HTML テンプレート
    // ここを契約として固定しておくと、後で「Cc / Bcc を増やそうとしたら
    // ToAddresses が空になった」「文字コードを変えて壊した」等の事故を
    // 早期に捕まえられる。
    const input = calls[0].args[0].input;
    expect(input.Source).toBe(env.MAIL_FROM);
    expect(input.Destination?.ToAddresses).toEqual(['recipient@example.com']);
    expect(input.Message?.Subject?.Data).toBe('件名X');
    expect(input.Message?.Subject?.Charset).toBe('UTF-8');

    // --- アサーション 3: HTML 本文に subject / message が埋め込まれている ---
    // mail.service が組み立てるテンプレートを route 経由で **貫通検証** する。
    // 「subject だけテンプレートに乗ったが message が抜け落ちた」のような
    // 配管バグを 1 行で検出できる。テンプレート全文ではなく、キーとなる
    // 文字列断片だけを `toContain` で見るのは mail.service.test.ts と同じ流儀。
    const html = input.Message?.Body?.Html?.Data ?? '';
    expect(html).toContain('件名X');
    expect(html).toContain('本文Y');
    expect(input.Message?.Body?.Html?.Charset).toBe('UTF-8');
  });

  it('異常系: to 未指定なら 422、SES は呼ばれない', async () => {
    const res = await app.request('/api/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 's', message: 'm' }),
    });

    expect(res.status).toBe(422);
    // 422 のときはバリデーションメッセージが `messages` 配下に来る (controller 行 31)。
    const body = (await res.json()) as { error: string; messages: Record<string, string[]> };
    expect(body.messages.to).toBeDefined();

    // バリデーション失敗時は外部 I/O (SES 送信) が **一切** 起きていないことを
    // 固定する。controller が validation → sendMail の順なので、ここが 1 件以上
    // になると「先に sendMail してから validation」している致命的なバグの兆候。
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('異常系: to が不正な形式なら 422', async () => {
    const res = await app.request('/api/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `invalid` は `@` を含まないので controller の regex
      //   /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      // を踏んで 422。
      body: JSON.stringify({ to: 'invalid', subject: 's', message: 'm' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { messages: Record<string, string[]> };
    expect(body.messages.to).toBeDefined();
    // 「アドレス不正は SES に到達させない」契約。
    // SES に渡してから SES 側エラーで弾く設計だと、無駄なリクエスト + 課金 +
    // SES の送信レピュテーション低下に繋がるため、手前で止めるのが望ましい。
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('異常系: subject 未指定なら 422', async () => {
    const res = await app.request('/api/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'a@b.co', message: 'm' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { messages: Record<string, string[]> };
    expect(body.messages.subject).toBeDefined();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('異常系: subject が 256 文字なら 422 (境界値: 255 OK / 256 NG)', async () => {
    // controller は `subject.length > 255` で弾く (行 19-21)。
    // 256 文字を投げることで境界値の外側 (= NG 側) を確実に踏む。
    const res = await app.request('/api/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'a@b.co', subject: 'a'.repeat(256), message: 'm' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { messages: Record<string, string[]> };
    expect(body.messages.subject).toBeDefined();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('異常系: message 未指定なら 422', async () => {
    const res = await app.request('/api/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'a@b.co', subject: 's' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { messages: Record<string, string[]> };
    expect(body.messages.message).toBeDefined();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('異常系: message が 5001 文字なら 422 (境界値: 5000 OK / 5001 NG)', async () => {
    // controller は `message.length > 5000` で弾く (行 25-27)。
    // 5001 文字で境界の外側を踏む。長文の文字列なので生成コストはほぼ無視できる。
    const res = await app.request('/api/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'a@b.co', subject: 's', message: 'a'.repeat(5001) }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { messages: Record<string, string[]> };
    expect(body.messages.message).toBeDefined();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('異常系: 認証なしなら 401', async () => {
    // この describe の beforeEach で setSessionUser されているので、それを
    // 打ち消して未認証状態を作る。qrcodes.route.test.ts と同じパターン。
    clearSession();

    const res = await app.request('/api/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // body が valid でも認証で先に弾けることを確認するために、ちゃんと
      // 通る値を渡しておく。
      body: JSON.stringify({ to: 'a@b.co', subject: 's', message: 'm' }),
    });

    expect(res.status).toBe(401);
    // 認証で弾かれた以上、SES にも到達していないこと。
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('異常系: SES が reject したら 500 を返す', async () => {
    // SES の応答だけをこの it のためにエラーへ差し替える。beforeEach の
    // `.resolves(...)` を上書きする形。
    sesMock.on(SendEmailCommand).rejects(new Error('SES failure'));

    const res = await app.request('/api/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'a@b.co', subject: 's', message: 'm' }),
    });

    // controller の `try/catch` で HTTPException(500) に包まれる (行 39-43)。
    // 「SES の生エラーを 200 で握り潰さない」「クライアントに 5xx で正しく
    //  通知する」という上位レイヤとの契約を固定する。
    // レスポンス本文の形は Hono のデフォルト挙動に依存するため status のみ確認。
    expect(res.status).toBe(500);

    // 実際に SES 送信を試みた = モックに渡った、までは到達していること。
    // (= バリデーションは通っていて、controller が sendMail を呼んでいる)
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
  });
});
