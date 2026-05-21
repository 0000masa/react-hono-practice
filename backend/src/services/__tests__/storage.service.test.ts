/**
 * storage.service.ts のユニットテスト。
 *
 * 何をテストしているか:
 *   src/services/storage.service.ts に定義された 2 つの関数について、
 *     1. `uploadFile(key, body, contentType)`
 *        - 正常系: AWS SDK の `S3Client.send` に対して、期待した内容の
 *          `PutObjectCommand` (Bucket / Key / Body / ContentType) を 1 回だけ
 *          送ること。
 *        - 異常系: S3 側がエラーを返した場合、そのエラーを呼び出し元へ
 *          そのまま伝播 (rethrow) すること。
 *     2. `getFileUrl(fileName)`
 *        - `STORAGE_URL_BASE` とファイル名を `/` で結合した URL を返すこと。
 *        - ファイル名側にスラッシュ (パス区切り) が含まれていても、特別な
 *          エスケープなどはせず単純結合すること。
 *
 *   実際の AWS S3 (および MinIO) には絶対に到達しない。`aws-sdk-client-mock`
 *   を使って S3Client へのコマンド送信をプロセス内で横取り (intercept) する。
 *
 * いつ実行されるか: `*.test.ts` のユニットテスト扱い → `npm test` で走る。
 */
import { describe, it, expect, beforeEach } from 'vitest';
// `aws-sdk-client-mock`:
//   AWS SDK v3 のクライアント (S3Client, DynamoDBClient, ...) を **コマンド単位**
//   でモック化するための公式推奨ライブラリ。
//   `mockClient(S3Client)` を呼ぶと、以降そのプロセス内で `new S3Client(...)` で
//   生成されるインスタンスの `.send()` がすべて横取りされ、`s3Mock.on(...)` で
//   仕込んだ振る舞いに置き換わる。実 AWS への通信は発生しない。
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadFile, getFileUrl } from '../storage.service';
import { env } from '../../config/env';

// このファイル全体で共有する S3 モック。
// `mockClient(S3Client)` の戻り値は「モックの操作ハンドル」で、
//   - `.on(Command).resolves(...)` / `.rejects(...)` で挙動を設定
//   - `.commandCalls(Command)` で呼び出し履歴を取得
//   - `.reset()` で履歴と設定をクリア
// といった API を持つ。describe の外で 1 回だけ作り、beforeEach でリセットする。
const s3Mock = mockClient(S3Client);

