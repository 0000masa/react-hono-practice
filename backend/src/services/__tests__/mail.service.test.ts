/**
 * mail.service.ts のユニットテスト。
 *
 * 何をテストしているか:
 *   `sendMail(to, subject, body)` (src/services/mail.service.ts) について、
 *     1. 下回りの `sendEmail()` を **正しい引数で** 1 回だけ呼ぶか
 *     2. HTML テンプレートに subject / body が埋め込まれるか
 *     3. `sendEmail()` が throw したらそのまま呼び出し元に伝播するか
 *   の 3 点を検証する。
 *   実際にメールは送らない (`sendEmail` を丸ごとモックに差し替えているため、
 *   SES / SMTP に到達しない)。
 *
 * いつ実行されるか:
 *   - ファイル名が `*.test.ts` で、置き場が `__tests__/integration` でも
 *     `__tests__/e2e` でもないため、`vitest.config.ts` の include にマッチする。
 *   - すなわち `npm test` (= `vitest run`) で走るユニットテスト。
 *   - 実 DB は不要なので `npm run test:integration` の対象にはならない。
 *
 * 使っているテストライブラリ (Vitest) の役割:
 *   - `describe` / `it` / `expect`
 *       テストの構造化とアサーション。`describe` でグルーピング、
 *       `it` (= `test` のエイリアス) で 1 ケース、`expect(値).xxx()` で検証。
 *   - `vi`
 *       モック関連の名前空間。`vi.mock()` でモジュール丸ごと差し替え、
 *       `vi.fn()` で「呼び出し履歴を覚える偽の関数」を生成する。
 *   - `beforeEach`
 *       この describe 内の各 it の直前に毎回走る前処理。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` は Vitest が **ファイル先頭に自動でホイスト** する特殊なフック。
// 物理的な行は下の `import { sendEmail } ...` より上に置いてあるが、
// 仮にもっと下に書いても実行順としては最初に走るようになっている。
// このおかげで、下の import 文が走った時点で `sendEmail` は既に `vi.fn()` に
// すり替わっており、テスト中は本物の `config/mail` の実装は読み込まれない。
vi.mock('../../config/mail', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../../config/mail';
import { sendMail } from '../mail.service';
import { env } from '../../config/env';

// `vi.mocked()` は「これはモックです」という型情報を付けて取り出すヘルパ。
// 実体は同じ関数だが、これを通すことで `.mockResolvedValue` などの
// モック専用メソッドに IDE 補完 / 型チェックが効くようになる。
const mockedSendEmail = vi.mocked(sendEmail);

describe('sendMail', () => {
  // 各 `it` の直前に呼ばれる。各テストを「成功時 (undefined を resolve)」状態から
  // スタートさせるためのリセット。
  // vitest.config.ts で `clearMocks: true` を入れているので
  // 呼び出し履歴 (`mock.calls`) は自動でクリアされるが、
  // `mockResolvedValue` / `mockRejectedValue` などの **実装の差し替え** は
  // 残り続けるため、テスト順に依存しないようここで明示的に上書きしている。
  beforeEach(() => {
    mockedSendEmail.mockResolvedValue(undefined);
  });

  // --- ケース 1: 引数の受け渡し ---
  it('sendEmail に from / to / subject を正しく渡す', async () => {
    await sendMail('to@example.com', '件名テスト', '本文テスト');

    // `toHaveBeenCalledOnce()` : モックが「ちょうど 1 回」呼ばれたことを保証。
    expect(mockedSendEmail).toHaveBeenCalledOnce();
    // `mock.calls[0][0]` : 1 回目の呼び出しの 1 つ目の引数 (= 渡したオブジェクト)。
    const arg = mockedSendEmail.mock.calls[0][0];
    // `toBe` は厳密等価 (===) でのアサーション。
    expect(arg.from).toBe(env.MAIL_FROM); // env から MAIL_FROM が引かれているか
    expect(arg.to).toBe('to@example.com');
    expect(arg.subject).toBe('件名テスト');
  });

  // --- ケース 2: HTML テンプレートへの埋め込み ---
  it('HTML 本文にテンプレートのレイアウトと subject / body が埋め込まれる', async () => {
    await sendMail('to@example.com', 'Subject-A', 'Body-A');

    const arg = mockedSendEmail.mock.calls[0][0];
    // `toContain` : 文字列の部分一致確認。テンプレ全文を書くと壊れやすいので
    // 「キーになる断片だけ」を見るのが定石。
    expect(arg.html).toContain('<!DOCTYPE html>');
    // `toMatch` : 正規表現でのマッチ確認。
    // `<h2 style="...">Subject-A</h2>` のように属性が入る形を許容するため、
    // 属性部分を `[^>]*` で吸収している。
    expect(arg.html).toMatch(/<h2[^>]*>Subject-A<\/h2>/);
    expect(arg.html).toContain('Body-A');
  });

  // --- ケース 3: エラー伝播 ---
  //
  // 「エラー伝播 (propagation)」とは:
  //   下回り (sendEmail) で起きたエラーが、sendMail で握りつぶされず、
  //   呼び出し元 (= ここではテストコード) まで素通しで投げ上がってくること。
  //
  //   呼び出し関係はこうなっている:
  //     [テストコード]   → sendMail(...) → sendEmail(...)
  //                                          ↑ ここで Error('SMTP down') を throw
  //                         ↑ sendMail が try/catch していないので素通り
  //     [テストコード]   ← エラーがここまで到達 → expect.rejects で検証
  //
  // なぜこれをわざわざテストするか:
  //   仮に sendMail が中で try/catch してエラーを握りつぶしてしまうと
  //   (例: ↓ のようなウッカリ実装)
  //
  //     export async function sendMail(...) {
  //       try { await sendEmail({ ... }); }
  //       catch (e) { console.error(e); /* return もしない、throw もしない */ }
  //     }
  //
  //   呼び出し側 (route handler 等) は「メール送信成功」と誤認してしまう。
  //   ユーザーには "送信完了" と表示されるのに実際は届いていない、という
  //   サイレント失敗バグに繋がる。
  //   このテストは「失敗はちゃんと呼び出し元に伝える」という sendMail の
  //   インターフェース契約 (contract) を固定する役割を持つ。
  it('sendEmail がエラーを投げたら呼び出し元へ伝播する', async () => {
    // この it の中だけ rejected 動作に差し替える (beforeEach の resolve を上書き)。
    mockedSendEmail.mockRejectedValue(new Error('SMTP down'));

    // 第 2 / 第 3 引数の 's' / 'b' は **意味のないプレースホルダ**。
    // 「変な値を入れたときの挙動」を試しているわけではなく、sendMail を
    // 呼ぶための適当な正常引数があれば何でも良い (エラーを起こすのは
    // 下回りの sendEmail モック側なので、ここの入力値は結果に影響しない)。
    //
    // `expect(promise).rejects.toThrow(...)` : Promise が reject されること、
    // かつそのエラーメッセージが期待どおりであることを同時に検証する
    // Vitest の非同期アサーション。await を忘れるとテストが
    // "通ったように見えて実は何も検証していない" 状態になるので注意。
    await expect(sendMail('to@example.com', 's', 'b')).rejects.toThrow('SMTP down');
  });
});