describe('uploadFile', () => {
  // 各テストの直前で S3 モックを完全初期化する。
  //   - `.on(...)` で仕掛けた応答設定 (resolves / rejects) もすべて消える
  //   - `commandCalls` で見える呼び出し履歴もリセットされる
  // → テスト同士が状態を引きずらず、独立に走る (= 順序に依存しない) ようになる。
  beforeEach(() => {
    s3Mock.reset();
  });

  it('正常系: PutObjectCommand を期待した引数で S3 に送信する', async () => {
    // `s3Mock.on(PutObjectCommand).resolves({})`:
    //   「`PutObjectCommand` 型のコマンドが `s3Client.send(...)` で送られてきたら、
    //    空オブジェクト `{}` を resolve する Promise を返す」と仕込む。
    //   本物の S3 API なら `PutObjectCommandOutput` (ETag などを含む) が返るが、
    //   uploadFile は戻り値を使っていない (await して捨てている) ので、ここでは
    //   形だけ満たせば十分。
    s3Mock.on(PutObjectCommand).resolves({});

    // テスト用のダミー本体。
    // `Buffer.from(string)` は「文字列を UTF-8 バイト列に変換した Buffer
    // オブジェクト」を作るファクトリ関数。`Buffer` は Node.js 標準の
    // バイナリデータ用クラスで、import なしでグローバルに使える。
    // 本物の PNG バイナリではなく、`uploadFile` 内部で **そのまま** S3 の
    // Body に詰められて渡るかを確認するための「目印」として使う。
    const buf = Buffer.from('hello-png');
    await uploadFile('user-1/image.png', buf, 'image/png');

    // `s3Mock.commandCalls(PutObjectCommand)`:
    //   モックに記録された呼び出し履歴のうち、`PutObjectCommand` 型に
    //   該当するものだけを配列で返す。各要素は `args` (send に渡された
    //   コマンドインスタンス等) を持っている。
    const calls = s3Mock.commandCalls(PutObjectCommand);

    // --- アサーション 1: 呼び出し回数の検証 ---
    // 「ちょうど 1 回」呼ばれたことを固定する意味:
    //   ・0 回    → そもそも S3 に送られていない (uploadFile 内で早期 return など)
    //   ・2 回以上 → 重複送信 (再試行ループのバグ、課金やデータ重複に直結)
    //   どちらも仕様外なので、回数まで含めて契約として固定しておく。
    expect(calls).toHaveLength(1);

    // --- アサーション 2: 呼び出し引数の検証 ---
    // `calls[0]` … 1 回目の呼び出し。
    // `.args[0]` … `s3Client.send(...)` の第 1 引数、すなわち
    //              `new PutObjectCommand({...})` で作ったコマンドインスタンス。
    // `.input`   … `PutObjectCommand` のコンストラクタに渡したオプション
    //              オブジェクト (= 実際に S3 へ送られるパラメータ群)。
    //
    // `toEqual(...)` は **値の中身が再帰的に等しい** ことを確認する
    // 深い等価マッチャ。ここでは:
    //   - Bucket:       env から取った設定値が使われているか
    //   - Key:          呼び出し時の第 1 引数 ('user-1/image.png') がそのまま渡るか
    //   - Body:         上で作った `buf` がそのまま渡るか
    //   - ContentType:  第 3 引数 ('image/png') がそのまま渡るか
    // を一括で照合し、「uploadFile は受け取った値をそのまま PutObjectCommand に
    // 中継する」という契約 (contract) を固定する。
    expect(calls[0].args[0].input).toEqual({
      Bucket: env.S3_BUCKET,
      Key: 'user-1/image.png',
      Body: buf,
      ContentType: 'image/png',
    });
  });

  it('異常系: S3 が reject したら同じエラーを伝播する', async () => {
    // 今度は `.rejects(...)` で「`PutObjectCommand` を送ると例外が出る」と仕込む。
    // → uploadFile 内部の `await s3Client.send(...)` が throw する状態になる。
    s3Mock.on(PutObjectCommand).rejects(new Error('S3 unavailable'));

    // `expect(promise).rejects.toThrow(message)`:
    //   非同期関数を呼び出した結果の Promise が **reject されること**、かつ
    //   reject の中身 (Error の message) が引数文字列を含むことを検証する非同期
    //   マッチャ。`await` を忘れると検証前にテストが終わってしまうので必須。
    //
    // ここで確認していること:
    //   uploadFile は S3 エラーを **握り潰さず** に呼び出し元へ素通しする。
    //   → 上位レイヤ (ルートハンドラなど) が 5xx を返す / リトライする等の
    //     判断をできるようにするための重要な契約。
    await expect(
      uploadFile('k', Buffer.from(''), 'image/png'),
    ).rejects.toThrow('S3 unavailable');
  });
});

describe('getFileUrl', () => {
  // `getFileUrl` は副作用のない純粋関数 (文字列結合のみ) なので、
  // モックも beforeEach も不要。入力と出力だけで完結する。
  it('STORAGE_URL_BASE とファイル名を `/` で結合する', () => {
    // 基本ケース: 単なるファイル名 → "<base>/abc.png" になることを確認。
    // ベース URL を直書きせず `env.STORAGE_URL_BASE` をテンプレートで埋め込むのは、
    //   - .env / 環境 (dev / prod) ごとにベース URL が変わってもテストが壊れないため
    //   - 「base と fileName を `/` で連結する」という関数の責務を、テンプレート
    //     リテラルの形そのもので表現するため (= 期待値の意図が読みやすい)。
    expect(getFileUrl('abc.png')).toBe(`${env.STORAGE_URL_BASE}/abc.png`);
  });

  it('ファイル名にパス区切りが含まれてもそのまま結合する', () => {
    // S3 のキーはサブディレクトリ的な階層 ('userId/file.png' など) を含むことが
    // 多い。getFileUrl が中の `/` を特別扱い (URL エンコードなど) せず、
    // **そのまま** 連結することを固定するケース。
    // → これが崩れると、公開 URL がブラウザから 404 / 403 になる。
    expect(getFileUrl('1/x.png')).toBe(`${env.STORAGE_URL_BASE}/1/x.png`);
  });
});
